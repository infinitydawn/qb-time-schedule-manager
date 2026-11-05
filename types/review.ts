export type AppMode = 'schedule' | 'review';

export interface TechRef {
  id: string;
  name: string;
}

export interface JobRef {
  id: string;
  name: string;
}

export interface ReviewTimesheet {
  id: string;
  userId: string;
  jobcodeId: string;
  jobName: string;
  date: string;
  type: string; // 'regular' | 'manual'
  start: string;
  end: string;
  onTheClock: boolean;
  /** QB Time's per-timesheet approval state, e.g. SUBMITTED / APPROVED ('' if not returned) */
  state: string;
  duration: number; // seconds
  notes: string;
}

export interface ReviewUser {
  id: string;
  name: string;
  /** QB Time approves per user up to and including this date (YYYY-MM-DD) */
  approvedTo: string;
  submittedTo: string;
  mobile: boolean;
  timeTracking: boolean;
}

/** A QB schedule event instance on the review date, with Floor / Work Type parsed from its notes */
export interface ReviewScheduleEvent {
  id: string;
  location: string;
  jobcodeId: string;
  start: string;
  userIds: string[];
  floor: string;
  workType: string;
}

export interface ReviewDayData {
  date: string;
  timesheets: ReviewTimesheet[];
  users: Record<string, ReviewUser>;
  /** QB schedule events that day (may be missing if they couldn't be loaded) */
  scheduleEvents?: ReviewScheduleEvent[];
}

const hhmm = (iso?: string) => iso?.match(/T(\d{2}:\d{2})/)?.[1] || '';

/**
 * Floor / Work Type for one tech on one job, from the QB schedule note that tech was sent
 * (event at the same address/jobcode that lists the tech), falling back to the values
 * stored on the assignment in this app.
 */
export function workDetailsFor(
  assignment: { job: string; startTime?: string; floor?: string; workType?: string },
  events: ReviewScheduleEvent[] | undefined,
  jobId: string | undefined,
  userId?: string
): { floor: string; workType: string } {
  const job = assignment.job.trim().toLowerCase();
  const atJob = (events || []).filter(e =>
    (!userId || e.userIds.includes(userId)) &&
    ((jobId && e.jobcodeId === jobId) || (!!e.location && e.location.toLowerCase() === job))
  );
  const withNotes = atJob.filter(e => e.floor || e.workType);
  const best = withNotes.find(e => hhmm(e.start) === (assignment.startTime || '08:00')) || withNotes[0];
  return {
    floor: best?.floor || assignment.floor?.trim() || '',
    workType: best?.workType || assignment.workType?.trim() || '',
  };
}

/**
 * Tech "status" follows the time_tracking permission. The toggle sends mobile and
 * time_tracking together (like the CLI), but QB was observed to keep `mobile: true`
 * after a PUT of false, while time_tracking=false is what actually blocks clocking in.
 */
export const isTechActive = (u?: Pick<ReviewUser, 'timeTracking'>) =>
  !!u && u.timeTracking;
