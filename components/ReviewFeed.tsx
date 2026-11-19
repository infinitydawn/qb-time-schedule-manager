'use client';

import React from 'react';
import { WorkerAssignment } from '@/types/schedule';
import { isTechActive, JobRef, ReviewDayData, ReviewTimesheet, ReviewUser, workDetailsFor } from '@/types/review';
import { ReviewActions } from '@/hooks/useReviewActions';
import TimesheetEditor, { newTimesheetDraft } from '@/components/TimesheetEditor';

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

const fmtDay = (d: string) => {
  const [y, m, day] = d.split('-').map(Number);
  return new Date(y, m - 1, day).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
};

const hhmmOf = (iso: string) => iso.match(/T(\d{2}:\d{2})/)?.[1] || '';

/** "HH:MM" + minutes, capped at 23:59 (entries stay on the same day) */
const addMinutes = (hhmm: string, minutes: number) => {
  const [h, m] = hhmm.split(':').map(Number);
  const total = Math.min(h * 60 + m + minutes, 23 * 60 + 59);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
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
  /** Active QB jobcodes, for the Timesheet Editor's job picker */
  jobs: JobRef[];
  actions: ReviewActions;
  onRefresh: () => void;
}

const ReviewFeed: React.FC<ReviewFeedProps> = ({
  assignment, date, data, loading, error, techIdByName, jobId, jobs, actions, onRefresh,
}) => {
  const [editing, setEditing] = React.useState<{ ts: ReviewTimesheet; techName: string; blockedReason?: string | null } | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 8000);
    return () => clearTimeout(t);
  }, [notice]);

  const handleSaved = (before: ReviewTimesheet, techName: string, updated: ReviewTimesheet) => {
    setEditing(null);
    const who = techName.split(' ')[0];
    if (!before.id) {
      setNotice(`Created ${who}'s time entry${updated.date !== date ? ` on ${fmtDay(updated.date)}` : ''}.`);
      actions.notifyTimesheetsChanged();
      return;
    }
    const movedJob = before.jobcodeId !== updated.jobcodeId;
    if (updated.date !== before.date) {
      setNotice(`Saved. ${who}'s entry moved to ${fmtDay(updated.date)}${movedJob ? ` (${updated.jobName || 'another job'})` : ''} — it now shows on that day.`);
    } else if (movedJob) {
      setNotice(`Saved. ${who}'s entry is now on ${updated.jobName || 'another job'}.`);
    } else {
      setNotice(`Saved ${who}'s time entry.`);
    }
    // Reload every open day card — the entry may have left this day or job
    actions.notifyTimesheetsChanged();
  };
  // From the QB schedule note sent to this job's techs (first tech found), else the app's values
  const firstTechId = assignment.workers.map(w => techIdByName[w.trim().toLowerCase()]).find(Boolean);
  const { floor, workType } = workDetailsFor(assignment, data?.scheduleEvents, jobId, firstTechId);

  const matchesJob = (ts: ReviewTimesheet) => (
    jobId
      ? ts.jobcodeId === jobId
      : !!ts.jobName && ts.jobName.toLowerCase() === assignment.job.trim().toLowerCase()
  );

  // Which techs have their "other jobs" list expanded, by QB user id
  const [otherOpen, setOtherOpen] = React.useState<Record<string, boolean>>({});
  const toggleOther = (userId: string) => setOtherOpen(prev => ({ ...prev, [userId]: !prev[userId] }));

  const otherJobsToggle = (userId: string, count: number, compact: boolean) => (
    <button
      type="button"
      onClick={() => toggleOther(userId)}
      aria-expanded={!!otherOpen[userId]}
      className="text-blue-600 hover:text-blue-800 hover:underline font-normal"
    >
      {otherOpen[userId] ? '▾' : '▸'}{' '}
      {compact ? `+${count} on other jobs` : `${count} entr${count === 1 ? 'y' : 'ies'} on other jobs`}
    </button>
  );

  const entryBlock = (ts: ReviewTimesheet, showJob: boolean, techName: string) => (
    <div key={ts.id} className="space-y-1">
      <div className="flex items-start justify-between gap-2">
        <div className="text-xs text-gray-700 font-medium">
          {showJob && <span className="text-gray-900">{ts.jobName || 'Unknown job'} · </span>}
          {entryTimeLabel(ts)}
        </div>
        <button
          type="button"
          onClick={() => setEditing({ ts, techName })}
          title={ts.state === 'APPROVED' || ts.state === 'SUBMITTED'
            ? `${ts.state === 'APPROVED' ? 'Approved' : 'Submitted'} — QuickBooks won't allow edits until the day is reopened`
            : 'Edit this time entry (times, date, job, notes)'}
          className="flex-shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 text-[11px] rounded border border-gray-300 text-gray-600 hover:border-blue-500 hover:text-blue-700 hover:bg-blue-50"
        >
          <svg viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3" aria-hidden="true">
            <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
          </svg>
          Edit
        </button>
      </div>
      <div className={`text-xs whitespace-pre-wrap rounded border px-2 py-1 ${
        ts.notes ? 'text-gray-800 bg-gray-50 border-gray-200' : 'text-gray-400 bg-gray-50 border-dashed border-gray-200'
      }`}>
        {ts.notes || 'No notes'}
      </div>
    </div>
  );

  return (
    <div className="mt-1 border-t border-dashed border-gray-300 pt-2 space-y-2">
      {/* Schedule notes */}
      <div className="flex items-start justify-between gap-2">
        <div className="text-xs text-gray-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
          <span className="font-semibold">Schedule notes:</span>{' '}
          {floor || workType ? (
            <>Floor: {floor || '—'} · Work Type{workType.includes(',') ? 's' : ''}: {workType || '—'}</>
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

      {notice && (
        <div role="status" className="flex items-start justify-between gap-2 text-xs text-green-800 bg-green-50 border border-green-200 rounded px-2 py-1">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss" className="text-green-700 hover:text-green-900">×</button>
        </div>
      )}

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
        const otherEntries = dayEntries.filter(ts => !matchesJob(ts));
        const otherJobCount = otherEntries.length;
        const anyOnClock = dayEntries.some(ts => ts.onTheClock);

        // Prefer QB's per-timesheet state (what QB Time's screens show); fall back to the
        // user-level approved_to / submitted_to dates for accounts that don't return it.
        const stateEntries = (jobEntries.length > 0 ? jobEntries : dayEntries).filter(ts => ts.state);
        const states = stateEntries.map(ts => ts.state);
        const approved = states.length > 0
          ? states.every(s => s === 'APPROVED')
          : !!user.approvedTo && user.approvedTo > date; // approved_to is exclusive
        const rejected = states.includes('REJECTED');
        const submitted = states.length > 0
          ? !rejected && states.every(s => s === 'SUBMITTED' || s === 'APPROVED')
          : !!user.submittedTo && user.submittedTo > date;
        const approvalPending = actions.pending[`approval:${userId}`];
        const statusPending = actions.pending[`status:${userId}`] === 'status';
        const active = isTechActive(user);

        // QB won't take new time inside a submitted / approved period (both dates are exclusive)
        const addBlockedReason = user.approvedTo > date
          ? `${worker}'s time is approved through this day in QuickBooks, so it won't accept a new entry. Unapprove and un-submit the day first.`
          : user.submittedTo > date
            ? `${worker}'s time is submitted through this day in QuickBooks, so it won't accept a new entry. The day has to be rejected / un-submitted first.`
            : null;

        // New entry: scheduled hours, or — when the tech already has time today — starting
        // where their last entry ended (any job), so a second block doesn't overlap.
        const lastEnd = dayEntries
          .filter(ts => !ts.onTheClock && ts.end.slice(0, 10) === date)
          .map(ts => hhmmOf(ts.end))
          .sort()
          .pop();
        const draftStart = lastEnd || assignment.startTime || '08:00';
        const scheduledEnd = assignment.endTime || '16:00';
        const draftEnd = lastEnd
          ? (scheduledEnd > addMinutes(lastEnd, 59) ? scheduledEnd : addMinutes(lastEnd, 60))
          : scheduledEnd;

        const addButton = (
          <button
            type="button"
            onClick={() => setEditing({
              techName: worker,
              ts: newTimesheetDraft({
                userId,
                date,
                jobcodeId: jobId,
                jobName: jobs.find(j => j.id === jobId)?.name || '',
                startTime: draftStart,
                endTime: draftEnd,
                // Same Service Item / Maintenance as the tech's other time that day, if any
                customfields: dayEntries[dayEntries.length - 1]?.customfields,
              }),
              blockedReason: addBlockedReason,
            })}
            title={addBlockedReason || `Create ${jobEntries.length > 0 ? 'another' : 'a'} time entry for ${worker} on this job`}
            className="ml-auto inline-flex items-center gap-1 px-1.5 py-0.5 text-[11px] rounded border border-blue-300 text-blue-700 hover:bg-blue-50"
          >
            + Add entry
          </button>
        );

        const approveDisabled = !!approvalPending || approved || dayEntries.length === 0 || anyOnClock;
        // Unapprove only makes sense on an approved day (or while one is in flight)
        const showUnapprove = approved || approvalPending === 'unapprove';
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
                  : rejected ? 'bg-red-100 text-red-700'
                  : submitted ? 'bg-blue-100 text-blue-700'
                  : 'bg-gray-100 text-gray-600'
              }`}>
                {approved ? 'Approved' : rejected ? 'Rejected' : submitted ? 'Submitted' : 'Not submitted'}
              </span>

              <div className="ml-auto flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={async () => { if (await actions.setApproval(user, date, 'approve')) onRefresh(); }}
                  disabled={approveDisabled}
                  title={approveTitle}
                  className="px-2 py-1 text-xs rounded border border-green-600 text-green-700 hover:bg-green-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {approvalPending === 'approve' ? <><Spinner /> Approving</> : approved ? '✓ Approved' : 'Approve'}
                </button>
                {showUnapprove && (
                  <button
                    type="button"
                    onClick={async () => { if (await actions.setApproval(user, date, 'unapprove')) onRefresh(); }}
                    disabled={!!approvalPending}
                    title="Unapprove this day in QuickBooks (it goes back to Submitted)"
                    className="px-2 py-1 text-xs rounded border border-red-500 text-red-600 hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {approvalPending === 'unapprove' ? <><Spinner /> Unapproving</> : 'Unapprove'}
                  </button>
                )}
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
              <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-gray-500">
                <span>No time entry for this job</span>
                {otherJobCount > 0 && <> · {otherJobsToggle(userId, otherJobCount, false)}</>}
                {addButton}
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-gray-500">
                  {otherJobCount > 0 && otherJobsToggle(userId, otherJobCount, true)}
                  {addButton}
                </div>
                {jobEntries.map(ts => entryBlock(ts, false, worker))}
              </>
            )}

            {otherJobCount > 0 && otherOpen[userId] && (
              <div className="ml-2 pl-2 border-l-2 border-blue-200 space-y-1.5">
                <div className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold">Other jobs today</div>
                {otherEntries.map(ts => entryBlock(ts, true, worker))}
              </div>
            )}
          </div>
        );
      })}

      {editing && (
        <TimesheetEditor
          timesheet={editing.ts}
          blockedReason={editing.blockedReason}
          techName={editing.techName}
          jobs={jobs}
          onClose={() => setEditing(null)}
          onSaved={updated => handleSaved(editing.ts, editing.techName, updated)}
        />
      )}
    </div>
  );
};

export default ReviewFeed;
