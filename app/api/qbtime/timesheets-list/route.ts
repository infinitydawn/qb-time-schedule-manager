import { NextRequest, NextResponse } from 'next/server';
import { getQBHeaders, TSHEETS_BASE } from '@/utils/qbtoken';

export async function POST(req: NextRequest) {
  try {
    const { start_date, end_date, limit } = (await req.json()) as {
      start_date?: string;
      end_date?: string;
      limit?: number;
    };

    const headers = getQBHeaders();

    // Build query params
    const params = new URLSearchParams();
    // start_date is required by TSheets — default to 30 days ago
    const defaultStart = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    params.set('start_date', start_date || defaultStart);
    if (end_date) params.set('end_date', end_date);
    params.set('limit', String(limit || 10));

    const url = `${TSHEETS_BASE}/timesheets?${params.toString()}`;
    console.log('[timesheets-debug] Fetching:', url);

    const res = await fetch(url, { headers });
    const data = await res.json();

    if (!res.ok) {
      return NextResponse.json(
        { error: `TSheets error: ${res.status}`, details: data },
        { status: res.status }
      );
    }

    const rawTimesheets = data.results?.timesheets || {};
    const timesheets = Object.values(rawTimesheets).map((ts: any) => ({
      id: ts.id,
      user_id: ts.user_id,
      jobcode_id: ts.jobcode_id,
      type: ts.type,
      start: ts.start,
      end: ts.end,
      date: ts.date,
      duration: ts.duration,
      notes: ts.notes || '',
      customfields: ts.customfields || {},
    }));

    // Also return supplemental data (users, jobcodes) for context
    const suppUsers = data.supplemental_data?.users || {};
    const suppJobcodes = data.supplemental_data?.jobcodes || {};

    return NextResponse.json({
      timesheets,
      total: timesheets.length,
      users: Object.values(suppUsers).map((u: any) => ({
        id: u.id,
        name: `${u.first_name} ${u.last_name}`,
      })),
      jobcodes: Object.values(suppJobcodes).map((j: any) => ({
        id: j.id,
        name: j.name,
      })),
    });
  } catch (err: any) {
    console.error('QB Time Timesheets List API error:', err);
    return NextResponse.json(
      { error: err.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
