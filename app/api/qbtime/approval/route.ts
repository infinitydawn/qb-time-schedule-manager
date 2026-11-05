import { NextRequest, NextResponse } from 'next/server';
import { dayBefore, fetchUsersByIds, updateUser } from '@/utils/qbUsers';

// ─── POST /api/qbtime/approval  { userId, date, action: 'approve' | 'reject' } ───
// QuickBooks Time approves time per user *up to a date* (users.approved_to), not per
// timesheet. So:
//   approve → approved_to = date (and submitted_to = date if it was earlier).
//             Any earlier unapproved days for that tech are approved too.
//   reject  → approved_to / submitted_to moved back to the day before `date`, which
//             sends that day (and any later approved days) back to the tech.
// After the update the user is re-read from QB and the confirmed state is returned.
export async function POST(req: NextRequest) {
  try {
    const { userId, date, action } = (await req.json()) as {
      userId?: string;
      date?: string;
      action?: 'approve' | 'reject';
    };

    if (!userId || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || (action !== 'approve' && action !== 'reject')) {
      return NextResponse.json({ error: 'userId, date (YYYY-MM-DD) and action (approve|reject) are required' }, { status: 400 });
    }

    const before = (await fetchUsersByIds([userId]))[userId];
    if (!before) {
      return NextResponse.json({ error: `User ${userId} not found in QuickBooks Time` }, { status: 404 });
    }

    const update: Record<string, unknown> = { id: Number(userId) };
    if (action === 'approve') {
      if (!before.submittedTo || before.submittedTo < date) update.submitted_to = date;
      if (!before.approvedTo || before.approvedTo < date) update.approved_to = date;
    } else {
      const prev = dayBefore(date);
      if (before.approvedTo && before.approvedTo >= date) update.approved_to = prev;
      if (before.submittedTo && before.submittedTo >= date) update.submitted_to = prev;
    }

    if (Object.keys(update).length > 1) {
      await updateUser(update);
    }

    const after = (await fetchUsersByIds([userId]))[userId];
    const approved = !!after?.approvedTo && after.approvedTo >= date;
    const confirmed = action === 'approve' ? approved : !approved;

    if (!confirmed) {
      return NextResponse.json(
        { error: `QuickBooks did not confirm the ${action}. Current approved_to: ${after?.approvedTo || 'none'}`, user: after },
        { status: 409 }
      );
    }

    return NextResponse.json({ ok: true, user: after });
  } catch (err: unknown) {
    console.error('QB Time Approval API error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
