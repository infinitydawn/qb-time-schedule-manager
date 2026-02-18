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
      `SELECT id, date, day_name, sent_to_qb FROM schedules ORDER BY date`
    );

    const { rows: pmRows } = await db.query(
      `SELECT id, schedule_id, name, sort_order FROM project_managers ORDER BY sort_order`
    );

    const { rows: assignRows } = await db.query(
      `SELECT id, pm_id, schedule_id, workers, job, sort_order FROM assignments ORDER BY sort_order`
    );

    // Build lookup maps
    const assignmentsByPm: Record<string, WorkerAssignment[]> = {};
    for (const a of assignRows) {
      const wa: WorkerAssignment = {
        id: a.id,
        workers: a.workers || [],
        job: a.job,
        pmId: a.pm_id,
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

    const schedules: DailySchedule[] = scheduleRows.map((s: { id: string; date: string; day_name: string; sent_to_qb: boolean }) => ({
      id: s.id,
      date: s.date,
      dayName: s.day_name,
      sentToQB: s.sent_to_qb || false,
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

      // Wipe existing data (cascading deletes handle children)
      await client.query('DELETE FROM schedules');

      for (const s of schedules) {
        await client.query(
          `INSERT INTO schedules (id, date, day_name, sent_to_qb, updated_at) VALUES ($1, $2, $3, $4, NOW())`,
          [s.id, s.date, s.dayName, s.sentToQB || false]
        );

        for (let pi = 0; pi < s.projectManagers.length; pi++) {
          const pm = s.projectManagers[pi];
          await client.query(
            `INSERT INTO project_managers (id, schedule_id, name, sort_order) VALUES ($1, $2, $3, $4)`,
            [pm.id, s.id, pm.name, pi]
          );

          for (let ai = 0; ai < pm.assignments.length; ai++) {
            const a = pm.assignments[ai];
            await client.query(
              `INSERT INTO assignments (id, pm_id, schedule_id, workers, job, sort_order) VALUES ($1, $2, $3, $4, $5, $6)`,
              [a.id, pm.id, s.id, a.workers, a.job, ai]
            );
          }
        }
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
