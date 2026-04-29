'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import DayCard from '@/components/DayCard';
import QBTimeManager from '@/components/QBTimeManager';
import { useQBTime } from '@/hooks/useQBTime';
import { useScheduleStorage } from '@/utils/storage';
import { DailySchedule } from '@/types/schedule';
import { getScheduleFingerprintInput, schedulesHaveSameQBContent } from '@/utils/scheduleFingerprint';

const cloneWithUniqueIds = (schedule: DailySchedule, suffix: string): DailySchedule => ({
  ...schedule,
  projectManagers: schedule.projectManagers.map(pm => ({
    ...pm,
    id: `${pm.id}-${suffix}`,
    assignments: pm.assignments.map(assignment => ({
      ...assignment,
      id: `${assignment.id}-${suffix}`,
      pmId: `${pm.id}-${suffix}`,
    })),
  })),
});

const mergeDuplicateDateSchedules = (base: DailySchedule, duplicate: DailySchedule): DailySchedule => {
  if (getScheduleFingerprintInput(base) === getScheduleFingerprintInput(duplicate)) {
    return {
      ...base,
      sentToQB: base.sentToQB || duplicate.sentToQB,
      qbHash: base.qbHash || duplicate.qbHash,
    };
  }

  const duplicateWithUniqueIds = cloneWithUniqueIds(duplicate, `merged-${duplicate.id}`);

  return {
    ...base,
    sentToQB: false,
    qbHash: undefined,
    projectManagers: [
      ...base.projectManagers,
      ...duplicateWithUniqueIds.projectManagers,
    ],
  };
};

const dedupeSchedulesByDate = (items: DailySchedule[]) => {
  const deduped: DailySchedule[] = [];
  const indexesByDate = new Map<string, number>();

  for (const schedule of items) {
    if (!schedule.date) {
      deduped.push(schedule);
      continue;
    }

    const existingIndex = indexesByDate.get(schedule.date);
    if (existingIndex === undefined) {
      indexesByDate.set(schedule.date, deduped.length);
      deduped.push(schedule);
      continue;
    }

    deduped[existingIndex] = mergeDuplicateDateSchedules(deduped[existingIndex], schedule);
  }

  return deduped;
};

export default function Home() {
  const [schedules, setSchedules] = useState<DailySchedule[]>([]);
  const [sendingScheduleIds, setSendingScheduleIds] = useState<Record<string, boolean>>({});
  const [showQBManager, setShowQBManager] = useState(false);
  const [dbStatus, setDbStatus] = useState<'loading' | 'ok' | 'error'>('loading');
  const [importingFromQB, setImportingFromQB] = useState(false);

  // Default filter: last 7 days through next 7 days
  const today = new Date();
  const sevenDaysAgo = new Date(today);
  sevenDaysAgo.setDate(today.getDate() - 7);
  const sevenDaysAhead = new Date(today);
  sevenDaysAhead.setDate(today.getDate() + 7);
  const toISO = (d: Date) => d.toISOString().split('T')[0];
  const [filterFrom, setFilterFrom] = useState(toISO(sevenDaysAgo));
  const [filterTo, setFilterTo] = useState(toISO(sevenDaysAhead));
  const [qbImportFrom, setQbImportFrom] = useState(toISO(sevenDaysAgo));
  const [qbImportTo, setQbImportTo] = useState(toISO(sevenDaysAhead));

  const { isConnected, sendScheduleToQB, projectManagers, technicians, jobs } = useQBTime();

  // Map QB Time PMs and techs to name strings for DayCard
  const pmNames = projectManagers.map(pm => pm.name);
  const techNames = technicians.map(t => t.name);
  const jobNames = jobs.map(j => j.name);
  const { loadSchedules, saveSchedules } = useScheduleStorage();

  // Ref to skip the first save triggered by loading
  const initialLoadDone = useRef(false);

  // Load on mount — try DB first, fall back to localStorage
  useEffect(() => {
    (async () => {
      let loaded: DailySchedule[] = [];
      let loadedFromDb = false;
      try {
        const res = await fetch('/api/schedules');
        if (res.ok) {
          loaded = await res.json();
          setDbStatus('ok');
          loadedFromDb = true;
        } else {
          throw new Error('DB fetch failed');
        }
      } catch {
        console.warn('DB unavailable, falling back to localStorage');
        loaded = loadSchedules();
        setDbStatus('error');
      }

      // Auto-cleanup: keep only the 10 newest entries when data came from DB.
      // Use the DB `date` field when available, falling back to DB `createdAt`.
      if (loadedFromDb && loaded.length > 10) {
        const getTs = (s: DailySchedule) => {
          const dateStr = (s.date && typeof s.date === 'string' && s.date.trim() !== '') ? s.date : (s.createdAt ?? '');
          const ts = Date.parse(dateStr);
          return isNaN(ts) ? 0 : ts;
        };

        // Sort ascending (oldest first) so the first N are the ones to remove.
        const sortedAsc = [...loaded].sort((a, b) => getTs(a) - getTs(b));
        const extrasCount = Math.max(0, loaded.length - 10);
        const toDelete = sortedAsc.slice(0, extrasCount);
        const deleteCount = toDelete.length;
        const confirmed = window.confirm(
          `There are ${loaded.length} schedule entries. ${deleteCount} old entr${deleteCount === 1 ? 'y' : 'ies'} will be deleted to keep only the 10 newest.\n\nProceed?`
        );
        if (confirmed) {
          const deleteIds = new Set(toDelete.map(s => s.id));
          loaded = loaded.filter(s => !deleteIds.has(s.id));
        }
      }

      loaded = dedupeSchedulesByDate(loaded);
      setSchedules(loaded);
      // Seed prevDatesRef so existing cards don't trigger highlight on first render
      const dateMap: Record<string, string> = {};
      loaded.forEach(s => { dateMap[s.id] = s.date; });
      prevDatesRef.current = dateMap;
      initialLoadDone.current = true;
    })();
  }, []);

  // Persist on change — save to both DB and localStorage
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!initialLoadDone.current) return;

    // Always save to localStorage immediately (fast cache)
    saveSchedules(schedules);

    // Debounce DB save (500ms) to avoid hammering on rapid edits
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      fetch('/api/schedules', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(schedules),
      }).then(res => {
        if (res.ok) setDbStatus('ok');
        else setDbStatus('error');
      }).catch(() => setDbStatus('error'));
    }, 500);
  }, [schedules]);

  // Add a blank day card
  const addDay = () => {
    const newSchedule: DailySchedule = {
      id: `day-${Date.now()}`,
      date: '',
      dayName: '',
      projectManagers: []
    };
    setSchedules(prev => [...prev, newSchedule]);
  };

  // Track previous dates so we know when a date actually changed
  const prevDatesRef = useRef<Record<string, string>>({});

  // Scroll-to + highlight a card by schedule id
  const highlightCard = useCallback((id: string) => {
    // Small delay so DOM re-sorts first
    setTimeout(() => {
      const el = document.getElementById(`daycard-${id}`);
      if (!el) return;
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.remove('animate-card-highlight');
      // Force reflow so re-adding the class restarts the animation
      void el.offsetWidth;
      el.classList.add('animate-card-highlight');
      el.addEventListener('animationend', () => {
        el.classList.remove('animate-card-highlight');
      }, { once: true });
    }, 50);
  }, []);

  // Update a day card in place
  const updateSchedule = (updated: DailySchedule) => {
    let dateChanged = false;
    let rejectedDuplicateDate = false;

    setSchedules(prev => {
      const current = prev.find(s => s.id === updated.id);
      const oldDate = current?.date || prevDatesRef.current[updated.id] || '';
      const duplicateDateSchedule = updated.date
        ? prev.find(s => s.id !== updated.id && s.date === updated.date)
        : undefined;

      if (duplicateDateSchedule && updated.date !== oldDate) {
        rejectedDuplicateDate = true;
        return prev;
      }

      dateChanged = !!updated.date && updated.date !== oldDate;
      prevDatesRef.current[updated.id] = updated.date;

      const changed = current && schedulesHaveSameQBContent(current, updated)
        ? { ...updated, sentToQB: current.sentToQB, qbHash: current.qbHash }
        : { ...updated, sentToQB: false, qbHash: undefined };

      return prev.map(s => (s.id === updated.id ? changed : s));
    });

    if (rejectedDuplicateDate) {
      alert('That date already exists. Edit the existing day instead of creating a duplicate.');
      return;
    }

    if (dateChanged) {
      highlightCard(updated.id);
    }
  };

  // Copy
  const copySchedule = (schedule: DailySchedule) => {
    const newId = `day-${Date.now()}`;
    const copied: DailySchedule = {
      ...schedule,
      id: newId,
      date: '',
      dayName: '',
      sentToQB: false,
      projectManagers: schedule.projectManagers.map(pm => ({
        ...pm,
        id: `pm-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        assignments: pm.assignments.map(a => ({
          ...a,
          id: `job-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          qbEventId: undefined,
          assignmentHash: undefined,
        })),
      })),
    };
    setSchedules(prev => [...prev, copied]);
    highlightCard(newId);
  };

  // Delete
  const deleteSchedule = (id: string) => {
    setSchedules(prev => prev.filter(s => s.id !== id));
  };

  const importFromQB = async () => {
    if (!isConnected) {
      alert('Please connect to QuickBooks Time first');
      setShowQBManager(true);
      return;
    }

    if (!qbImportFrom || !qbImportTo) {
      alert('Enter both a start date and an end date.');
      return;
    }

    if (qbImportFrom > qbImportTo) {
      alert('Start date must be before or equal to end date.');
      return;
    }

    const confirmed = window.confirm(
      `Import QuickBooks schedules from ${qbImportFrom} through ${qbImportTo}?\n\nThis will replace all existing days in the app.`
    );
    if (!confirmed) return;

    if (saveTimer.current) clearTimeout(saveTimer.current);
    setImportingFromQB(true);
    try {
      const res = await fetch('/api/qbtime/import-schedules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ startDate: qbImportFrom, endDate: qbImportTo }),
      });
      const data = await res.json();

      if (!res.ok) {
        alert(data.error || 'Failed to import from QuickBooks.');
        return;
      }

      const imported = dedupeSchedulesByDate(data.schedules || []);
      const dateMap: Record<string, string> = {};
      imported.forEach(schedule => { dateMap[schedule.id] = schedule.date; });
      prevDatesRef.current = dateMap;
      setSchedules(imported);
      setDbStatus('ok');
      alert(`Imported ${data.importedEvents || 0} QuickBooks schedule event(s).`);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to import from QuickBooks.');
    } finally {
      setImportingFromQB(false);
    }
  };

  // Send to QB
  const handleSendToQB = async (schedule: DailySchedule) => {
    if (sendingScheduleIds[schedule.id]) return;

    if (!isConnected) {
      alert('Please connect to QuickBooks Time first');
      setShowQBManager(true);
      return;
    }

    // Don't allow re-send unless the card has been changed (it's unlocked)
    if (schedule.sentToQB) {
      alert('This schedule has already been sent and has not changed. Make an edit to send an update.');
      return;
    }

    setSendingScheduleIds(prev => ({ ...prev, [schedule.id]: true }));
    try {
      const result = await sendScheduleToQB(schedule);
      if (result.success && result.failed === 0) {
        // Mark as sent
        setSchedules(prev => prev.map(s => s.id === schedule.id ? { ...s, sentToQB: true } : s));
        if (result.unchanged) {
          alert('This schedule has already been sent and has not changed.');
          return;
        }
        alert(`✓ ${result.created} created, ${result.updated || 0} updated for ${schedule.dayName || 'this day'}!`);
      } else if (result.success && result.failed > 0) {
        setSchedules(prev => prev.map(s => s.id === schedule.id ? { ...s, sentToQB: true } : s));
        alert(`Partial success: ${result.created} created, ${result.updated || 0} updated, ${result.failed} failed.\n\nErrors:\n${JSON.stringify(result.errors, null, 2) || 'Unknown errors'}`);
      } else {
        alert('Failed to send schedule. Please check your data and try again.');
      }
    } finally {
      setSendingScheduleIds(prev => {
        const next = { ...prev };
        delete next[schedule.id];
        return next;
      });
    }
  };

  // Stats
  const totalWorkers = schedules.reduce(
    (t, s) => t + s.projectManagers.reduce(
      (pt, pm) => pt + pm.assignments.reduce((at, a) => at + a.workers.length, 0), 0
    ), 0
  );

  // Filtered schedules based on date range
  const filteredSchedules = schedules.filter(s => {
    if (!s.date) return true; // always show undated cards
    if (filterFrom && s.date < filterFrom) return false;
    if (filterTo && s.date > filterTo) return false;
    return true;
  });

  const filteredWorkers = filteredSchedules.reduce(
    (t, s) => t + s.projectManagers.reduce(
      (pt, pm) => pt + pm.assignments.reduce((at, a) => at + a.workers.length, 0), 0
    ), 0
  );

  // Export entire schedule to TXT (respects date filter)
  const exportSchedule = () => {
    if (filteredSchedules.length === 0) {
      alert('Nothing to export – no days match the current filter.');
      return;
    }

    const sorted = [...filteredSchedules].sort((a, b) => {
      if (!a.date && !b.date) return 0;
      if (!a.date) return 1;
      if (!b.date) return -1;
      return a.date.localeCompare(b.date);
    });
    const parseLocal = (d: string) => { const [y, m, dd] = d.split('-').map(Number); return new Date(y, m - 1, dd); };
    const formatAssignmentTime = (start?: string, end?: string) => `${start || '08:00'}-${end || '16:00'}`;

    const sections: string[] = [];

    sorted.forEach(day => {
      const dateLabel = day.date
        ? parseLocal(day.date).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
        : 'No Date';

      const lines: string[] = [];
      lines.push(dateLabel);
      lines.push('='.repeat(dateLabel.length));

      day.projectManagers.forEach(pm => {
        if (!pm.name && pm.assignments.length === 0) return;
        lines.push('');
        lines.push(pm.name || '(No PM)');
        lines.push('-'.repeat((pm.name || '(No PM)').length));
        pm.assignments.forEach(a => {
          const workers = a.workers.length > 0 ? a.workers.join(', ') : '(no workers)';
          const job = a.job || '(no job)';
          lines.push(`  ${formatAssignmentTime(a.startTime, a.endTime)}  ${workers}  \u2014  ${job}`);
        });
      });

      sections.push(lines.join('\r\n'));
    });

    const text = sections.join('\r\n\r\n\r\n');
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const first = sorted[0]?.date || 'undated';
    const last = sorted[sorted.length - 1]?.date || 'undated';
    a.href = url;
    a.download = `schedule-${first}-to-${last}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="container mx-auto px-3 sm:px-4 py-4 sm:py-6">
          {/* Title row */}
          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
            <div className="min-w-0">
              <h1 className="text-xl sm:text-3xl font-bold text-gray-800 truncate">Work Schedule Manager</h1>
              <p className="text-gray-600 text-xs sm:text-base mt-0.5 sm:mt-1 hidden sm:block">Manage daily work schedules &amp; sync with QuickBooks Time</p>
            </div>
            <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
              <button
                onClick={() => setShowQBManager(true)}
                className={`px-3 sm:px-4 py-1.5 sm:py-2 text-xs sm:text-sm rounded-md transition-colors ${
                  isConnected
                    ? 'bg-green-500 text-white hover:bg-green-600'
                    : 'bg-yellow-500 text-white hover:bg-yellow-600'
                }`}
              >
                {isConnected ? '✓ QB Connected' : '⚠ Connect QB'}
              </button>
              <span className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium ${
                dbStatus === 'ok' ? 'bg-green-100 text-green-700' :
                dbStatus === 'error' ? 'bg-red-100 text-red-700' :
                'bg-gray-100 text-gray-500'
              }`}>
                <span className={`w-2 h-2 rounded-full ${
                  dbStatus === 'ok' ? 'bg-green-500' :
                  dbStatus === 'error' ? 'bg-red-500' :
                  'bg-gray-400 animate-pulse'
                }`} />
                {dbStatus === 'ok' ? 'DB Synced' : dbStatus === 'error' ? 'DB Offline' : 'Loading…'}
              </span>
            </div>
          </div>

          {/* Stats */}
          <div className="mt-3 sm:mt-5 flex gap-2 sm:gap-4 items-center flex-wrap">
            <div className="bg-gradient-to-r from-blue-500 to-blue-600 text-white px-3 sm:px-5 py-2 sm:py-3 rounded-lg">
              <span className="text-lg sm:text-2xl font-bold mr-1 sm:mr-2">{filteredSchedules.length}</span>
              <span className="text-blue-100 text-xs sm:text-sm">Days{(filterFrom || filterTo) ? ' (filtered)' : ''}</span>
            </div>
            <div className="bg-gradient-to-r from-green-500 to-green-600 text-white px-3 sm:px-5 py-2 sm:py-3 rounded-lg">
              <span className="text-lg sm:text-2xl font-bold mr-1 sm:mr-2">{filteredWorkers}</span>
              <span className="text-green-100 text-xs sm:text-sm">Workers</span>
            </div>
            <button
              onClick={exportSchedule}
              className="bg-gradient-to-r from-purple-500 to-purple-600 text-white px-3 sm:px-5 py-2 sm:py-3 rounded-lg hover:from-purple-600 hover:to-purple-700 transition-colors font-semibold text-xs sm:text-sm"
            >
              Export
            </button>
          </div>

          {/* Date range filter */}
          <div className="mt-3 sm:mt-4 flex items-center gap-2 sm:gap-3 flex-wrap">
            <span className="text-xs sm:text-sm font-medium text-gray-600">Filter:</span>
            <input
              type="date"
              value={filterFrom}
              onChange={e => setFilterFrom(e.target.value)}
              className="px-2 sm:px-3 py-1 sm:py-1.5 text-xs sm:text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
            <span className="text-gray-400 text-xs sm:text-sm">to</span>
            <input
              type="date"
              value={filterTo}
              onChange={e => setFilterTo(e.target.value)}
              className="px-2 sm:px-3 py-1 sm:py-1.5 text-xs sm:text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
            {(filterFrom || filterTo) && (
              <button
                onClick={() => { setFilterFrom(''); setFilterTo(''); }}
                className="px-2 sm:px-3 py-1 sm:py-1.5 text-xs bg-gray-200 text-gray-600 rounded hover:bg-gray-300 transition-colors"
              >
                Clear
              </button>
            )}
          </div>

          <div className="mt-3 sm:mt-4 flex items-center gap-2 sm:gap-3 flex-wrap border-t border-gray-100 pt-3">
            <span className="text-xs sm:text-sm font-medium text-gray-600">Import QB:</span>
            <input
              type="date"
              value={qbImportFrom}
              onChange={e => setQbImportFrom(e.target.value)}
              className="px-2 sm:px-3 py-1 sm:py-1.5 text-xs sm:text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
            <span className="text-gray-400 text-xs sm:text-sm">to</span>
            <input
              type="date"
              value={qbImportTo}
              onChange={e => setQbImportTo(e.target.value)}
              className="px-2 sm:px-3 py-1 sm:py-1.5 text-xs sm:text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
            <button
              onClick={importFromQB}
              disabled={importingFromQB}
              className="px-3 sm:px-4 py-1.5 sm:py-2 text-xs sm:text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors disabled:bg-gray-300"
            >
              {importingFromQB ? 'Importing...' : 'Pull from QB'}
            </button>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="container mx-auto px-3 sm:px-4 py-4 sm:py-8 space-y-3 sm:space-y-4">
        {/* Add Day button */}
        <button
          onClick={addDay}
          className="w-full py-3 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition-colors text-lg"
        >
          + Add Day
        </button>

        {/* Day cards */}
        {filteredSchedules.length === 0 && (
          <div className="text-center py-12 text-gray-400">
            <div className="text-4xl mb-2">📅</div>
            <p>{schedules.length === 0 ? <>No days yet &mdash; click &ldquo;Add Day&rdquo; to get started</> : 'No days match the current filter'}</p>
          </div>
        )}

        {[...filteredSchedules].sort((a, b) => {
          if (!a.date && !b.date) return 0;
          if (!a.date) return 1;
          if (!b.date) return -1;
          return a.date.localeCompare(b.date);
        }).map(schedule => (
          <div key={schedule.id} id={`daycard-${schedule.id}`}>
            <DayCard
              schedule={schedule}
              isSending={!!sendingScheduleIds[schedule.id]}
              onChange={updateSchedule}
              onDelete={() => deleteSchedule(schedule.id)}
              onCopy={() => copySchedule(schedule)}
              onSendToQB={() => handleSendToQB(schedule)}
              pmList={pmNames}
              techList={techNames}
              jobList={jobNames}
            />
          </div>
        ))}
      </main>

      {/* QB Time Manager Modal */}
      <QBTimeManager
        isOpen={showQBManager}
        onClose={() => setShowQBManager(false)}
      />
    </div>
  );
}
