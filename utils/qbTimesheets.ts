import { ReviewTimesheet } from '@/types/review';

/* eslint-disable @typescript-eslint/no-explicit-any */

const METERS_PER_MILE = 1609.344;

/** Map a raw TSheets timesheet object to the shape the review UI uses. */
export function mapTimesheet(ts: any, jobcodeNames: Record<string, string> = {}): ReviewTimesheet {
  const meters = Number(ts.distance_tracking?.manual_meters ?? ts.distance_tracking?.calculated_meters);
  const customfields: Record<string, string> = {};
  for (const [k, v] of Object.entries(ts.customfields || {})) customfields[k] = v == null ? '' : String(v);
  const jobcodeId = String(ts.jobcode_id ?? '');
  return {
    id: String(ts.id),
    userId: String(ts.user_id),
    jobcodeId,
    jobName: jobcodeNames[jobcodeId] || '',
    date: ts.date,
    type: ts.type,
    start: ts.start || '',
    end: ts.end || '',
    onTheClock: !!ts.on_the_clock,
    // Undocumented per-timesheet approval state (e.g. SUBMITTED / APPROVED); read-only via API
    state: typeof ts.state === 'string' ? ts.state.toUpperCase() : '',
    duration: Number(ts.duration) || 0,
    notes: ts.notes || '',
    customfields,
    tzStr: ts.tz_str || '',
    locked: !!Number(ts.locked),
    miles: Number.isFinite(meters) && meters > 0 ? Math.round((meters / METERS_PER_MILE) * 100) / 100 : null,
  };
}

/** Collect jobcode id → name from a TSheets response's supplemental data. */
export function jobcodeNamesFrom(data: any, into: Record<string, string> = {}) {
  for (const j of Object.values(data?.supplemental_data?.jobcodes || {}) as any[]) {
    into[String(j.id)] = j.name;
  }
  return into;
}
