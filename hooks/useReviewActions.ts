'use client';

import { useCallback, useState } from 'react';
import { isTechActive, ReviewUser } from '@/types/review';

export type PendingAction = 'approve' | 'reject' | 'status';

export interface ReviewActions {
  /** Latest QB-confirmed user state from actions taken this session (shared by all day cards). */
  overrides: Record<string, ReviewUser>;
  /** Keys: `approval:<userId>` and `status:<userId>` */
  pending: Record<string, PendingAction>;
  setApproval: (user: ReviewUser, date: string, action: 'approve' | 'reject') => Promise<void>;
  toggleTechStatus: (user: ReviewUser) => Promise<void>;
}

const fmtDate = (d: string) => {
  const [y, m, day] = d.split('-').map(Number);
  return new Date(y, m - 1, day).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
};

const dayBefore = (date: string) => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
};

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

  const setApproval = useCallback(async (user: ReviewUser, date: string, action: 'approve' | 'reject') => {
    const key = `approval:${user.id}`;

    // QB approves per tech *up to a date* — spell out side effects before acting.
    if (action === 'approve' && user.approvedTo && user.approvedTo < dayBefore(date)) {
      if (!window.confirm(
        `QuickBooks approves time up to a date.\n\nApproving ${user.name} for ${fmtDate(date)} will also approve any of their unapproved time after ${fmtDate(user.approvedTo)}.\n\nContinue?`
      )) return;
    }
    if (action === 'reject') {
      const alsoLater = user.approvedTo && user.approvedTo > date;
      if (!window.confirm(
        `Reject ${user.name}'s time for ${fmtDate(date)}?\n\nThis un-approves and un-submits that day${alsoLater ? ` and every later day through ${fmtDate(user.approvedTo)}` : ''}, sending it back to the tech.`
      )) return;
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
      if (!res.ok) alert(data.error || `Failed to ${action} time entry`);
    } catch (err) {
      alert(err instanceof Error ? err.message : `Failed to ${action} time entry`);
    } finally {
      endPending(key);
    }
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
      if (!res.ok) alert(data.error || `Failed to ${enable ? 'activate' : 'deactivate'} ${user.name}`);
    } catch (err) {
      alert(err instanceof Error ? err.message : `Failed to ${enable ? 'activate' : 'deactivate'} ${user.name}`);
    } finally {
      endPending(key);
    }
  }, []);

  return { overrides, pending, setApproval, toggleTechStatus };
};
