import { NextRequest, NextResponse } from 'next/server';
import { getQBHeaders, TSHEETS_BASE } from '@/utils/qbtoken';

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
}

export async function POST(req: NextRequest) {
  try {
    const { entries } = (await req.json()) as {
      entries: ScheduleEventEntry[];
    };

    if (!entries || entries.length === 0) {
      return NextResponse.json({ error: 'No schedule event entries provided' }, { status: 400 });
    }

    const headers = getQBHeaders();

    // --- Step 1: Fetch schedule calendar ID ---
    const calRes = await fetch(`${TSHEETS_BASE}/schedule_calendars`, { headers });
    const calData = await calRes.json();
    const rawCals = calData.results?.schedule_calendars || {};
    const calIds = Object.keys(rawCals);

    console.log('[create-schedule-events] Found calendars:', calIds,
      Object.values(rawCals).map((c: any) => c.name));

    if (calIds.length === 0) {
      return NextResponse.json(
        { error: 'No schedule calendars found in your QB Time account' },
        { status: 400 }
      );
    }

    const scheduleCalendarId = Number(calIds[0]);

    // --- Step 2: Attach schedule_calendar_id to each entry ---
    const eventsToCreate = entries.map((entry) => ({
      schedule_calendar_id: scheduleCalendarId,
      ...entry,
      draft: entry.draft ?? false,
    }));

    console.log('[create-schedule-events] Sending events:',
      JSON.stringify(eventsToCreate, null, 2));

    // --- Step 3: POST to TSheets schedule_events ---
    const BATCH_SIZE = 50;
    const results: any[] = [];
    const errors: any[] = [];

    for (let i = 0; i < eventsToCreate.length; i += BATCH_SIZE) {
      const batch = eventsToCreate.slice(i, i + BATCH_SIZE);

      const res = await fetch(`${TSHEETS_BASE}/schedule_events`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ data: batch }),
      });

      const data = await res.json();
      console.log('[create-schedule-events] TSheets response:', res.status,
        JSON.stringify(data, null, 2));

      if (!res.ok) {
        errors.push({
          batch: i / BATCH_SIZE + 1,
          status: res.status,
          error: data,
        });
        continue;
      }

      const events = data.results?.schedule_events || {};
      for (const [key, ev] of Object.entries(events) as [string, any][]) {
        if (ev._status_code === 200 || ev._status_code === 201) {
          results.push({
            id: ev.id,
            title: ev.title,
            assigned_user_ids: ev.assigned_user_ids,
            status: 'ok',
          });
        } else {
          errors.push({
            key,
            status: ev._status_code,
            message: ev._status_message,
            extra: ev._status_extra,
          });
        }
      }
    }

    return NextResponse.json({
      created: results.length,
      failed: errors.length,
      results,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err: any) {
    console.error('QB Time Create Schedule Events API error:', err);
    return NextResponse.json(
      { error: err.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
