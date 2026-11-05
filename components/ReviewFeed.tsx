'use client';

import React from 'react';
import { WorkerAssignment } from '@/types/schedule';
import { isTechActive, ReviewDayData, ReviewTimesheet, ReviewUser } from '@/types/review';
import { ReviewActions } from '@/hooks/useReviewActions';

const Spinner = () => (
  <span
    className="inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin align-[-2px]"
    aria-hidden="true"
  />
);

const clockTime = (iso: string) => {
  const m = iso.match(/T(\d{2}):(\d{2})/);
  if (!m) return '';
  const h = Number(m[1]);
  return `${h % 12 || 12}:${m[2]} ${h >= 12 ? 'PM' : 'AM'}`;
};

const formatDuration = (seconds: number) => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${String(m).padStart(2, '0')}m`;
};

const entryTimeLabel = (ts: ReviewTimesheet) => {
  if (ts.type === 'manual') return `Manual entry · ${formatDuration(ts.duration)}`;
  const start = clockTime(ts.start) || '—';
  if (ts.onTheClock || !ts.end) return `${start} – on the clock`;
  return `${start} – ${clockTime(ts.end)} · ${formatDuration(ts.duration)}`;
};

interface ReviewFeedProps {
  assignment: WorkerAssignment;
  date: string;
  data: ReviewDayData | null;
  loading: boolean;
  error: string | null;
  techIdByName: Record<string, string>;
  /** QB jobcode id for assignment.job, when known */
  jobId?: string;
  actions: ReviewActions;
  onRefresh: () => void;
}

const ReviewFeed: React.FC<ReviewFeedProps> = ({
  assignment, date, data, loading, error, techIdByName, jobId, actions, onRefresh,
}) => {
  const floor = assignment.floor?.trim();
  const workType = assignment.workType?.trim();

  const matchesJob = (ts: ReviewTimesheet) => (
    jobId
      ? ts.jobcodeId === jobId
      : !!ts.jobName && ts.jobName.toLowerCase() === assignment.job.trim().toLowerCase()
  );

  return (
    <div className="mt-1 border-t border-dashed border-gray-300 pt-2 space-y-2">
      {/* Schedule notes */}
      <div className="flex items-start justify-between gap-2">
        <div className="text-xs text-gray-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
          <span className="font-semibold">Schedule notes:</span>{' '}
          {floor || workType ? (
            <>Floor: {floor || '—'} · Work Type: {workType || '—'}</>
          ) : (
            <span className="text-gray-400">no floor / work type</span>
          )}
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="flex-shrink-0 text-xs text-blue-600 hover:text-blue-800 disabled:text-gray-400"
        >
          {loading ? <><Spinner /> Loading</> : '↻ Refresh'}
        </button>
      </div>

      {!date && <div className="text-xs text-gray-500">Set a date on this day to load time entries.</div>}
      {error && (
        <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1">{error}</div>
      )}
      {date && !data && loading && <div className="text-xs text-gray-500">Loading time entries…</div>}
      {assignment.workers.length === 0 && <div className="text-xs text-gray-500">No techs assigned.</div>}

      {data && assignment.workers.map(worker => {
        const userId = techIdByName[worker.trim().toLowerCase()];
        if (!userId) {
          return (
            <div key={worker} className="text-xs text-gray-500 border border-gray-200 rounded px-2 py-1.5 bg-white">
              <span className="font-semibold text-gray-700">{worker}</span> — not found in QuickBooks technicians
            </div>
          );
        }

        const user: ReviewUser = actions.overrides[userId] || data.users[userId] || {
          id: userId, name: worker, approvedTo: '', submittedTo: '', mobile: false, timeTracking: false,
        };
        const dayEntries = data.timesheets.filter(ts => ts.userId === userId);
        const jobEntries = dayEntries.filter(matchesJob);
        const otherJobCount = dayEntries.length - jobEntries.length;
        const anyOnClock = dayEntries.some(ts => ts.onTheClock);

        const approved = !!user.approvedTo && user.approvedTo >= date;
        const submitted = !!user.submittedTo && user.submittedTo >= date;
        const approvalPending = actions.pending[`approval:${userId}`];
        const statusPending = actions.pending[`status:${userId}`] === 'status';
        const active = isTechActive(user);

        const approveDisabled = !!approvalPending || approved || dayEntries.length === 0 || anyOnClock;
        const rejectDisabled = !!approvalPending || (!approved && !submitted);
        const approveTitle = approved
          ? 'Already approved'
          : dayEntries.length === 0
            ? 'No time entries for this day'
            : anyOnClock
              ? 'Tech is still on the clock'
              : 'Approve this tech\'s time for the day in QuickBooks';

        return (
          <div key={worker} className="border border-gray-200 rounded bg-white px-2 sm:px-3 py-2 space-y-1.5">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
              <span className="text-sm font-semibold text-gray-800">{worker}</span>
              <span className={`text-[11px] px-1.5 py-0.5 rounded-full font-medium ${
                approved ? 'bg-green-100 text-green-700'
                  : submitted ? 'bg-blue-100 text-blue-700'
                  : 'bg-gray-100 text-gray-600'
              }`}>
                {approved ? 'Approved' : submitted ? 'Submitted' : 'Not submitted'}
              </span>

              <div className="ml-auto flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => void actions.setApproval(user, date, 'approve')}
                  disabled={approveDisabled}
                  title={approveTitle}
                  className="px-2 py-1 text-xs rounded border border-green-600 text-green-700 hover:bg-green-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {approvalPending === 'approve' ? <><Spinner /> Approving</> : approved ? '✓ Approved' : 'Approve'}
                </button>
                <button
                  type="button"
                  onClick={() => void actions.setApproval(user, date, 'reject')}
                  disabled={rejectDisabled}
                  title={rejectDisabled && !approvalPending ? 'Nothing submitted to reject' : 'Send this day back to the tech'}
                  className="px-2 py-1 text-xs rounded border border-red-500 text-red-600 hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {approvalPending === 'reject' ? <><Spinner /> Rejecting</> : 'Reject'}
                </button>
                <button
                  type="button"
                  onClick={() => void actions.toggleTechStatus(user)}
                  disabled={statusPending}
                  aria-pressed={active}
                  title={active ? 'Time tracking ON — click to lock' : 'Time tracking OFF — click to activate'}
                  className={`inline-flex items-center gap-1 px-2 py-1 text-xs rounded text-white font-medium transition-colors disabled:cursor-wait ${
                    statusPending ? 'bg-gray-400' : active ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'
                  }`}
                >
                  {statusPending ? <><Spinner /> Updating…</> : <>Tech status: {active ? 'Active' : 'Locked'}</>}
                </button>
              </div>
            </div>

            {jobEntries.length === 0 ? (
              <div className="text-xs text-gray-500">
                No time entry for this job
                {otherJobCount > 0 && ` · ${otherJobCount} entr${otherJobCount === 1 ? 'y' : 'ies'} on other jobs`}
              </div>
            ) : (
              jobEntries.map(ts => (
                <div key={ts.id} className="space-y-1">
                  <div className="text-xs text-gray-700 font-medium">
                    {entryTimeLabel(ts)}
                    {otherJobCount > 0 && jobEntries[0].id === ts.id && (
                      <span className="text-gray-400 font-normal"> · +{otherJobCount} on other jobs</span>
                    )}
                  </div>
                  <div className={`text-xs whitespace-pre-wrap rounded border px-2 py-1 ${
                    ts.notes ? 'text-gray-800 bg-gray-50 border-gray-200' : 'text-gray-400 bg-gray-50 border-dashed border-gray-200'
                  }`}>
                    {ts.notes || 'No notes'}
                  </div>
                </div>
              ))
            )}
          </div>
        );
      })}
    </div>
  );
};

export default ReviewFeed;
