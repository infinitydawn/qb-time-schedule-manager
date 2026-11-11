import { NextRequest, NextResponse } from 'next/server';
import { getPool, initDb } from '@/utils/db';

let dbReady = false;

async function ensureDb() {
  if (!dbReady) {
    await initDb();
    dbReady = true;
  }
}

// ─── GET  /api/work-types ───────────────────────────────────────────
export async function GET() {
  try {
    await ensureDb();
    const { rows } = await getPool().query(
      `SELECT id, name FROM work_types ORDER BY LOWER(name)`
    );
    return NextResponse.json({ workTypes: rows.map(r => ({ id: r.id, name: r.name })) });
  } catch (err: unknown) {
    console.error('GET /api/work-types error:', err);
    return NextResponse.json({ error: 'Failed to load work types' }, { status: 500 });
  }
}

// ─── POST /api/work-types  { name } ─────────────────────────────────
// Adds a work type (or returns the existing one with the same name, case-insensitive).
export async function POST(req: NextRequest) {
  try {
    await ensureDb();
    const body = await req.json().catch(() => ({}));
    const name = String(body?.name || '').replace(/[\r\n]+/g, ' ').trim();

    if (!name) {
      return NextResponse.json({ error: 'Work type name is required' }, { status: 400 });
    }
    if (name.includes(',')) {
      // A job's work types are stored as a comma-separated list
      return NextResponse.json({ error: 'Work type names can\'t contain commas' }, { status: 400 });
    }
    if (name.length > 100) {
      return NextResponse.json({ error: 'Work type name must be 100 characters or fewer' }, { status: 400 });
    }

    const db = getPool();
    await db.query(
      `INSERT INTO work_types (name) VALUES ($1) ON CONFLICT ((LOWER(name))) DO NOTHING`,
      [name]
    );
    const { rows } = await db.query(
      `SELECT id, name FROM work_types WHERE LOWER(name) = LOWER($1)`,
      [name]
    );

    return NextResponse.json({ workType: rows[0] });
  } catch (err: unknown) {
    console.error('POST /api/work-types error:', err);
    return NextResponse.json({ error: 'Failed to add work type' }, { status: 500 });
  }
}
