import { NextRequest, NextResponse } from 'next/server';
import { getQBHeaders, TSHEETS_BASE } from '@/utils/qbtoken';
import { getPool, initDb } from '@/utils/db';
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

// Simplified route: when a schedule has changed (hash differs), delete all existing
// QuickBooks schedule events for that schedule and recreate all provided entries.
// If unchanged, skip. If no scheduleId provided, create entries.
export async function POST(req: NextRequest) {
  try {
    const payload = await req.json();
    const entries: ScheduleEventEntry[] = payload.entries || [];
    const scheduleId: string | undefined = payload.scheduleId;
    const scheduleObj = payload.schedule;
    const assignmentHashes: Record<string, string> = payload.assignmentHashes || {};

    console.log('[create-schedule-events] incoming payload', {
      scheduleId,
      entriesCount: entries.length,
      hasScheduleObj: !!scheduleObj,
      assignmentHashKeys: Object.keys(assignmentHashes || {}).length,
    });

    if (!entries || entries.length === 0) {
      return NextResponse.json({ error: 'No schedule event entries provided' }, { status: 400 });
    }

    const headers = getQBHeaders();

    await initDb();
    const db = getPool();

    // Determine whether schedule changed (fingerprint differs) -> force delete+recreate
    let forceRecreate = false;
    if (scheduleId && scheduleObj) {
      const hash = crypto.createHash('sha256').update(JSON.stringify(scheduleObj)).digest('hex');
      const { rows } = await db.query('SELECT qb_hash FROM schedules WHERE id = $1', [scheduleId]);
      const existingHash = rows[0]?.qb_hash;
      if (existingHash && existingHash === hash) {
        console.log('[create-schedule-events] schedule unchanged; skipping send');
        return NextResponse.json({ created: 0, failed: 0, message: 'No changes since last send' });
      }
      if (existingHash && existingHash !== hash) {
        console.log('[create-schedule-events] schedule changed; will delete existing events and recreate');
        // Query assignments for qb_event_id to delete
        try {
          const { rows: assignRows } = await db.query('SELECT id, qb_event_id FROM assignments WHERE schedule_id = $1', [scheduleId]);
          const idsToDelete: string[] = assignRows.filter((r: any) => r.qb_event_id).map((r: any) => String(r.qb_event_id));
          if (idsToDelete.length > 0) {
            const deleteUrl = `${TSHEETS_BASE}/schedule_events?ids=${idsToDelete.join(',')}`;
            console.log('[create-schedule-events] batch deleting existing events', { deleteUrl, count: idsToDelete.length });
            try {
              const delRes = await fetch(deleteUrl, { method: 'DELETE', headers });
              const delText = await delRes.text();
              let delData: any;
              try { delData = JSON.parse(delText); } catch { delData = delText; }
              console.log('[create-schedule-events] batch delete response', delRes.status, delData);
              if (delRes.ok) {
                await db.query('UPDATE assignments SET qb_event_id = NULL WHERE qb_event_id = ANY($1)', [idsToDelete]);
              } else {
                // If batch delete not allowed (405) or failed, fall back to per-id deletes
                if (delRes.status === 405 || (delData && delData.error && delData.error.code === 405)) {
                  console.log('[create-schedule-events] batch delete not supported, falling back to per-id deletes');
                } else {
                  console.warn('[create-schedule-events] batch delete returned non-ok', delRes.status, delData);
                }
                const deletedIds: string[] = [];
                for (const id of idsToDelete) {
                  try {
                    const singleDel = await fetch(`${TSHEETS_BASE}/schedule_events/${id}`, { method: 'DELETE', headers });
                    const singleText = await singleDel.text();
                    let singleData: any;
                    try { singleData = JSON.parse(singleText); } catch { singleData = singleText; }
                    console.log('[create-schedule-events] single delete response', id, singleDel.status, singleData);
                    if (singleDel.ok) deletedIds.push(id);
                  } catch (sderr) {
                    console.error('[create-schedule-events] error deleting single event', id, sderr);
                  }
                }
                if (deletedIds.length > 0) {
                  try { await db.query('UPDATE assignments SET qb_event_id = NULL WHERE qb_event_id = ANY($1)', [deletedIds]); } catch (uerr) { console.error('[create-schedule-events] failed to clear qb_event_id after single deletes', uerr); }
                }
              }
            } catch (derr) {
              console.error('[create-schedule-events] error during batch delete', derr);
            }
          }
        } catch (err) {
          console.error('[create-schedule-events] error querying assignments for deletion', err);
        }
        forceRecreate = true;
      }
    }

    // Fetch schedule calendar id
    const calRes = await fetch(`${TSHEETS_BASE}/schedule_calendars`, { headers });
    const calData = await calRes.json();
    const rawCals = calData.results?.schedule_calendars || {};
    const calIds = Object.keys(rawCals);
    if (calIds.length === 0) return NextResponse.json({ error: 'No schedule calendars found' }, { status: 400 });
    const scheduleCalendarId = Number(calIds[0]);

    // If forceRecreate -> create all entries. Otherwise if scheduleId not provided -> create all entries.
    const toCreate: Array<{ assignmentId?: string; entry: any }> = [];
    if (scheduleId && !forceRecreate) {
      // If we reach here and scheduleId provided but not changed (should have been returned earlier),
      // fallback to creating entries (safe default) — but we already returned on unchanged.
      // For simplicity, create any entries that do not have existing qb_event mapping.
      const { rows: prevAssignRows } = await db.query('SELECT id, qb_event_id FROM assignments WHERE schedule_id = $1', [scheduleId]);
      const prevById: Record<string, { qb_event_id?: string }> = {};
      for (const r of prevAssignRows) prevById[r.id] = { qb_event_id: r.qb_event_id };
      for (const e of entries) {
        const aid = (e as any).assignmentId as string | undefined;
        const prev = aid ? prevById[aid] : undefined;
        if (!prev || !prev.qb_event_id) toCreate.push({ assignmentId: aid, entry: e });
      }
    } else {
      // No scheduleId or forceRecreate -> create everything
      for (const e of entries) toCreate.push({ assignmentId: (e as any).assignmentId, entry: e });
    }

    // Create payload batches and POST to TSheets
    const BATCH_SIZE = 50;
    const results: any[] = [];
    const errors: any[] = [];
    const createdEventIds: string[] = [];

    // Before creating new events, delete any existing schedule events in QB that overlap
    // the time range covered by the entries (ensures a clean recreate of the day).
    try {
      if (toCreate.length > 0) {
        const starts = entries.map(e => new Date((e as any).start).getTime()).filter(Boolean);
        const ends = entries.map(e => new Date((e as any).end).getTime()).filter(Boolean);
        if (starts.length > 0 && ends.length > 0) {
          const minStart = new Date(Math.min(...starts)).toISOString();
          const maxEnd = new Date(Math.max(...ends)).toISOString();
          const params = new URLSearchParams();
          params.set('start', minStart);
          params.set('end', maxEnd);
          // Query ALL known calendars to ensure we find events regardless of which calendar they were created under
          params.set('schedule_calendar_ids', calIds.join(','));
          params.set('limit', '500');
          params.set('active', 'both');
          params.set('team_events', 'instance');
          // Recursively fetch and delete remote events within the time range until none remain.
          const MAX_LIST_LIMIT = 200;
          const chunkSize = 100; // DELETE ids chunk size
          let totalDeleted = 0;
          while (true) {
            const loopParams = new URLSearchParams();
            loopParams.set('start', minStart);
            loopParams.set('end', maxEnd);
            loopParams.set('schedule_calendar_ids', calIds.join(','));
            loopParams.set('limit', String(MAX_LIST_LIMIT));
            loopParams.set('active', 'both');
            loopParams.set('team_events', 'instance');
            const listUrlLoop = `${TSHEETS_BASE}/schedule_events?${loopParams.toString()}`;
            console.log('[create-schedule-events] listing remote events for delete', { listUrl: listUrlLoop });
            const listResLoop = await fetch(listUrlLoop, { headers });
            const listTextLoop = await listResLoop.text();
            let listDataLoop: any;
            try { listDataLoop = JSON.parse(listTextLoop); } catch { listDataLoop = listTextLoop; }
            const rawEventsLoop = listDataLoop.results?.schedule_events || {};
            const remoteListLoop = Object.values(rawEventsLoop);
            console.log('[create-schedule-events] remote events found this pass', remoteListLoop.length);
            const remoteIds: string[] = remoteListLoop.map((rev: any) => String(rev.id || rev.event_id || rev.schedule_event_id || rev._id || rev.id)).filter(Boolean);
            if (remoteIds.length === 0) {
              console.log('[create-schedule-events] no more remote events to delete; totalDeleted=', totalDeleted);
              break;
            }
            // Delete in chunks to avoid overly long query strings
            for (let si = 0; si < remoteIds.length; si += chunkSize) {
              const chunk = remoteIds.slice(si, si + chunkSize);
              const deleteUrlChunk = `${TSHEETS_BASE}/schedule_events?ids=${chunk.join(',')}`;
              console.log('[create-schedule-events] deleting remote chunk', { deleteUrl: deleteUrlChunk, size: chunk.length });
                try {
                const delResChunk = await fetch(deleteUrlChunk, { method: 'DELETE', headers });
                const delTextChunk = await delResChunk.text();
                let delDataChunk: any;
                try { delDataChunk = JSON.parse(delTextChunk); } catch { delDataChunk = delTextChunk; }
                console.log('[create-schedule-events] chunk delete response', delResChunk.status, { ok: delResChunk.ok });
                if (delResChunk.ok) {
                  try { await db.query('UPDATE assignments SET qb_event_id = NULL WHERE qb_event_id = ANY($1)', [chunk]); } catch (uerr) { console.error('[create-schedule-events] failed to clear qb_event_id for chunk', uerr); }
                  totalDeleted += chunk.length;
                } else {
                  // Fallback to per-id deletes for this chunk
                  console.warn('[create-schedule-events] chunk delete non-ok, falling back to per-id', delResChunk.status, delDataChunk);
                  const deletedChunkIds: string[] = [];
                  for (const id of chunk) {
                    try {
                      const singleDel = await fetch(`${TSHEETS_BASE}/schedule_events/${id}`, { method: 'DELETE', headers });
                      const singleText = await singleDel.text();
                      let singleData: any;
                      try { singleData = JSON.parse(singleText); } catch { singleData = singleText; }
                      console.log('[create-schedule-events] single delete response (chunk fallback)', id, singleDel.status, singleData);
                      if (singleDel.ok) deletedChunkIds.push(id);
                    } catch (sderr) {
                      console.error('[create-schedule-events] error deleting single event (chunk fallback)', id, sderr);
                    }
                  }
                  if (deletedChunkIds.length > 0) {
                    try { await db.query('UPDATE assignments SET qb_event_id = NULL WHERE qb_event_id = ANY($1)', [deletedChunkIds]); } catch (uerr) { console.error('[create-schedule-events] failed to clear qb_event_id after chunk fallback', uerr); }
                    totalDeleted += deletedChunkIds.length;
                  }
                }
              } catch (derr) {
                console.error('[create-schedule-events] error deleting remote chunk', derr);
              }
            }
            // loop will re-query; continue until none left
          }
        }
      }
    } catch (delErr) {
      console.error('[create-schedule-events] error while fetching/deleting remote events', delErr);
    }

    const createBatches = toCreate.map(c => {
      const { assignmentId, ...rest } = c.entry as any;
      const payloadItem: any = { schedule_calendar_id: scheduleCalendarId, ...(rest as any) };
      if (payloadItem.draft === undefined) payloadItem.draft = false;
      if (Array.isArray(payloadItem.assigned_user_ids)) payloadItem.assigned_user_ids = payloadItem.assigned_user_ids.map((x: any) => Number(x));
      return payloadItem;
    });

    for (let i = 0; i < createBatches.length; i += BATCH_SIZE) {
      const batch = createBatches.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      console.log('[create-schedule-events] POST batch', { batchNum, size: batch.length });
      const res = await fetch(`${TSHEETS_BASE}/schedule_events`, { method: 'POST', headers, body: JSON.stringify({ data: batch }) });
      const text = await res.text();
      let data: any;
      try { data = JSON.parse(text); } catch { data = text; }
      console.log('[create-schedule-events] create response', res.status, data);
      if (!res.ok) {
        errors.push({ phase: 'create', batch: batchNum, status: res.status, error: data });
        continue;
      }
      const events = data.results?.schedule_events || {};
      for (const [key, ev] of Object.entries(events) as [string, any][]) {
        if (ev._status_code === 200 || ev._status_code === 201) {
          results.push({ id: ev.id, status: 'created' });
          createdEventIds.push(String(ev.id));
        } else {
          errors.push({ key, status: ev._status_code, message: ev._status_message, extra: ev._status_extra });
        }
      }
    }

    // Map created event ids back to assignments by order of toCreate
    if (createdEventIds.length > 0) {
      const mapLen = Math.min(createdEventIds.length, toCreate.length);
      for (let i = 0; i < mapLen; i++) {
        const aid = toCreate[i].assignmentId;
        const ev = createdEventIds[i];
        if (aid) {
          try {
            await db.query('UPDATE assignments SET qb_event_id = $1 WHERE id = $2', [ev, aid]);
          } catch (uerr) {
            console.error('[create-schedule-events] failed to persist qb_event_id', aid, uerr);
          }
        }
      }
    }

    // Persist assignment_hash for created assignments when scheduleObj provided
    if (scheduleObj) {
      for (const item of toCreate) {
        const aid = item.assignmentId;
        if (!aid) continue;
        try {
          const pms = scheduleObj.projectManagers || [];
          let found: any = null;
          for (const pm of pms) {
            for (const a of pm.assignments || []) {
              if (a.id === aid) { found = a; break; }
            }
            if (found) break;
          }
          if (found) {
            const workers = Array.isArray(found.workers) ? [...found.workers].sort() : [];
            const payloadHash = crypto.createHash('sha256').update(JSON.stringify({ job: found.job || '', workers })).digest('hex');
            await db.query('UPDATE assignments SET assignment_hash = $1 WHERE id = $2', [payloadHash, aid]);
          }
        } catch (err) {
          console.error('[create-schedule-events] failed to persist assignment_hash', aid, err);
        }
      }
    }

    // Update schedule qb_hash and qb_sent_at
    if (scheduleId && scheduleObj) {
      const hash = crypto.createHash('sha256').update(JSON.stringify(scheduleObj)).digest('hex');
      await db.query('UPDATE schedules SET qb_hash = $1, qb_sent_at = NOW(), sent_to_qb = TRUE WHERE id = $2', [hash, scheduleId]);
    }

    return NextResponse.json({ created: results.length, failed: errors.length, results, errors: errors.length > 0 ? errors : undefined });
  } catch (err: any) {
    console.error('QB Time Create Schedule Events API error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
