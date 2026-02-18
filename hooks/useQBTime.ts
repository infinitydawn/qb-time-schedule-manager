'use client';

import { useState, useCallback, useEffect } from 'react';
import { DailySchedule } from '@/types/schedule';

export interface QBTimePM {
  id: string;
  name: string;
  firstName: string;
  lastName: string;
}

export interface QBTimeTech {
  id: string;
  name: string;
  firstName: string;
  lastName: string;
}

export interface QBTimeJob {
  id: string;
  name: string;
  parentId: string | null;
  type: string;
}

export interface QBCustomField {
  id: string;
  name: string;
  required: boolean;
  type: string;
  items: { id: string; name: string; active: boolean }[];
}

interface UseQBTimeReturn {
  loading: boolean;
  error: string | null;
  isConnected: boolean;
  projectManagers: QBTimePM[];
  technicians: QBTimeTech[];
  jobs: QBTimeJob[];
  checkConnection: () => Promise<boolean>;
  fetchProjectManagers: () => Promise<void>;
  fetchTechnicians: () => Promise<void>;
  fetchJobs: () => Promise<void>;
  sendScheduleToQB: (schedule: DailySchedule) => Promise<{ success: boolean; created: number; failed: number; errors?: any[] }>;
  disconnect: () => void;
}

export const useQBTime = (): UseQBTimeReturn => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [projectManagers, setProjectManagers] = useState<QBTimePM[]>([]);
  const [technicians, setTechnicians] = useState<QBTimeTech[]>([]);
  const [jobs, setJobs] = useState<QBTimeJob[]>([]);
  const [customFields, setCustomFields] = useState<QBCustomField[]>([]);

  // Check whether the server has a QB token configured
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/qbtime/token');
        if (res.ok) {
          const data = await res.json();
          if (data.configured) {
            setIsConnected(true);
          }
        }
      } catch {
        // server unavailable
      }
    })();
  }, []);

  // Auto-fetch PMs, techs, jobs when connected
  useEffect(() => {
    if (isConnected) {
      if (projectManagers.length === 0) fetchProjectManagers();
      if (technicians.length === 0) fetchTechnicians();
      if (jobs.length === 0) fetchJobs();
      if (customFields.length === 0) fetchCustomFields();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected]);

  /** Verify the server-side token works against TSheets */
  const checkConnection = useCallback(async (): Promise<boolean> => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/qbtime/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Connection failed');
        setLoading(false);
        return false;
      }

      setIsConnected(true);
      setLoading(false);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
      setLoading(false);
      return false;
    }
  }, []);

  const fetchProjectManagers = useCallback(async (): Promise<void> => {
    if (!isConnected) {
      setError('Not connected — QB token not configured on server');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/qbtime/pms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Failed to fetch project managers');
        setLoading(false);
        return;
      }

      setProjectManagers(data.pms || []);
      setLoading(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch project managers');
      setLoading(false);
    }
  }, [isConnected]);

  const fetchTechnicians = useCallback(async (): Promise<void> => {
    if (!isConnected) {
      setError('Not connected — QB token not configured on server');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/qbtime/techs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Failed to fetch technicians');
        setLoading(false);
        return;
      }

      setTechnicians(data.techs || []);
      setLoading(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch technicians');
      setLoading(false);
    }
  }, [isConnected]);

  const fetchJobs = useCallback(async (): Promise<void> => {
    if (!isConnected) {
      setError('Not connected — QB token not configured on server');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/qbtime/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Failed to fetch jobs');
        setLoading(false);
        return;
      }

      setJobs(data.jobs || []);
      setLoading(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch jobs');
      setLoading(false);
    }
  }, [isConnected]);

  const fetchCustomFields = useCallback(async (): Promise<void> => {
    if (!isConnected) return;

    try {
      const res = await fetch('/api/qbtime/customfields', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      const data = await res.json();
      if (res.ok) {
        setCustomFields(data.customFields || []);
        console.log('[useQBTime] Custom fields loaded:', data.customFields);
      }
    } catch (err) {
      console.error('Failed to fetch custom fields:', err);
    }
  }, [isConnected]);

  const sendScheduleToQB = useCallback(async (
    schedule: DailySchedule
  ): Promise<{ success: boolean; created: number; failed: number; errors?: any[] }> => {
    if (!isConnected) {
      setError('Not connected to QuickBooks Time');
      return { success: false, created: 0, failed: 0 };
    }

    setLoading(true);
    setError(null);

    try {
      // Pick color based on ISO week number so same week = same color
      const SCHEDULE_COLORS = [
        '#F44336', '#EF6C00', '#43A047', '#2196F3', '#673AB7',
        '#E91E63', '#009688', '#3F51B5', '#9C27B0', '#785548',
        '#BF1959', '#827717', '#486B7A', '#8A2731', '#78909C',
        '#FAB3AE', '#F8C499', '#B3D9B5', '#A6D5FA', '#D7A8DF',
        '#CDC8A2', '#6A5E72', '#888888', '#010101',
      ];
      const dateParts = schedule.date.split('-').map(Number);
      const d = new Date(dateParts[0], dateParts[1] - 1, dateParts[2]);
      d.setDate(d.getDate() + 4 - (d.getDay() || 7)); // Thursday of this week
      const yearStart = new Date(d.getFullYear(), 0, 1);
      const weekNum = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
      const eventColor = SCHEDULE_COLORS[weekNum % SCHEDULE_COLORS.length];

      // Build one schedule event per job assignment (all techs as assigned_user_ids)
      const entries: any[] = [];

      for (const pm of schedule.projectManagers) {
        for (const assignment of pm.assignments) {
          if (assignment.workers.length === 0 || !assignment.job) continue;

          // Look up jobcode ID by name
          const jobMatch = jobs.find(
            j => j.name.toLowerCase() === assignment.job.toLowerCase()
          );
          if (!jobMatch) {
            setError(`Job "${assignment.job}" not found in QB Time`);
            setLoading(false);
            return { success: false, created: 0, failed: 0 };
          }

          // Look up all tech user IDs
          const assignedUserIds: string[] = [];
          for (const workerName of assignment.workers) {
            const techMatch = technicians.find(
              t => t.name.toLowerCase() === workerName.trim().toLowerCase()
            );
            if (!techMatch) {
              setError(`Technician "${workerName}" not found in QB Time`);
              setLoading(false);
              return { success: false, created: 0, failed: 0 };
            }
            assignedUserIds.push(techMatch.id);
          }

          // Build short title (max 64 chars): "FirstL - Street (Tech1, Tech2)"
          const pmParts = pm.name.trim().split(/\s+/);
          const pmShort = pmParts.length > 1
            ? `${pmParts[0]} ${pmParts[pmParts.length - 1][0]}`
            : pmParts[0];
          const streetAddress = assignment.job.split(',')[0].trim();
          const techShortNames = assignment.workers.map(w => w.trim().split(/\s+/)[0]).join(', ');
          let title = `${pmShort} - ${streetAddress} (${techShortNames})`;
          if (title.length > 64) {
            title = title.substring(0, 61) + '...';
          }

          // Full detail in notes (no length limit)
          const techNamesList = assignment.workers.join(', ');
          const notes = `${pm.name} - ${assignment.job} (${techNamesList})`;

          // Build start/end for the schedule date (8am - 4pm Eastern)
          // Determine EST vs EDT: EDT is Mar second Sun – Nov first Sun
          const [yr, mo, da] = schedule.date.split('-').map(Number);
          const dateObj = new Date(yr, mo - 1, da);
          const month = dateObj.getMonth() + 1; // 1-12
          let isEDT = false;
          if (month > 3 && month < 11) {
            isEDT = true;
          } else if (month === 3) {
            // Second Sunday of March
            const firstDay = new Date(yr, 2, 1).getDay();
            const secondSun = firstDay === 0 ? 8 : 15 - firstDay;
            if (da >= secondSun) isEDT = true;
          } else if (month === 11) {
            // First Sunday of November
            const firstDay = new Date(yr, 10, 1).getDay();
            const firstSun = firstDay === 0 ? 1 : 8 - firstDay;
            if (da < firstSun) isEDT = true;
          }
          const offset = isEDT ? '-04:00' : '-05:00';
          const startISO = `${schedule.date}T08:00:00${offset}`;
          const endISO = `${schedule.date}T16:00:00${offset}`;

          entries.push({
            assigned_user_ids: assignedUserIds,
            jobcode_id: Number(jobMatch.id),
            start: startISO,
            end: endISO,
            all_day: false,
            timezone: 'America/New_York',
            title,
            notes,
            location: assignment.job,
            color: eventColor,
            draft: false,
          });
        }
      }

      if (entries.length === 0) {
        setError('No valid entries to send — make sure each job has workers and a job selected');
        setLoading(false);
        return { success: false, created: 0, failed: 0 };
      }

      console.log('[sendScheduleToQB] Sending schedule events:', JSON.stringify(entries, null, 2));

      const res = await fetch('/api/qbtime/create-schedule-events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries }),
      });

      const data = await res.json();
      console.log('[sendScheduleToQB] Response status:', res.status, 'data:', JSON.stringify(data, null, 2));

      if (!res.ok) {
        setError(data.error || 'Failed to create schedule events');
        setLoading(false);
        return { success: false, created: 0, failed: 0, errors: [data.error] };
      }

      setLoading(false);

      if (data.failed > 0) {
        setError(`${data.created} created, ${data.failed} failed`);
        return { success: data.created > 0, created: data.created, failed: data.failed, errors: data.errors };
      }

      return { success: true, created: data.created, failed: 0 };
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send schedule');
      setLoading(false);
      return { success: false, created: 0, failed: 0 };
    }
  }, [isConnected, technicians, jobs]);

  const disconnect = useCallback(() => {
    setIsConnected(false);
    setProjectManagers([]);
    setTechnicians([]);
    setJobs([]);
    setCustomFields([]);
    setError(null);
  }, []);

  return {
    loading,
    error,
    isConnected,
    projectManagers,
    technicians,
    jobs,
    checkConnection,
    fetchProjectManagers,
    fetchTechnicians,
    fetchJobs,
    sendScheduleToQB,
    disconnect,
  };
};