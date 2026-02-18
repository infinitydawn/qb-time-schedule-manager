import { Pool } from 'pg';
import fs from 'fs';
import path from 'path';

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    // CA cert: prefer env var (for Vercel), fall back to local file
    let ca: string | undefined = process.env.DB_CA_CERT;
    if (!ca) {
      const caPath = path.join(process.cwd(), 'ca.pem');
      if (fs.existsSync(caPath)) {
        ca = fs.readFileSync(caPath).toString();
      }
    }

    pool = new Pool({
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT) || 26276,
      database: process.env.DB_NAME || 'defaultdb',
      ssl: ca
        ? { rejectUnauthorized: true, ca }
        : { rejectUnauthorized: false },
      max: 5,
      idleTimeoutMillis: 30000,
    });

    // Allow connections to databases that use self-signed certificates
    // when no explicit CA cert is provided
    if (!ca) {
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    }
  }
  return pool;
}

/**
 * Initialise the database tables if they don't exist yet.
 * Safe to call on every cold-start – uses IF NOT EXISTS.
 */
export async function initDb(): Promise<void> {
  const db = getPool();

  await db.query(`
    CREATE TABLE IF NOT EXISTS schedules (
      id          TEXT PRIMARY KEY,
      date        TEXT NOT NULL DEFAULT '',
      day_name    TEXT NOT NULL DEFAULT '',
      sent_to_qb  BOOLEAN NOT NULL DEFAULT FALSE,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS project_managers (
      id          TEXT PRIMARY KEY,
      schedule_id TEXT NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
      name        TEXT NOT NULL DEFAULT '',
      sort_order  INT NOT NULL DEFAULT 0
    );
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS assignments (
      id          TEXT PRIMARY KEY,
      pm_id       TEXT NOT NULL REFERENCES project_managers(id) ON DELETE CASCADE,
      schedule_id TEXT NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
      workers     TEXT[] NOT NULL DEFAULT '{}',
      job         TEXT NOT NULL DEFAULT '',
      sort_order  INT NOT NULL DEFAULT 0
    );
  `);

  // Indexes for common lookups
  await db.query(`CREATE INDEX IF NOT EXISTS idx_pm_schedule ON project_managers(schedule_id);`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_assign_pm ON assignments(pm_id);`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_assign_schedule ON assignments(schedule_id);`);

  // Migration: add sent_to_qb column if it doesn't exist yet
  await db.query(`
    DO $$ BEGIN
      ALTER TABLE schedules ADD COLUMN sent_to_qb BOOLEAN NOT NULL DEFAULT FALSE;
    EXCEPTION WHEN duplicate_column THEN NULL;
    END $$;
  `);
}
