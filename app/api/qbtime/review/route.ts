import { NextRequest, NextResponse } from 'next/server';
import { getQBHeaders, TSHEETS_BASE } from '@/utils/qbtoken';
import { fetchUsersByIds } from '@/utils/qbUsers';
import { ReviewDayData, ReviewScheduleEvent, ReviewTimesheet } from '@/types/review';
import { fetchScheduleEventsForDate } from '@/utils/qbScheduleEvents';

/* eslint-disable @typescript-eslint/no-explicit-any */

// ─── POST /api/qbtime/review  { date, userIds } ─────────────────────
// Read-only: returns every timesheet for the given techs on that date, plus each
// tech's approval state (approved_to / submitted_to) and mobile/time-tracking status.
export async function POST(req: NextRequest) {
  try {
    const { date, userIds } = (await req.json()) as { date?: string; userIds?: string[] };

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: 'A valid date (YYYY-MM-DD) is required' }, { status: 400 });
    }
    const ids = [...new Set((userIds || []).map(String).filter(Boolean))];
    if (ids.length === 0) {
      return NextResponse.json({ date, timesheets: [], users: {}, scheduleEvents: [] } satisfies ReviewDayData);
    }

    const headers = getQBHeaders();
    const timesheets: ReviewTimesheet[] = [];
    const jobcodeNames: Record<string, string> = {};

    for (let i = 0; i < ids.length; i += 50) {
      const chunk = ids.slice(i, i + 50);
      let page = 1;
      let more = true;
      while (more) {
        const params = new URLSearchParams({
          start_date: date,
          end_date: date,
          user_ids: chunk.join(','),
          on_the_clock: 'both',
          limit: '200',
          page: String(page),
        });
        const res = await fetch(`${TSHEETS_BASE}/timesheets?${params}`, { headers });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          return NextResponse.json(
            { error: `QuickBooks timesheets error ${res.status}: ${data?.error?.message || JSON.stringify(data)}` },
            { status: 502 }
          );
        }

        for (const j of Object.values(data.supplemental_data?.jobcodes || {}) as any[]) {
          jobcodeNames[String(j.id)] = j.name;
        }
        for (const ts of Object.values(data.results?.timesheets || {}) as any[]) {
          timesheets.push({
            id: String(ts.id),
            userId: String(ts.user_id),
            jobcodeId: String(ts.jobcode_id ?? ''),
            jobName: '',
            date: ts.date,
            type: ts.type,
            start: ts.start || '',
            end: ts.end || '',
            onTheClock: !!ts.on_the_clock,
            // Undocumented per-timesheet approval state (e.g. SUBMITTED / APPROVED); read-only via API
            state: typeof ts.state === 'string' ? ts.state.toUpperCase() : '',
            duration: Number(ts.duration) || 0,
            notes: ts.notes || '',
          });
        }
        more = !!data.more;
        page++;
      }
    }

    for (const ts of timesheets) ts.jobName = jobcodeNames[ts.jobcodeId] || '';
    timesheets.sort((a, b) => (a.start || '').localeCompare(b.start || ''));

    const users = await fetchUsersByIds(ids);

    // Schedule notes (Floor / Work Type) come from QB's schedule events; don't fail the
    // whole review if they can't be loaded.
    let scheduleEvents: ReviewScheduleEvent[] | undefined;
    try {
      scheduleEvents = await fetchScheduleEventsForDate(date);
    } catch (err) {
      console.error('[review] schedule events failed', err);
    }

    return NextResponse.json({ date, timesheets, users, scheduleEvents } satisfies ReviewDayData);
  } catch (err: unknown) {
    console.error('QB Time Review API error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
