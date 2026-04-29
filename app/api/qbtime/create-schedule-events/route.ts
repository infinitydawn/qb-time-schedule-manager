import { NextRequest, NextResponse } from 'next/server';
import { getQBHeaders, TSHEETS_BASE } from '@/utils/qbtoken';
import { getPool, initDb } from '@/utils/db';
import { getScheduleFingerprintInput } from '@/utils/scheduleFingerprint';
import { DailySchedule } from '@/types/schedule';
import crypto from 'crypto';

interface ScheduleEventEntry {
  assigned_user_ids: string[];
  jobcode_id: number;
  start: string;
  end: string;
  all_day: boolean;
  title: string;
  notes?: string;
  color?: string;
  draft?: boolean;
  customfields?: Record<string, string>;
  assignmentId?: string;
}

interface AssignmentSyncRow {
  id: string;
  qb_event_id?: string | null;
  assignment_hash?: string | null;
}

interface SyncAction {
  assignmentId?: string;
  eventId?: string;
  entry: ScheduleEventEntry;
}

const BATCH_SIZE = 50;

const hashScheduleForQB = (schedule: DailySchedule) => (
  crypto.createHash('sha256').update(getScheduleFingerprintInput(schedule)).digest('hex')
);

const prepareEventPayload = (
  entry: ScheduleEventEntry,
  scheduleCalendarId: number,
  eventId?: string
) => {
  const { assignmentId: _assignmentId, ...rest } = entry;
  const payloadItem: Record<string, unknown> = {
    ...(eventId ? { id: Number(eventId) } : {}),
    schedule_calendar_id: scheduleCalendarId,
    ...rest,
  };

  if (payloadItem.draft === undefined) payloadItem.draft = false;
  if (Array.isArray(payloadItem.assigned_user_ids)) {
    payloadItem.assigned_user_ids = payloadItem.assigned_user_ids.map((id) => Number(id));
  }

  return payloadItem;
};

const parseQBResponse = async (res: Response) => {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

export async function POST(req: NextRequest) {
  try {
    const payload = await req.json();
    const entries: ScheduleEventEntry[] = payload.entries || [];
    const scheduleId: string | undefined = payload.scheduleId;
    const scheduleObj: DailySchedule | undefined = payload.schedule;
    const assignmentHashes: Record<string, string> = payload.assignmentHashes || {};

    console.log('[create-schedule-events] incoming payload', {
      scheduleId,
      entriesCount: entries.length,
      hasScheduleObj: !!scheduleObj,
      assignmentHashKeys: Object.keys(assignmentHashes).length,
    });

    if (entries.length === 0) {
      return NextResponse.json({ error: 'No schedule event entries provided' }, { status: 400 });
    }

    const headers = getQBHeaders();

    await initDb();
    const db = getPool();

    let scheduleHash: string | undefined;
    if (scheduleId && scheduleObj) {
      scheduleHash = hashScheduleForQB(scheduleObj);
      const { rows } = await db.query('SELECT qb_hash FROM schedules WHERE id = $1', [scheduleId]);
      const existingHash = rows[0]?.qb_hash;

      if (existingHash && existingHash === scheduleHash) {
        console.log('[create-schedule-events] schedule unchanged; skipping send');
        return NextResponse.json({
          created: 0,
          updated: 0,
          skipped: entries.length,
          failed: 0,
          unchanged: true,
          message: 'No changes since last send',
        });
      }
    }

    const calRes = await fetch(`${TSHEETS_BASE}/schedule_calendars`, { headers });
    const calData = await calRes.json();
    const rawCals = calData.results?.schedule_calendars || {};
    const calIds = Object.keys(rawCals);
    if (calIds.length === 0) {
      return NextResponse.json({ error: 'No schedule calendars found' }, { status: 400 });
    }
    const scheduleCalendarId = Number(calIds[0]);

    const toCreate: SyncAction[] = [];
    const toUpdate: SyncAction[] = [];
    let skipped = 0;

    if (scheduleId) {
      const { rows } = await db.query(
        'SELECT id, qb_event_id, assignment_hash FROM assignments WHERE schedule_id = $1',
        [scheduleId]
      );
      const prevById: Record<string, AssignmentSyncRow> = {};
      for (const row of rows as AssignmentSyncRow[]) {
        prevById[row.id] = row;
      }

      for (const entry of entries) {
        const assignmentId = entry.assignmentId;
        const prev = assignmentId ? prevById[assignmentId] : undefined;
        const incomingHash = assignmentId ? assignmentHashes[assignmentId] : undefined;

        if (!assignmentId || !prev?.qb_event_id) {
          toCreate.push({ assignmentId, entry });
        } else if (incomingHash && prev.assignment_hash === incomingHash) {
          skipped += 1;
        } else {
          toUpdate.push({ assignmentId, eventId: String(prev.qb_event_id), entry });
        }
      }
    } else {
      for (const entry of entries) {
        toCreate.push({ assignmentId: entry.assignmentId, entry });
      }
    }

    const results: Array<{ id: string; status: 'created' | 'updated' }> = [];
    const errors: unknown[] = [];
    const createdAssignments: Array<{ assignmentId: string; eventId: string }> = [];
    const updatedAssignmentIds: string[] = [];

    for (let i = 0; i < toCreate.length; i += BATCH_SIZE) {
      const actionBatch = toCreate.slice(i, i + BATCH_SIZE);
      const batch = actionBatch.map(action => prepareEventPayload(action.entry, scheduleCalendarId));
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;

      console.log('[create-schedule-events] POST batch', { batchNum, size: batch.length });
      const res = await fetch(`${TSHEETS_BASE}/schedule_events`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ data: batch }),
      });
      const data = await parseQBResponse(res);
      console.log('[create-schedule-events] create response', res.status, data);

      if (!res.ok) {
        errors.push({ phase: 'create', batch: batchNum, status: res.status, error: data });
        continue;
      }

      const events = data.results?.schedule_events || {};
      let actionIndex = 0;
      for (const [key, ev] of Object.entries(events) as [string, any][]) {
        const action = actionBatch[actionIndex++];
        if (ev._status_code === 200 || ev._status_code === 201) {
          const eventId = String(ev.id);
          results.push({ id: eventId, status: 'created' });
          if (action?.assignmentId) {
            createdAssignments.push({ assignmentId: action.assignmentId, eventId });
          }
        } else {
          errors.push({ phase: 'create', key, assignmentId: action?.assignmentId, status: ev._status_code, message: ev._status_message, extra: ev._status_extra });
        }
      }
    }

    for (let i = 0; i < toUpdate.length; i += BATCH_SIZE) {
      const actionBatch = toUpdate.slice(i, i + BATCH_SIZE);
      const batch = actionBatch.map(action => prepareEventPayload(action.entry, scheduleCalendarId, action.eventId));
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;

      console.log('[create-schedule-events] PUT batch', { batchNum, size: batch.length });
      const res = await fetch(`${TSHEETS_BASE}/schedule_events`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ data: batch }),
      });
      const data = await parseQBResponse(res);
      console.log('[create-schedule-events] update response', res.status, data);

      if (!res.ok) {
        errors.push({ phase: 'update', batch: batchNum, status: res.status, error: data });
        continue;
      }

      const events = data.results?.schedule_events || {};
      let actionIndex = 0;
      for (const [key, ev] of Object.entries(events) as [string, any][]) {
        const action = actionBatch[actionIndex++];
        if (ev._status_code === 200 || ev._status_code === 201) {
          if (!action) continue;
          const eventId = String(ev.id || action.eventId);
          results.push({ id: eventId, status: 'updated' });
          if (action.assignmentId) updatedAssignmentIds.push(action.assignmentId);
        } else {
          errors.push({ phase: 'update', key, assignmentId: action?.assignmentId, status: ev._status_code, message: ev._status_message, extra: ev._status_extra });
        }
      }
    }

    if (createdAssignments.length > 0) {
      for (const { assignmentId, eventId } of createdAssignments) {
        try {
          await db.query(
            'UPDATE assignments SET qb_event_id = $1, assignment_hash = $2 WHERE id = $3',
            [eventId, assignmentHashes[assignmentId] || null, assignmentId]
          );
        } catch (err) {
          console.error('[create-schedule-events] failed to persist created qb_event_id', assignmentId, err);
        }
      }
    }

    for (const assignmentId of updatedAssignmentIds) {
      try {
        await db.query(
          'UPDATE assignments SET assignment_hash = $1 WHERE id = $2',
          [assignmentHashes[assignmentId] || null, assignmentId]
        );
      } catch (err) {
        console.error('[create-schedule-events] failed to persist updated assignment_hash', assignmentId, err);
      }
    }

    if (scheduleId && scheduleObj) {
      await db.query(
        'UPDATE schedules SET qb_hash = $1, qb_sent_at = NOW(), sent_to_qb = TRUE WHERE id = $2',
        [scheduleHash || hashScheduleForQB(scheduleObj), scheduleId]
      );
    }

    return NextResponse.json({
      created: createdAssignments.length,
      updated: updatedAssignmentIds.length,
      skipped,
      failed: errors.length,
      results,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err: any) {
    console.error('QB Time Create Schedule Events API error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
