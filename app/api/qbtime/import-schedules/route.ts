import { NextRequest, NextResponse } from 'next/server';
import { getQBHeaders, TSHEETS_BASE } from '@/utils/qbtoken';
import { getPool, initDb } from '@/utils/db';
import { getScheduleFingerprintInput } from '@/utils/scheduleFingerprint';
import { DailySchedule, ProjectManager, WorkerAssignment } from '@/types/schedule';
import crypto from 'crypto';

interface QBEvent {
  id?: string | number;
  start?: string;
  end?: string;
  title?: string;
  notes?: string;
  location?: string;
  jobcode_id?: string | number;
  assigned_user_ids?: Array<string | number>;
}

interface SupplementalUser {
  id: string | number;
  first_name?: string;
  last_name?: string;
  display_name?: string;
}

interface SupplementalJobcode {
  id: string | number;
  name?: string;
}

const DEFAULT_START_TIME = '08:00';
const DEFAULT_END_TIME = '16:00';

const parseLocalDate = (date: string) => {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(year, month - 1, day);
};

const toISODate = (date: Date) => date.toISOString().slice(0, 10);

const datesBetweenInclusive = (startDate: string, endDate: string) => {
  const dates: string[] = [];
  const cursor = parseLocalDate(startDate);
  const end = parseLocalDate(endDate);

  while (cursor <= end) {
    dates.push(toISODate(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }

  return dates;
};

const dayNameForDate = (date: string) => (
  parseLocalDate(date).toLocaleDateString('en-US', { weekday: 'long' })
);

const getEasternOffset = (date: string) => {
  const [yr, mo, da] = date.split('-').map(Number);
  const dateObj = new Date(yr, mo - 1, da);
  const month = dateObj.getMonth() + 1;

  if (month > 3 && month < 11) return '-04:00';
  if (month === 3) {
    const firstDay = new Date(yr, 2, 1).getDay();
    const secondSun = firstDay === 0 ? 8 : 15 - firstDay;
    return da >= secondSun ? '-04:00' : '-05:00';
  }
  if (month === 11) {
    const firstDay = new Date(yr, 10, 1).getDay();
    const firstSun = firstDay === 0 ? 1 : 8 - firstDay;
    return da < firstSun ? '-04:00' : '-05:00';
  }

  return '-05:00';
};

const normalizeTime = (iso?: string, fallback = DEFAULT_START_TIME) => {
  const match = iso?.match(/T(\d{2}:\d{2})/);
  return match?.[1] || fallback;
};

const hashAssignment = (
  date: string,
  projectManager: string,
  assignment: WorkerAssignment
) => {
  const payload = {
    date,
    projectManager,
    job: assignment.job || '',
    workers: [...assignment.workers].sort(),
    startTime: assignment.startTime || DEFAULT_START_TIME,
    endTime: assignment.endTime || DEFAULT_END_TIME,
  };

  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
};

const parseNotes = (notes?: string) => {
  if (!notes) return { pmName: '', job: '', workers: [] as string[] };

  const match = notes.match(/^(.*?)\s+-\s+(.*?)\s+\((.*?)\)\s*$/);
  if (!match) return { pmName: '', job: '', workers: [] as string[] };

  return {
    pmName: match[1].trim(),
    job: match[2].trim(),
    workers: match[3].split(',').map(worker => worker.trim()).filter(Boolean),
  };
};

const userName = (user?: SupplementalUser) => {
  if (!user) return '';
  return user.display_name || `${user.first_name || ''} ${user.last_name || ''}`.trim();
};

const normalizeAssignedUserIds = (value: unknown): Array<string | number> => {
  if (value === null || value === undefined) return [];

  if (Array.isArray(value)) {
    return value.filter(id => typeof id === 'string' || typeof id === 'number');
  }

  if (typeof value === 'string') {
    return value
      .split(',')
      .map(part => part.trim())
      .filter(Boolean);
  }

  if (typeof value === 'number') {
    return [value];
  }

  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const entries = Object.entries(obj);
    if (entries.length === 0) return [];

    // Some QB payloads return an object keyed by user id with boolean flags.
    if (entries.every(([, v]) => typeof v === 'boolean')) {
      return entries.filter(([, v]) => v === true).map(([k]) => k);
    }

    return entries.flatMap(([, v]) => normalizeAssignedUserIds(v));
  }

  return [];
};

async function fetchScheduleEvents(startDate: string, endDate: string) {
  const headers = getQBHeaders();

  const calRes = await fetch(`${TSHEETS_BASE}/schedule_calendars`, { headers });
  const calData = await calRes.json();
  const rawCals = calData.results?.schedule_calendars || {};
  const calIds = Object.keys(rawCals);
  if (calIds.length === 0) {
    throw new Error('No schedule calendars found');
  }

  const eventsById = new Map<string, QBEvent>();
  const usersById: Record<string, SupplementalUser> = {};
  const jobcodesById: Record<string, SupplementalJobcode> = {};
  const limit = 200;

  for (const date of datesBetweenInclusive(startDate, endDate)) {
    const offset = getEasternOffset(date);
    const start = `${date}T00:00:00${offset}`;
    const end = `${date}T23:59:59${offset}`;
    const params = new URLSearchParams();
    params.set('start', start);
    params.set('end', end);
    params.set('schedule_calendar_ids', calIds.join(','));
    params.set('limit', String(limit));
    params.set('active', 'both');
    params.set('team_events', 'instance');

    const res = await fetch(`${TSHEETS_BASE}/schedule_events?${params.toString()}`, { headers });
    const text = await res.text();
    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }

    if (!res.ok) {
      console.error('[import-schedules] schedule_events failed', {
        status: res.status,
        date,
        details: data,
      });
      const detail = typeof data === 'string'
        ? data
        : data.error?.message || data.error || data._status_message || JSON.stringify(data);
      throw new Error(`QuickBooks schedule_events error ${res.status} for ${date}: ${detail}`);
    }

    const rawEvents = data.results?.schedule_events || {};
    const pageEvents = Object.values(rawEvents) as QBEvent[];
    for (const event of pageEvents) {
      if (event.id) eventsById.set(String(event.id), event);
    }

    Object.assign(usersById, data.supplemental_data?.users || {});
    Object.assign(jobcodesById, data.supplemental_data?.jobcodes || {});
  }

  return { events: [...eventsById.values()], usersById, jobcodesById };
}

function eventsToSchedules(
  events: QBEvent[],
  usersById: Record<string, SupplementalUser>,
  jobcodesById: Record<string, SupplementalJobcode>
) {
  const schedulesByDate = new Map<string, DailySchedule>();

  for (const event of events) {
    if (!event.id || !event.start) continue;

    const date = event.start.slice(0, 10);
    const parsed = parseNotes(event.notes);
    const jobcodeName = event.jobcode_id ? jobcodesById[String(event.jobcode_id)]?.name : '';
    const job = parsed.job || event.location || jobcodeName || event.title || '';
    const workers = parsed.workers.length > 0
      ? parsed.workers
      : normalizeAssignedUserIds(event.assigned_user_ids).map(id => userName(usersById[String(id)])).filter(Boolean);
    const pmName = parsed.pmName || 'Imported from QB';

    let schedule = schedulesByDate.get(date);
    if (!schedule) {
      schedule = {
        id: `qb-day-${date}`,
        date,
        dayName: dayNameForDate(date),
        sentToQB: true,
        projectManagers: [],
      };
      schedulesByDate.set(date, schedule);
    }

    let pm = schedule.projectManagers.find(item => item.name === pmName);
    if (!pm) {
      pm = {
        id: `qb-pm-${date}-${crypto.createHash('sha1').update(pmName).digest('hex').slice(0, 12)}`,
        name: pmName,
        assignments: [],
      };
      schedule.projectManagers.push(pm);
    }

    const assignment: WorkerAssignment = {
      id: `qb-job-${event.id}`,
      pmId: pm.id,
      workers,
      job,
      startTime: normalizeTime(event.start, DEFAULT_START_TIME),
      endTime: normalizeTime(event.end, DEFAULT_END_TIME),
      qbEventId: String(event.id),
    };
    assignment.assignmentHash = hashAssignment(date, pm.name, assignment);
    pm.assignments.push(assignment);
  }

  return [...schedulesByDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

async function replaceSchedules(schedules: DailySchedule[]) {
  await initDb();
  const db = getPool();
  const client = await db.connect();

  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM schedules');

    for (const schedule of schedules) {
      const qbHash = crypto.createHash('sha256').update(getScheduleFingerprintInput(schedule)).digest('hex');
      await client.query(
        `INSERT INTO schedules (id, date, day_name, sent_to_qb, qb_hash, qb_sent_at, updated_at)
         VALUES ($1, $2, $3, TRUE, $4, NOW(), NOW())`,
        [schedule.id, schedule.date, schedule.dayName, qbHash]
      );

      for (let pi = 0; pi < schedule.projectManagers.length; pi++) {
        const pm = schedule.projectManagers[pi];
        await client.query(
          `INSERT INTO project_managers (id, schedule_id, name, sort_order)
           VALUES ($1, $2, $3, $4)`,
          [pm.id, schedule.id, pm.name, pi]
        );

        for (let ai = 0; ai < pm.assignments.length; ai++) {
          const assignment = pm.assignments[ai];
          await client.query(
            `INSERT INTO assignments (id, pm_id, schedule_id, workers, job, start_time, end_time, sort_order, qb_event_id, assignment_hash)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [
              assignment.id,
              pm.id,
              schedule.id,
              assignment.workers,
              assignment.job,
              assignment.startTime || DEFAULT_START_TIME,
              assignment.endTime || DEFAULT_END_TIME,
              ai,
              assignment.qbEventId || null,
              assignment.assignmentHash || null,
            ]
          );
        }
      }
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function POST(req: NextRequest) {
  try {
    const { startDate, endDate } = await req.json();

    if (!startDate || !endDate) {
      return NextResponse.json({ error: 'Start date and end date are required' }, { status: 400 });
    }

    if (startDate > endDate) {
      return NextResponse.json({ error: 'Start date must be before or equal to end date' }, { status: 400 });
    }

    const { events, usersById, jobcodesById } = await fetchScheduleEvents(startDate, endDate);
    const schedules = eventsToSchedules(events, usersById, jobcodesById);
    await replaceSchedules(schedules);

    return NextResponse.json({
      ok: true,
      importedEvents: events.length,
      schedules,
    });
  } catch (err: any) {
    console.error('QB Time Import Schedules API error:', err);
    return NextResponse.json(
      { error: err.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
