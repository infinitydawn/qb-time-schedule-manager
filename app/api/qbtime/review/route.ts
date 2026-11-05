import { NextRequest, NextResponse } from 'next/server';
import { getQBHeaders, TSHEETS_BASE } from '@/utils/qbtoken';
import { fetchUsersByIds } from '@/utils/qbUsers';
import { ReviewDayData, ReviewTimesheet } from '@/types/review';

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
      return NextResponse.json({ date, timesheets: [], users: {} } satisfies ReviewDayData);
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
    return NextResponse.json({ date, timesheets, users } satisfies ReviewDayData);
  } catch (err: unknown) {
    console.error('QB Time Review API error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
