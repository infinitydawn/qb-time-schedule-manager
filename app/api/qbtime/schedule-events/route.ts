import { NextRequest, NextResponse } from 'next/server';

const TSHEETS_BASE = 'https://rest.tsheets.com/api/v1';

export async function POST(req: NextRequest) {
  try {
    const { token, start, end, schedule_calendar_ids } = (await req.json()) as {
      token: string;
      start?: string;
      end?: string;
      schedule_calendar_ids?: string;
    };

    if (!token) {
      return NextResponse.json({ error: 'API token is required' }, { status: 400 });
    }

    const headers = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    };

    // First fetch schedule calendars to get their IDs (required param)
    const calRes = await fetch(`${TSHEETS_BASE}/schedule_calendars`, { headers });
    const calData = await calRes.json();
    const rawCals = calData.results?.schedule_calendars || {};
    const calIds = Object.keys(rawCals);
    console.log('[schedule-events] Found calendars:', calIds, Object.values(rawCals).map((c: any) => c.name));

    if (calIds.length === 0) {
      return NextResponse.json({ error: 'No schedule calendars found', events: [], total: 0 });
    }

    const params = new URLSearchParams();
    params.set('start', start || '2026-02-13T00:00:00-05:00');
    if (end) params.set('end', end);
    params.set('schedule_calendar_ids', schedule_calendar_ids || calIds.join(','));
    params.set('limit', '200');
    params.set('active', 'both');
    params.set('team_events', 'instance');

    const url = `${TSHEETS_BASE}/schedule_events?${params.toString()}`;
    console.log('[schedule-events] Fetching:', url);

    const res = await fetch(url, { headers });
    const data = await res.json();
    console.log('[schedule-events] Response status:', res.status);
    // Log first raw event to see ALL fields TSheets returns
    const rawEvents = data.results?.schedule_events || {};
    const rawEventsList = Object.values(rawEvents);
    if (rawEventsList.length > 0) {
      console.log('[schedule-events] Raw first event (all keys):', JSON.stringify(rawEventsList[0], null, 2));
    }

    if (!res.ok) {
      return NextResponse.json(
        { error: `TSheets error: ${res.status}`, details: data },
        { status: res.status }
      );
    }

    // Return the FULL raw event objects so nothing is lost
    const events = rawEventsList.map((ev: any) => ({
      ...ev,
      customfields: ev.customfields || {},
    }));

    const suppUsers = data.supplemental_data?.users || {};
    const suppJobcodes = data.supplemental_data?.jobcodes || {};
    const suppCalendars = data.supplemental_data?.schedule_calendars || {};

    return NextResponse.json({
      events,
      total: events.length,
      users: Object.values(suppUsers).map((u: any) => ({
        id: u.id,
        name: `${u.first_name} ${u.last_name}`,
      })),
      jobcodes: Object.values(suppJobcodes).map((j: any) => ({
        id: j.id,
        name: j.name,
      })),
      calendars: Object.values(suppCalendars).map((c: any) => ({
        id: c.id,
        name: c.name,
      })),
    });
  } catch (err: any) {
    console.error('QB Time Schedule Events API error:', err);
    return NextResponse.json(
      { error: err.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
