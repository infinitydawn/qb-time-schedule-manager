import { NextRequest, NextResponse } from 'next/server';
import { getQBHeaders, TSHEETS_BASE } from '@/utils/qbtoken';
import { dayAfter, fetchUsersByIds, updateUser } from '@/utils/qbUsers';

/* eslint-disable @typescript-eslint/no-explicit-any */

// ─── POST /api/qbtime/approval  { userId, date, action: 'approve' | 'unapprove' } ───
// QuickBooks Time approves per user up to a date via users.approved_to / submitted_to.
// Observed on this account (Nov 2026): the boundary is EXCLUSIVE — with
// approved_to = D, timesheets dated D are still unapproved and D-1 is APPROVED.
// QB Time's own Approve writes the day after the last approved day. So:
//   approve D → approved_to (and submitted_to, if earlier) = D+1.
//               Any earlier unapproved days for that tech are approved too.
//   unapprove D → approved_to moved back to D (if it was past it). submitted_to is left
//               alone, so D (and any later approved days) go back to SUBMITTED —
//               the same as "Unapprove" in QB Time.
// Afterwards the day's timesheets are re-read and their per-timesheet `state`
// (what QB Time's screens show) must agree before we report success.

async function fetchDayStates(userId: string, date: string): Promise<string[]> {
  const params = new URLSearchParams({
    start_date: date,
    end_date: date,
    user_ids: userId,
    on_the_clock: 'both',
    supplemental_data: 'no',
  });
  const res = await fetch(`${TSHEETS_BASE}/timesheets?${params}`, { headers: getQBHeaders() });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return [];
  return (Object.values(data.results?.timesheets || {}) as any[])
    .map(ts => (typeof ts.state === 'string' ? ts.state.toUpperCase() : ''))
    .filter(Boolean);
}

export async function POST(req: NextRequest) {
  try {
    const { userId, date, action } = (await req.json()) as {
      userId?: string;
      date?: string;
      action?: 'approve' | 'unapprove';
    };

    if (!userId || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || (action !== 'approve' && action !== 'unapprove')) {
      return NextResponse.json({ error: 'userId, date (YYYY-MM-DD) and action (approve|unapprove) are required' }, { status: 400 });
    }

    const before = (await fetchUsersByIds([userId]))[userId];
    if (!before) {
      return NextResponse.json({ error: `User ${userId} not found in QuickBooks Time` }, { status: 404 });
    }

    const next = dayAfter(date);
    const update: Record<string, unknown> = { id: Number(userId) };
    if (action === 'approve') {
      if (!before.submittedTo || before.submittedTo < next) update.submitted_to = next;
      if (!before.approvedTo || before.approvedTo < next) update.approved_to = next;
    } else {
      if (before.approvedTo && before.approvedTo > date) update.approved_to = date;
    }

    if (Object.keys(update).length > 1) {
      await updateUser(update);
    }

    const after = (await fetchUsersByIds([userId]))[userId];
    const states = await fetchDayStates(userId, date);

    // Prefer the per-timesheet state; fall back to the user's date when QB doesn't return it.
    const approved = states.length > 0
      ? states.every(s => s === 'APPROVED')
      : !!after?.approvedTo && after.approvedTo > date;
    const confirmed = action === 'approve' ? approved : !states.includes('APPROVED') && !approved;

    if (!confirmed) {
      return NextResponse.json(
        {
          error: `QuickBooks did not confirm the ${action}. Timesheet status: ${states.join(', ') || 'none'}; approved_to: ${after?.approvedTo || 'none'}`,
          user: after,
          states,
        },
        { status: 409 }
      );
    }

    return NextResponse.json({ ok: true, user: after, states });
  } catch (err: unknown) {
    console.error('QB Time Approval API error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
