import { DailySchedule, WorkerAssignment } from '@/types/schedule';
import { ReviewDayData, ReviewTimesheet, workDetailsFor } from '@/types/review';

/**
 * Time review export: same day / PM layout as the schedule export, but each site lists
 * every tech with floor + work type, their QB timesheet note and hours:
 *
 *   NAFTULY S
 *   ---------
 *     1 Apple Drive ST:
 *   	Jose  (1-5FL Speakers Roughing): "wired speakers 1fl" - 8h 32m
 *   	Jairo (1-5FL Speakers Roughing): "ran wires for speakers 1fl" - 8h 32m
 */

const NL = '\r\n';

const parseLocal = (d: string) => {
  const [y, m, dd] = d.split('-').map(Number);
  return new Date(y, m - 1, dd);
};

const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;

// Same short address as the schedule export: house number + up to 3 street words
const shortJob = (job: string) => {
  if (!job) return '(no job)';
  const street = job.split(',')[0].trim();
  const m = street.match(/^(\d[\d-]*)\s+(.+)/);
  if (!m) return street;
  return `${m[1]} ${m[2].split(/\s+/).slice(0, 3).join(' ')}`;
};

export const formatDuration = (seconds: number) => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${String(m).padStart(2, '0')}m`;
};

// "1-5" -> "1-5FL"; leave values that already say FL / floor alone
const floorLabel = (floor?: string) => {
  const f = (floor || '').trim();
  if (!f) return '';
  return /(fl|flr|floor)\.?$/i.test(f) ? f : `${f}FL`;
};

const oneLine = (text: string) => text.replace(/\s*[\r\n]+\s*/g, ' ').trim();

export interface ExportLookups {
  /** lower-cased tech name -> QB user id */
  techIdByName: Record<string, string>;
  /** lower-cased job name -> QB jobcode id */
  jobIdByName: Record<string, string>;
}

const matchesJob = (ts: ReviewTimesheet, assignment: WorkerAssignment, jobIdByName: Record<string, string>) => {
  const jobId = jobIdByName[assignment.job.trim().toLowerCase()];
  return jobId
    ? ts.jobcodeId === jobId
    : !!ts.jobName && ts.jobName.toLowerCase() === assignment.job.trim().toLowerCase();
};

function techLine(
  worker: string,
  padTo: number,
  assignment: WorkerAssignment,
  review: ReviewDayData | undefined,
  { techIdByName, jobIdByName }: ExportLookups
) {
  const userId = techIdByName[worker.trim().toLowerCase()];

  // Floor / work type from the QB schedule note this tech was sent (fallback: app values)
  const jobId = jobIdByName[assignment.job.trim().toLowerCase()];
  const { floor, workType } = workDetailsFor(assignment, review?.scheduleEvents, jobId, userId);
  const detail = [floorLabel(floor), workType].filter(Boolean).join(' ') || 'no floor / work type';
  // Pad names so the "(floor work type)" column lines up, like the requested format
  const label = `${firstName(worker).padEnd(padTo)} (${detail})`;

  if (!userId) return `\t${label}: not found in QuickBooks`;
  if (!review) return `\t${label}: time entries not loaded`;

  const entries = review.timesheets.filter(ts => ts.userId === userId && matchesJob(ts, assignment, jobIdByName));
  if (entries.length === 0) return `\t${label}: no time entry`;

  const notes = [...new Set(entries.map(ts => oneLine(ts.notes)).filter(Boolean))];
  const noteText = notes.length > 0 ? `"${notes.join(' / ')}"` : '(no notes)';
  const total = entries.reduce((sum, ts) => sum + ts.duration, 0);
  const onClock = entries.some(ts => ts.onTheClock);
  return `\t${label}: ${noteText} - ${formatDuration(total)}${onClock ? ' (still on the clock)' : ''}`;
}

/**
 * @param days    schedules to export (already filtered + sorted)
 * @param reviews QB time entries per date (from /api/qbtime/review); a missing date
 *                prints "time entries not loaded", an error string prints that error
 */
export function buildTimeReviewText(
  days: DailySchedule[],
  reviews: Record<string, ReviewDayData | { error: string }>,
  lookups: ExportLookups
): string {
  const sections: string[] = [];

  for (const day of days) {
    const dateLabel = day.date
      ? parseLocal(day.date).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
      : 'No Date';
    const lines: string[] = [dateLabel, '='.repeat(dateLabel.length)];

    const loaded = day.date ? reviews[day.date] : undefined;
    const review = loaded && !('error' in loaded) ? loaded : undefined;
    if (loaded && 'error' in loaded) lines.push(`(Could not load QuickBooks time entries: ${loaded.error})`);

    for (const pm of day.projectManagers) {
      if (!pm.name && pm.assignments.length === 0) continue;
      const pmName = pm.name || '(No PM)';
      lines.push('', pmName, '-'.repeat(pmName.length));

      pm.assignments.forEach((a, i) => {
        if (i > 0) lines.push('');
        lines.push(`  ${shortJob(a.job)}:`);
        if (a.workers.length === 0) {
          lines.push('\t(no workers)');
          return;
        }
        const padTo = Math.max(...a.workers.map(w => firstName(w).length));
        for (const worker of a.workers) {
          lines.push(techLine(worker, padTo, a, review, lookups));
        }
      });
    }

    sections.push(lines.join(NL));
  }

  return sections.join(NL + NL + NL);
}
