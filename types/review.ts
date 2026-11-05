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

export interface ReviewDayData {
  date: string;
  timesheets: ReviewTimesheet[];
  users: Record<string, ReviewUser>;
}

/**
 * Tech "status" follows the time_tracking permission. The toggle sends mobile and
 * time_tracking together (like the CLI), but QB was observed to keep `mobile: true`
 * after a PUT of false, while time_tracking=false is what actually blocks clocking in.
 */
export const isTechActive = (u?: Pick<ReviewUser, 'timeTracking'>) =>
  !!u && u.timeTracking;
