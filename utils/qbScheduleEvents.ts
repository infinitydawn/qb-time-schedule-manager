import { getQBHeaders, TSHEETS_BASE } from '@/utils/qbtoken';
import { parseWorkNotes } from '@/utils/workNotes';
import { ReviewScheduleEvent } from '@/types/review';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Same EST/EDT rule the rest of the app uses for schedule events.
const easternOffset = (date: string) => {
  const [yr, mo, da] = date.split('-').map(Number);
  if (mo > 3 && mo < 11) return '-04:00';
  if (mo === 3) {
    const firstDay = new Date(yr, 2, 1).getDay();
    const secondSun = firstDay === 0 ? 8 : 15 - firstDay;
    return da >= secondSun ? '-04:00' : '-05:00';
  }
  if (mo === 11) {
    const firstDay = new Date(yr, 10, 1).getDay();
    const firstSun = firstDay === 0 ? 1 : 8 - firstDay;
    return da < firstSun ? '-04:00' : '-05:00';
  }
  return '-05:00';
};

const toUserIds = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === 'number') return [String(value)];
  if (typeof value === 'string') return value.split(',').map(s => s.trim()).filter(Boolean);
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v === true || typeof v === 'string' || typeof v === 'number')
      .map(([k, v]) => (v === true ? k : String(v)));
  }
  return [];
};

/**
 * Read-only: every QB schedule event on `date` (one row per assigned tech instance),
 * with Floor / Work Type parsed from its notes.
 */
export async function fetchScheduleEventsForDate(date: string): Promise<ReviewScheduleEvent[]> {
  const headers = getQBHeaders();
  const calRes = await fetch(`${TSHEETS_BASE}/schedule_calendars`, { headers });
  const calData = await calRes.json().catch(() => ({}));
  const calIds = Object.keys(calData.results?.schedule_calendars || {});
  if (calIds.length === 0) return [];

  const offset = easternOffset(date);
  const out: ReviewScheduleEvent[] = [];
  let page = 1;
  let more = true;
  while (more) {
    const params = new URLSearchParams({
      schedule_calendar_ids: calIds.join(','),
      start: `${date}T00:00:00${offset}`,
      end: `${date}T23:59:59${offset}`,
      active: 'both',
      team_events: 'instance',
      limit: '200',
      page: String(page),
    });
    const res = await fetch(`${TSHEETS_BASE}/schedule_events?${params}`, { headers });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`QuickBooks schedule_events error ${res.status}`);

    for (const e of Object.values(data.results?.schedule_events || {}) as any[]) {
      const work = parseWorkNotes(e.notes);
      out.push({
        id: String(e.id),
        location: (e.location || '').trim(),
        jobcodeId: e.jobcode_id ? String(e.jobcode_id) : '',
        start: e.start || '',
        userIds: toUserIds(e.assigned_user_ids),
        floor: work?.floor || '',
        workType: work?.workType || '',
      });
    }
    more = !!data.more;
    page++;
  }
  return out;
}
