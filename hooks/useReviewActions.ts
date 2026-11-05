'use client';

import { useCallback, useState } from 'react';
import { isTechActive, ReviewUser } from '@/types/review';
import { appAlert, appConfirm } from '@/utils/dialog';

export type ApprovalAction = 'approve' | 'unapprove';
export type PendingAction = ApprovalAction | 'status';

export interface ReviewActions {
  /** Latest QB-confirmed user state from actions taken this session (shared by all day cards). */
  overrides: Record<string, ReviewUser>;
  /** Keys: `approval:<userId>` and `status:<userId>` */
  pending: Record<string, PendingAction>;
  /** Resolves true when a request was sent to QB (so callers can re-read timesheet states). */
  setApproval: (user: ReviewUser, date: string, action: ApprovalAction) => Promise<boolean>;
  toggleTechStatus: (user: ReviewUser) => Promise<void>;
}

const fmtDate = (d: string) => {
  const [y, m, day] = d.split('-').map(Number);
  return new Date(y, m - 1, day).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
};

const shiftDate = (date: string, days: number) => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
};
const dayBefore = (date: string) => shiftDate(date, -1);
const dayAfter = (date: string) => shiftDate(date, 1);

export const useReviewActions = (): ReviewActions => {
  const [overrides, setOverrides] = useState<Record<string, ReviewUser>>({});
  const [pending, setPending] = useState<Record<string, PendingAction>>({});

  const startPending = (key: string, action: PendingAction) =>
    setPending(prev => ({ ...prev, [key]: action }));
  const endPending = (key: string) =>
    setPending(prev => {
      const next = { ...prev };
      delete next[key];
      return next;
    });

  const setApproval = useCallback(async (user: ReviewUser, date: string, action: ApprovalAction) => {
    const key = `approval:${user.id}`;

    // QB approves per tech *up to a date* — spell out side effects before acting.
    // user.approvedTo is exclusive: days before it are approved, that day itself is not.
    if (action === 'approve' && (!user.approvedTo || user.approvedTo < date)) {
      const earlier = user.approvedTo
        ? (user.approvedTo === dayBefore(date)
          ? `their unapproved time on ${fmtDate(user.approvedTo)}`
          : `any of their unapproved time from ${fmtDate(user.approvedTo)} to ${fmtDate(dayBefore(date))}`)
        : 'all of their earlier unapproved time';
      if (!(await appConfirm(
        `QuickBooks approves time up to a date.\n\nApproving ${user.name} for ${fmtDate(date)} will also approve ${earlier}.\n\nContinue?`,
        { title: 'Approve time', confirmLabel: 'Approve' }
      ))) return false;
    }
    if (action === 'unapprove') {
      const alsoLater = !!user.approvedTo && user.approvedTo > dayAfter(date);
      if (!(await appConfirm(
        `Unapprove ${user.name}'s time for ${fmtDate(date)}?\n\nThat day${alsoLater ? ` and every later approved day through ${fmtDate(dayBefore(user.approvedTo))}` : ''} goes back to Submitted in QuickBooks.`,
        { title: 'Unapprove time', confirmLabel: 'Unapprove', danger: true }
      ))) return false;
    }

    startPending(key, action);
    try {
      const res = await fetch('/api/qbtime/approval', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, date, action }),
      });
      const data = await res.json();
      if (data.user) setOverrides(prev => ({ ...prev, [user.id]: data.user }));
      if (!res.ok) void appAlert(data.error || `Failed to ${action} time entry`);
    } catch (err) {
      void appAlert(err instanceof Error ? err.message : `Failed to ${action} time entry`);
    } finally {
      endPending(key);
    }
    return true;
  }, []);

  const toggleTechStatus = useCallback(async (user: ReviewUser) => {
    const key = `status:${user.id}`;
    const enable = !isTechActive(user);
    startPending(key, 'status');
    try {
      const res = await fetch('/api/qbtime/tech-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, enable }),
      });
      const data = await res.json();
      if (data.user) setOverrides(prev => ({ ...prev, [user.id]: data.user }));
      if (!res.ok) void appAlert(data.error || `Failed to ${enable ? 'activate' : 'deactivate'} ${user.name}`);
    } catch (err) {
      void appAlert(err instanceof Error ? err.message : `Failed to ${enable ? 'activate' : 'deactivate'} ${user.name}`);
    } finally {
      endPending(key);
    }
  }, []);

  return { overrides, pending, setApproval, toggleTechStatus };
};
