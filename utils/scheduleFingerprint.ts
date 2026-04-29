import { DailySchedule, ProjectManager, WorkerAssignment } from '@/types/schedule';

const DEFAULT_START_TIME = '08:00';
const DEFAULT_END_TIME = '16:00';

const normalizeText = (value: string | undefined) => (value || '').trim();

const normalizeTime = (value: string | undefined, fallback: string) => {
  const normalized = normalizeText(value);
  return /^\d{2}:\d{2}$/.test(normalized) ? normalized : fallback;
};

const compareStrings = (a: string, b: string) => a.localeCompare(b);

export function normalizeScheduleForQB(schedule: DailySchedule) {
  const projectManagers = (schedule.projectManagers || [])
    .map((pm: ProjectManager) => ({
      name: normalizeText(pm.name),
      assignments: (pm.assignments || [])
        .map((assignment: WorkerAssignment) => ({
          job: normalizeText(assignment.job),
          workers: (assignment.workers || [])
            .map(worker => normalizeText(worker))
            .filter(Boolean)
            .sort(compareStrings),
          startTime: normalizeTime(assignment.startTime, DEFAULT_START_TIME),
          endTime: normalizeTime(assignment.endTime, DEFAULT_END_TIME),
        }))
        .filter(assignment => assignment.job || assignment.workers.length > 0)
        .sort((a, b) => (
          compareStrings(a.job, b.job)
          || compareStrings(a.startTime, b.startTime)
          || compareStrings(a.endTime, b.endTime)
          || compareStrings(a.workers.join('|'), b.workers.join('|'))
        )),
    }))
    .filter(pm => pm.name || pm.assignments.length > 0)
    .sort((a, b) => (
      compareStrings(a.name, b.name)
      || compareStrings(JSON.stringify(a.assignments), JSON.stringify(b.assignments))
    ));

  return {
    date: normalizeText(schedule.date),
    dayName: normalizeText(schedule.dayName),
    projectManagers,
  };
}

export function getScheduleFingerprintInput(schedule: DailySchedule) {
  return JSON.stringify(normalizeScheduleForQB(schedule));
}

export function schedulesHaveSameQBContent(a: DailySchedule, b: DailySchedule) {
  return getScheduleFingerprintInput(a) === getScheduleFingerprintInput(b);
}
