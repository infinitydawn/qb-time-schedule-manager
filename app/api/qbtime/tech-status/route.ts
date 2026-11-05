import { NextRequest, NextResponse } from 'next/server';
import { fetchUsersByIds, updateUser } from '@/utils/qbUsers';
import { isTechActive } from '@/types/review';

// ─── POST /api/qbtime/tech-status  { userId, enable } ───────────────
// Same change as the qb-time-tech-disable-mobile-tracking CLI: toggles the tech's
// `mobile` and `time_tracking` permissions together, then re-reads the user to
// confirm the new state before responding.
export async function POST(req: NextRequest) {
  try {
    const { userId, enable } = (await req.json()) as { userId?: string; enable?: boolean };

    if (!userId || typeof enable !== 'boolean') {
      return NextResponse.json({ error: 'userId and enable (boolean) are required' }, { status: 400 });
    }

    const before = (await fetchUsersByIds([userId]))[userId];
    if (!before) {
      return NextResponse.json({ error: `User ${userId} not found in QuickBooks Time` }, { status: 404 });
    }

    if (before.timeTracking !== enable || (enable && !before.mobile)) {
      await updateUser({
        id: Number(userId),
        permissions: { mobile: enable, time_tracking: enable },
      });
    }

    const after = (await fetchUsersByIds([userId]))[userId];
    const active = isTechActive(after);
    if (!after || active !== enable) {
      return NextResponse.json(
        { error: `QuickBooks did not confirm the change (mobile: ${after?.mobile}, time_tracking: ${after?.timeTracking})`, user: after },
        { status: 409 }
      );
    }

    return NextResponse.json({ ok: true, active, user: after });
  } catch (err: unknown) {
    console.error('QB Time Tech Status API error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
