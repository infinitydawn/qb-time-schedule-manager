'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { JobRef, ReviewTimesheet, TimesheetCreate, TimesheetUpdate } from '@/types/review';

/* ─── Time zone helpers ─────────────────────────────────────────── */

const ZONES: { id: string; label: string; tz: string }[] = [
  { id: 'America/New_York', label: 'Eastern Time (US & Canada)', tz: 'tsET' },
  { id: 'America/Chicago', label: 'Central Time (US & Canada)', tz: 'tsCT' },
  { id: 'America/Denver', label: 'Mountain Time (US & Canada)', tz: 'tsMT' },
  { id: 'America/Phoenix', label: 'Arizona', tz: 'tsAZ' },
  { id: 'America/Los_Angeles', label: 'Pacific Time (US & Canada)', tz: 'tsPT' },
  { id: 'America/Anchorage', label: 'Alaska', tz: 'tsAK' },
  { id: 'Pacific/Honolulu', label: 'Hawaii', tz: 'tsHT' },
];
const DEFAULT_ZONE = ZONES[0].id;

const zoneFor = (tzStr: string) => ZONES.find(z => z.tz === tzStr)?.id || DEFAULT_ZONE;

/** Minutes the zone is ahead of UTC at the given wall-clock time (e.g. -300 for EST). */
function zoneOffsetMinutes(zone: string, date: string, time: string): number {
  const [y, mo, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const wall = Date.UTC(y, mo - 1, d, hh, mm);
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: zone, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
  const offsetAt = (instant: number) => {
    const parts = fmt.formatToParts(new Date(instant));
    const get = (t: string) => Number(parts.find(p => p.type === t)?.value);
    return (Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute')) - instant) / 60000;
  };
  // Two passes settle the offset across DST changes
  const first = offsetAt(wall);
  return offsetAt(wall - first * 60000);
}

const fmtOffset = (minutes: number, colon = true) => {
  const sign = minutes < 0 ? '-' : '+';
  const abs = Math.abs(minutes);
  const h = String(Math.floor(abs / 60)).padStart(2, '0');
  const m = String(abs % 60).padStart(2, '0');
  return `${sign}${h}${colon ? ':' : ''}${m}`;
};

const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
const isTime = (s: string) => /^\d{2}:\d{2}$/.test(s);

/** Epoch ms for a wall-clock date + time in a zone. */
const toInstant = (zone: string, date: string, time: string) => {
  const [y, mo, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  return Date.UTC(y, mo - 1, d, hh, mm) - zoneOffsetMinutes(zone, date, time) * 60000;
};

const toIso = (zone: string, date: string, time: string) =>
  `${date}T${time}:00${fmtOffset(zoneOffsetMinutes(zone, date, time))}`;

/** "2026-11-13T06:53:00-05:00" → { date, time } as written (the entry's own wall clock) */
const splitIso = (iso: string) => {
  const m = iso.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
  return m ? { date: m[1], time: m[2] } : { date: '', time: '' };
};

const nowIn = (zone: string) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(new Date());
  const get = (t: string) => parts.find(p => p.type === t)?.value || '';
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` };
};

const hmm = (seconds: number) => {
  const total = Math.round(seconds / 60);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

const fmtDay = (d: string) => {
  const [y, m, day] = d.split('-').map(Number);
  return new Date(y, m - 1, day).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
};

/* ─── Custom fields (loaded once per page) ──────────────────────── */

interface TimesheetField {
  id: string;
  name: string;
  required: boolean;
  items: string[];
}

let fieldsPromise: Promise<TimesheetField[]> | null = null;

const loadTimesheetFields = () => {
  if (!fieldsPromise) {
    fieldsPromise = (async () => {
      const res = await fetch('/api/qbtime/customfields', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load custom fields');
      type RawField = { id: string; name: string; required: boolean; active?: boolean; appliesToJobcodes?: string; items?: { name: string }[] };
      return ((data.customFields || []) as RawField[])
        .filter(f => f.active !== false && (!f.appliesToJobcodes || f.appliesToJobcodes === 'timesheet'))
        .map(f => ({ id: f.id, name: f.name, required: !!f.required, items: (f.items || []).map(i => i.name) }))
        // Required fields first (Maintenance, Service Item), like QB's editor
        .sort((a, b) => Number(b.required) - Number(a.required));
    })().catch(err => {
      fieldsPromise = null;
      throw err;
    });
  }
  return fieldsPromise;
};

/* ─── Job picker ────────────────────────────────────────────────── */

const JobPicker: React.FC<{
  jobs: JobRef[];
  value: string;
  fallbackName: string;
  onChange: (id: string) => void;
}> = ({ jobs, value, fallbackName, onChange }) => {
  const selectedName = jobs.find(j => j.id === value)?.name || fallbackName;
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? jobs.filter(j => j.name.toLowerCase().includes(q)) : jobs;
    return list.slice(0, 50);
  }, [jobs, query]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const pick = (j: JobRef) => {
    onChange(j.id);
    setQuery('');
    setOpen(false);
  };

  return (
    <div ref={boxRef} className="relative">
      <input
        type="text"
        value={open ? query : selectedName}
        placeholder={open ? selectedName || 'Search jobs…' : 'Select a job'}
        onFocus={() => { setOpen(true); setQuery(''); setHighlight(0); }}
        onChange={e => { setQuery(e.target.value); setOpen(true); setHighlight(0); }}
        onKeyDown={e => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setHighlight(h => Math.min(h + 1, matches.length - 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight(h => Math.max(h - 1, 0)); }
          else if (e.key === 'Enter' && open && matches[highlight]) { e.preventDefault(); pick(matches[highlight]); }
          else if (e.key === 'Escape' && open) { e.stopPropagation(); setOpen(false); }
        }}
        className="w-full border border-gray-300 rounded px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500"
        role="combobox"
        aria-controls="ts-job-options"
        aria-autocomplete="list"
        aria-expanded={open}
      />
      {open && (
        <ul id="ts-job-options" role="listbox" className="absolute z-10 mt-1 w-full max-h-60 overflow-y-auto bg-white border border-gray-200 rounded shadow-lg text-sm">
          {matches.length === 0 && <li className="px-2.5 py-1.5 text-gray-400">No matching jobs</li>}
          {matches.map((j, i) => (
            <li key={j.id}>
              <button
                type="button"
                onMouseDown={e => e.preventDefault()}
                onClick={() => pick(j)}
                onMouseEnter={() => setHighlight(i)}
                className={`w-full text-left px-2.5 py-1.5 ${i === highlight ? 'bg-blue-50' : ''} ${j.id === value ? 'font-semibold' : ''}`}
              >
                {j.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

/* ─── Editor ────────────────────────────────────────────────────── */

/**
 * Blank entry for create mode (id ''). start/end are wall-clock "YYYY-MM-DDTHH:MM" in
 * the zone given by tzStr; customfields can be pre-filled (e.g. from the tech's other entries).
 */
export const newTimesheetDraft = (opts: {
  userId: string; date: string; jobcodeId?: string; jobName?: string;
  startTime?: string; endTime?: string; customfields?: Record<string, string>;
}): ReviewTimesheet => ({
  id: '',
  userId: opts.userId,
  jobcodeId: opts.jobcodeId || '',
  jobName: opts.jobName || '',
  date: opts.date,
  type: 'regular',
  start: `${opts.date}T${opts.startTime || '08:00'}`,
  end: `${opts.date}T${opts.endTime || '16:00'}`,
  onTheClock: false,
  state: '',
  duration: 0,
  notes: '',
  customfields: { ...(opts.customfields || {}) },
  tzStr: 'tsET',
  locked: false,
  miles: null,
});

interface TimesheetEditorProps {
  /** An existing entry, or newTimesheetDraft(...) to create one */
  timesheet: ReviewTimesheet;
  /** Create mode only: why QB won't accept a new entry (e.g. the day is already submitted) */
  blockedReason?: string | null;
  techName: string;
  jobs: JobRef[];
  onClose: () => void;
  /** Called with the entry as QB stored it */
  onSaved: (updated: ReviewTimesheet) => void;
}

const labelCls = 'text-[11px] font-semibold uppercase tracking-wide text-gray-600 sm:pt-2';
const inputCls = 'border border-gray-300 rounded px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500';

const TimesheetEditor: React.FC<TimesheetEditorProps> = ({ timesheet: ts, blockedReason, techName, jobs, onClose, onSaved }) => {
  const isNew = !ts.id;
  const isManual = ts.type === 'manual';
  const initialZone = zoneFor(ts.tzStr);
  const initStart = splitIso(ts.start);
  const initEnd = ts.end ? splitIso(ts.end) : nowIn(initialZone);

  const [zone, setZone] = useState(initialZone);
  const [startDate, setStartDate] = useState(initStart.date || ts.date);
  const [startTime, setStartTime] = useState(initStart.time);
  const [endDate, setEndDate] = useState(initEnd.date);
  const [endTime, setEndTime] = useState(initEnd.time);
  const [onClock, setOnClock] = useState(ts.onTheClock);
  const [manualDate, setManualDate] = useState(ts.date);
  const [manualHours, setManualHours] = useState(String(Math.floor(ts.duration / 3600)));
  const [manualMinutes, setManualMinutes] = useState(String(Math.round((ts.duration % 3600) / 60)));
  const [jobId, setJobId] = useState(ts.jobcodeId);
  const [notes, setNotes] = useState(ts.notes);
  const [custom, setCustom] = useState<Record<string, string>>(ts.customfields || {});
  const [fields, setFields] = useState<TimesheetField[] | null>(null);
  const [fieldsError, setFieldsError] = useState<string | null>(null);
  const [showAllFields, setShowAllFields] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadTimesheetFields()
      .then(f => { if (!cancelled) setFields(f); })
      .catch(err => { if (!cancelled) setFieldsError(err instanceof Error ? err.message : 'Failed to load custom fields'); });
    return () => { cancelled = true; };
  }, []);

  // Keep the end date in step when the start date moves (most entries are same-day)
  const changeStartDate = (d: string) => {
    if (endDate === startDate && isDate(d)) setEndDate(d);
    setStartDate(d);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, saving]);

  /* ---- Derived totals / validation ---- */
  const startValid = isDate(startDate) && isTime(startTime);
  const endValid = isDate(endDate) && isTime(endTime);
  const totalSeconds = isManual
    ? (Number(manualHours) || 0) * 3600 + (Number(manualMinutes) || 0) * 60
    : startValid && (onClock ? true : endValid)
      ? ((onClock ? Date.now() : toInstant(zone, endDate, endTime)) - toInstant(zone, startDate, startTime)) / 1000
      : NaN;

  // QB answers 409 "You can't edit an approved or submitted timesheet" (verified Nov 2026).
  // Unapprove in this app only takes a day back to SUBMITTED, which is still read-only.
  const readOnlyReason = isNew
    ? blockedReason || null
    : ts.state === 'APPROVED'
    ? 'This entry is approved. QuickBooks doesn’t allow editing approved or submitted time — the day has to be unapproved and un-submitted (rejected) in QuickBooks Time first.'
    : ts.state === 'SUBMITTED'
      ? 'This entry is submitted. QuickBooks doesn’t allow editing submitted time — the day has to be rejected / un-submitted in QuickBooks Time first.'
      : ts.locked
        ? 'This entry is locked in QuickBooks and can’t be edited.'
        : null;

  let validation: string | null = readOnlyReason ? 'Read-only in QuickBooks.' : null;
  if (validation) { /* read-only: skip field checks */ } else if (isManual) {
    if (!isDate(manualDate)) validation = 'Pick a date.';
    else if (!(totalSeconds > 0)) validation = 'Duration must be more than 0.';
    else if (totalSeconds > 24 * 3600) validation = 'Duration can\'t be more than 24 hours.';
  } else {
    if (!startValid) validation = 'Enter a time in.';
    else if (!onClock && !endValid) validation = 'Enter a time out.';
    else if (!(totalSeconds > 0)) validation = 'Time out must be after time in.';
    else if (totalSeconds > 24 * 3600) validation = 'An entry can\'t be longer than 24 hours.';
  }
  if (!validation && !jobId) validation = 'Pick a job.';
  if (!validation && fields) {
    const missing = fields.find(f => f.required && !(custom[f.id] || '').trim());
    if (missing) validation = `${missing.name} is required.`;
  }

  const newDate = isManual ? manualDate : startDate;
  const movesDay = !isNew && !!newDate && newDate !== ts.date;
  const offsetLabel = startValid ? fmtOffset(zoneOffsetMinutes(zone, startDate, startTime), false) : '';
  const zoneLabel = ZONES.find(z => z.id === zone)?.label || zone;

  const visibleFields = (fields || []).filter(f => showAllFields || f.required || (custom[f.id] || '').trim());
  const hiddenFieldCount = (fields?.length || 0) - visibleFields.length;

  const save = async () => {
    if (validation || saving) return;
    if (isNew) {
      const create: TimesheetCreate = {
        userId: ts.userId,
        jobcodeId: jobId,
        start: toIso(zone, startDate, startTime),
        end: toIso(zone, endDate, endTime),
        notes,
        customfields: custom,
      };
      await send('POST', { create });
      return;
    }
    const update: TimesheetUpdate = { id: ts.id };
    if (isManual) {
      if (manualDate !== ts.date) update.date = manualDate;
      if (Math.round(totalSeconds) !== ts.duration) update.duration = Math.round(totalSeconds);
    } else {
      const start = toIso(zone, startDate, startTime);
      if (start !== ts.start) update.start = start;
      if (!onClock) {
        const end = toIso(zone, endDate, endTime);
        if (end !== ts.end) update.end = end;
      }
    }
    if (jobId !== ts.jobcodeId) update.jobcodeId = jobId;
    if (notes !== ts.notes) update.notes = notes;
    // QB rejects a partial custom-field update unless every required field is included,
    // so when anything changed send the whole set.
    const fieldsChanged = Object.entries(custom).some(([k, v]) => (ts.customfields?.[k] || '') !== v);
    if (fieldsChanged) update.customfields = { ...ts.customfields, ...custom };

    if (Object.keys(update).length === 1) {
      onClose();
      return;
    }

    await send('PUT', update);
  };

  const send = async (method: 'POST' | 'PUT', body: unknown) => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/qbtime/timesheets', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok || !data.timesheet) {
        setError(data.error || 'Failed to save the time entry');
        return;
      }
      onSaved(data.timesheet as ReviewTimesheet);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save the time entry');
    } finally {
      setSaving(false);
    }
  };

  const fieldSelect = (f: TimesheetField) => {
    const value = custom[f.id] || '';
    // Keep a value QB has stored even if it's no longer an active item
    const options = value && !f.items.includes(value) ? [value, ...f.items] : f.items;
    return (
      <React.Fragment key={f.id}>
        <label htmlFor={`cf-${f.id}`} className={labelCls}>
          {f.name}{f.required && <span className="text-red-500"> *</span>}
        </label>
        <select
          id={`cf-${f.id}`}
          value={value}
          onChange={e => setCustom(prev => ({ ...prev, [f.id]: e.target.value }))}
          className={`${inputCls} w-full bg-white`}
        >
          <option value="">{f.required ? 'Select…' : '(none)'}</option>
          {options.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      </React.Fragment>
    );
  };

  const modal = (
    <div
      className="fixed inset-0 z-[90] flex bg-black/40 px-3 py-4 overflow-y-auto"
      onMouseDown={e => { if (e.target === e.currentTarget && !saving) onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="ts-editor-title"
        className="m-auto w-full max-w-xl bg-white rounded-lg shadow-xl border border-gray-200"
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 bg-gray-50 rounded-t-lg">
          <h2 id="ts-editor-title" className="text-base font-semibold text-gray-800">{isNew ? 'New time entry' : 'Timesheet Editor'}</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            aria-label="Close"
            className="text-gray-500 hover:text-gray-800 text-xl leading-none px-1"
          >
            ×
          </button>
        </div>

        <form
          onSubmit={e => { e.preventDefault(); void save(); }}
          className="px-5 py-4 grid grid-cols-1 sm:grid-cols-[170px_1fr] gap-x-4 gap-y-2 sm:gap-y-3 items-start"
        >
          {/* display:contents keeps the grid; disabled greys out every field on read-only entries */}
          <fieldset disabled={!!readOnlyReason} className="contents">
          <span className={labelCls}>Team member</span>
          <div className="text-sm text-gray-800 sm:pt-1.5">{techName}</div>

          <span className={labelCls}>Type</span>
          <div className="sm:pt-1">
            <span className="inline-block text-[11px] font-semibold uppercase tracking-wide bg-gray-600 text-white rounded px-2 py-0.5">
              {isManual ? 'Manual' : 'Time in/out'}
            </span>
          </div>

          {readOnlyReason && (
            <div className="sm:col-span-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
              {readOnlyReason}
            </div>
          )}

          {isManual ? (
            <>
              <label htmlFor="ts-manual-date" className={labelCls}>Date</label>
              <input id="ts-manual-date" type="date" value={manualDate} onChange={e => setManualDate(e.target.value)} className={`${inputCls} w-44`} />

              <span className={labelCls}>Duration</span>
              <div className="flex items-center gap-1.5 text-sm text-gray-700">
                <input type="number" min={0} max={24} value={manualHours} onChange={e => setManualHours(e.target.value)} aria-label="Hours" className={`${inputCls} w-20`} /> h
                <input type="number" min={0} max={59} value={manualMinutes} onChange={e => setManualMinutes(e.target.value)} aria-label="Minutes" className={`${inputCls} w-20 ml-2`} /> m
              </div>
            </>
          ) : (
            <>
              {!isNew && (<>
              <span className={labelCls}>Status</span>
              <label className={`flex items-center gap-2 text-sm sm:pt-1.5 ${ts.onTheClock ? 'text-gray-800' : 'text-gray-400'}`}>
                <input
                  type="checkbox"
                  checked={onClock}
                  disabled={!ts.onTheClock}
                  onChange={e => setOnClock(e.target.checked)}
                  title={ts.onTheClock ? 'Uncheck to clock this entry out' : 'Only an entry that is on the clock can be currently working'}
                />
                Currently working
              </label>
              </>)}

              <label htmlFor="ts-start-date" className={labelCls}>Time in</label>
              <div className="flex flex-wrap items-center gap-2">
                <input id="ts-start-date" type="date" value={startDate} onChange={e => changeStartDate(e.target.value)} className={`${inputCls} w-40`} />
                <input type="time" value={startTime} onChange={e => setStartTime(e.target.value)} aria-label="Time in" className={`${inputCls} w-32`} />
              </div>

              <label htmlFor="ts-end-date" className={labelCls}>Time out</label>
              <div className="flex flex-wrap items-center gap-2">
                <input id="ts-end-date" type="date" value={endDate} disabled={onClock} onChange={e => setEndDate(e.target.value)} className={`${inputCls} w-40`} />
                <input type="time" value={endTime} disabled={onClock} onChange={e => setEndTime(e.target.value)} aria-label="Time out" className={`${inputCls} w-32`} />
              </div>
            </>
          )}

          <span className={labelCls}>Total hours</span>
          <div className={`text-lg font-semibold sm:pt-0.5 ${
            !(totalSeconds > 0) ? 'text-gray-400' : totalSeconds > 8 * 3600 ? 'text-red-600' : 'text-gray-800'
          }`}>
            {totalSeconds > 0 ? hmm(totalSeconds) : '—'}
            {onClock && !isManual && <span className="ml-2 text-xs font-normal text-gray-500">so far</span>}
          </div>

          <span className={labelCls}>Job</span>
          <JobPicker jobs={jobs} value={jobId} fallbackName={ts.jobName} onChange={setJobId} />

          {fields === null && !fieldsError && (
            <div className="sm:col-start-2 text-xs text-gray-500">Loading custom fields…</div>
          )}
          {fieldsError && (
            <div className="sm:col-start-2 text-xs text-red-700">Custom fields: {fieldsError}</div>
          )}
          {visibleFields.map(fieldSelect)}
          {hiddenFieldCount > 0 && (
            <button
              type="button"
              onClick={() => setShowAllFields(true)}
              className="sm:col-start-2 justify-self-start text-xs text-blue-600 hover:text-blue-800 hover:underline"
            >
              + {hiddenFieldCount} more field{hiddenFieldCount === 1 ? '' : 's'}
            </button>
          )}

          {ts.miles !== null && (
            <>
              <span className={labelCls}>Miles</span>
              <div className="text-sm text-gray-600 sm:pt-1.5">{ts.miles.toFixed(2)} <span className="text-xs text-gray-400">(tracked by QuickBooks)</span></div>
            </>
          )}

          <label htmlFor="ts-notes" className={labelCls}>Notes</label>
          <textarea
            id="ts-notes"
            value={notes}
            onChange={e => setNotes(e.target.value)}
            rows={3}
            className={`${inputCls} w-full resize-y`}
          />

          {!isManual && (
            <>
              <label htmlFor="ts-zone" className={labelCls}>Time zone</label>
              <div>
                <select id="ts-zone" value={zone} onChange={e => setZone(e.target.value)} className={`${inputCls} w-full bg-white`}>
                  {ZONES.map(z => <option key={z.id} value={z.id}>{z.label}</option>)}
                </select>
                {offsetLabel && <div className="mt-1 text-[11px] text-gray-500">{zoneLabel} ({offsetLabel} UTC) on {fmtDay(startDate)}</div>}
              </div>
            </>
          )}

          {movesDay && !validation && (
            <div className="sm:col-span-2 text-xs text-blue-800 bg-blue-50 border border-blue-200 rounded px-2 py-1.5">
              This entry will move from {fmtDay(ts.date)} to {fmtDay(newDate)}.
            </div>
          )}
          {error && (
            <div className="sm:col-span-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1.5 whitespace-pre-wrap">{error}</div>
          )}

          </fieldset>

          <div className="sm:col-span-2 flex items-center justify-end gap-2 pt-2 border-t border-gray-100 mt-1">
            {validation && <span className="mr-auto text-xs text-gray-500">{validation}</span>}
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="px-4 py-1.5 text-sm rounded bg-gray-200 text-gray-700 hover:bg-gray-300 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!!validation || saving}
              className="px-5 py-1.5 text-sm rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? 'Saving…' : isNew ? 'Create' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );

  return typeof document === 'undefined' ? null : createPortal(modal, document.body);
};

export default TimesheetEditor;
