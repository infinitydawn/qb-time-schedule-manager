import { NextRequest, NextResponse } from 'next/server';
import { getPool, initDb } from '@/utils/db';
import { DailySchedule, ProjectManager, WorkerAssignment } from '@/types/schedule';

let dbReady = false;

async function ensureDb() {
  if (!dbReady) {
    await initDb();
    dbReady = true;
  }
}

// ─── GET  /api/schedules ────────────────────────────────────────────
// Returns all schedules with nested PMs and assignments
export async function GET() {
  try {
    await ensureDb();
    const db = getPool();

    const { rows: scheduleRows } = await db.query(
      `SELECT id, date, day_name, sent_to_qb, qb_hash, created_at, updated_at FROM schedules ORDER BY date`
    );

    const { rows: pmRows } = await db.query(
      `SELECT id, schedule_id, name, sort_order FROM project_managers ORDER BY sort_order`
    );

    const { rows: assignRows } = await db.query(
      `SELECT id, pm_id, schedule_id, workers, job, start_time, end_time, sort_order, qb_event_id, assignment_hash FROM assignments ORDER BY sort_order`
    );

    // Build lookup maps
    const assignmentsByPm: Record<string, WorkerAssignment[]> = {};
    for (const a of assignRows) {
      const wa: WorkerAssignment = {
        id: a.id,
        workers: a.workers || [],
        job: a.job,
        pmId: a.pm_id,
        startTime: a.start_time || undefined,
        endTime: a.end_time || undefined,
        qbEventId: a.qb_event_id || undefined,
        assignmentHash: a.assignment_hash || undefined,
      };
      (assignmentsByPm[a.pm_id] ??= []).push(wa);
    }

    const pmsBySchedule: Record<string, ProjectManager[]> = {};
    for (const pm of pmRows) {
      const p: ProjectManager = {
        id: pm.id,
        name: pm.name,
        assignments: assignmentsByPm[pm.id] || [],
      };
      (pmsBySchedule[pm.schedule_id] ??= []).push(p);
    }

    const schedules: DailySchedule[] = scheduleRows.map((s: any) => ({
      id: s.id,
      date: s.date,
      dayName: s.day_name,
      sentToQB: s.sent_to_qb || false,
      qbHash: s.qb_hash || undefined,
      createdAt: s.created_at ? new Date(s.created_at).toISOString() : undefined,
      updatedAt: s.updated_at ? new Date(s.updated_at).toISOString() : undefined,
      projectManagers: pmsBySchedule[s.id] || [],
    }));

    return NextResponse.json(schedules);
  } catch (err: unknown) {
    console.error('GET /api/schedules error:', err);
    return NextResponse.json({ error: 'Failed to load schedules' }, { status: 500 });
  }
}

// ─── PUT  /api/schedules ────────────────────────────────────────────
// Full sync: receives the complete schedules array and upserts everything.
// Simple approach: delete all then re-insert within a transaction.
export async function PUT(req: NextRequest) {
  try {
    await ensureDb();
    const db = getPool();
    const schedules: DailySchedule[] = await req.json();

    const client = await db.connect();
    try {
      await client.query('BEGIN');

      // Upsert schedules, project managers and assignments so we preserve QB metadata
      for (const s of schedules) {
        await client.query(
          `INSERT INTO schedules (id, date, day_name, sent_to_qb, updated_at) VALUES ($1, $2, $3, $4, NOW())
           ON CONFLICT (id) DO UPDATE SET date = EXCLUDED.date, day_name = EXCLUDED.day_name, sent_to_qb = EXCLUDED.sent_to_qb, updated_at = NOW()`,
          [s.id, s.date, s.dayName, s.sentToQB || false]
        );

        // Track PM and assignment IDs so we can remove any that are not present in the payload
        const pmIds: string[] = [];
        const assignIds: string[] = [];

        for (let pi = 0; pi < s.projectManagers.length; pi++) {
          const pm = s.projectManagers[pi];
          pmIds.push(pm.id);
          await client.query(
            `INSERT INTO project_managers (id, schedule_id, name, sort_order) VALUES ($1, $2, $3, $4)
             ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, sort_order = EXCLUDED.sort_order`,
            [pm.id, s.id, pm.name, pi]
          );

          for (let ai = 0; ai < pm.assignments.length; ai++) {
            const a = pm.assignments[ai];
            assignIds.push(a.id);
            const startTime = a.startTime || '08:00';
            const endTime = a.endTime || '16:00';
            await client.query(
              `INSERT INTO assignments (id, pm_id, schedule_id, workers, job, start_time, end_time, sort_order, assignment_hash) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
               ON CONFLICT (id) DO UPDATE SET workers = EXCLUDED.workers, job = EXCLUDED.job, start_time = EXCLUDED.start_time, end_time = EXCLUDED.end_time, sort_order = EXCLUDED.sort_order`,
              [a.id, pm.id, s.id, a.workers, a.job, startTime, endTime, ai, a.assignmentHash || null]
            );
          }
        }

        // Remove any PMs and assignments that were deleted client-side
        if (pmIds.length > 0) {
          await client.query(`DELETE FROM project_managers WHERE schedule_id = $1 AND id != ALL($2::text[])`, [s.id, pmIds]);
        } else {
          // no PMs in payload -> remove all PMs for this schedule
          await client.query(`DELETE FROM project_managers WHERE schedule_id = $1`, [s.id]);
        }

        if (assignIds.length > 0) {
          await client.query(`DELETE FROM assignments WHERE schedule_id = $1 AND id != ALL($2::text[])`, [s.id, assignIds]);
        } else {
          await client.query(`DELETE FROM assignments WHERE schedule_id = $1`, [s.id]);
        }
      }

      const scheduleIds = schedules.map(s => s.id);
      if (scheduleIds.length > 0) {
        await client.query(`DELETE FROM schedules WHERE id != ALL($1::text[])`, [scheduleIds]);
      } else {
        await client.query(`DELETE FROM schedules`);
      }

      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    console.error('PUT /api/schedules error:', err);
    return NextResponse.json({ error: 'Failed to save schedules' }, { status: 500 });
  }
}
