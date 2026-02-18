'use client';

import React, { useState } from 'react';
import { DailySchedule, ProjectManager, WorkerAssignment } from '@/types/schedule';

const firstName = (name: string) => name.split(' ')[0];

// Show only house number + street name, e.g. "3060 3rd Ave"
const shortJob = (job: string) => {
  if (!job) return '(no job)';
  // Strip everything after the first comma (city, state, zip, etc.)
  const street = job.split(',')[0].trim();
  // Match house number (with optional dash like 86-06) + street name + type abbrev
  const m = street.match(/^(\d[\d-]*)\s+(.+)/);
  if (!m) return street; // non-address jobs like "Office Work"
  const parts = m[2].split(/\s+/);
  // Keep up to 3 words after the number (e.g. "West 125th St")
  const streetName = parts.slice(0, 3).join(' ');
  return `${m[1]} ${streetName}`;
};

interface JobRow {
  id: string;
  workers: string[];
  job: string;
}

interface PMBlock {
  id: string;
  name: string;
  jobs: JobRow[];
}

interface DayCardProps {
  schedule: DailySchedule;
  onChange: (schedule: DailySchedule) => void;
  onDelete: () => void;
  onCopy: () => void;
  onSendToQB: () => void;
  pmList?: string[];
  techList?: string[];
  jobList?: string[];
}

const DayCard: React.FC<DayCardProps> = ({ schedule, onChange, onDelete, onCopy, onSendToQB, pmList, techList, jobList }) => {
  const availablePMs = pmList ?? [];
  const availableEmployees = techList ?? [];
  const availableJobs = jobList ?? [];
  const [collapsed, setCollapsed] = useState(false);
  const [dateBlink, setDateBlink] = useState(false);

  const parseLocalDate = (dateStr: string) => {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(y, m - 1, d);
  };

  const updateDate = (newDate: string) => {
    const dayName = parseLocalDate(newDate).toLocaleDateString('en-US', { weekday: 'long' });
    onChange({ ...schedule, date: newDate, dayName });
    setDateBlink(true);
    setTimeout(() => setDateBlink(false), 1200);
  };

  // Add a new PM block
  const addPM = () => {
    const newPM: ProjectManager = {
      id: `pm-${Date.now()}`,
      name: '',
      assignments: []
    };
    onChange({
      ...schedule,
      projectManagers: [...schedule.projectManagers, newPM]
    });
  };

  // Update PM name
  const updatePMName = (pmId: string, name: string) => {
    onChange({
      ...schedule,
      projectManagers: schedule.projectManagers.map(pm =>
        pm.id === pmId ? { ...pm, name } : pm
      )
    });
  };

  // Remove PM
  const removePM = (pmId: string) => {
    onChange({
      ...schedule,
      projectManagers: schedule.projectManagers.filter(pm => pm.id !== pmId)
    });
  };

  // Add job row under a PM
  const addJobRow = (pmId: string) => {
    const newAssignment: WorkerAssignment = {
      id: `job-${Date.now()}`,
      workers: [],
      job: '',
      pmId
    };
    onChange({
      ...schedule,
      projectManagers: schedule.projectManagers.map(pm =>
        pm.id === pmId
          ? { ...pm, assignments: [...pm.assignments, newAssignment] }
          : pm
      )
    });
  };

  // Update a job row
  const updateJobRow = (pmId: string, jobId: string, field: 'workers' | 'job', value: string[] | string) => {
    onChange({
      ...schedule,
      projectManagers: schedule.projectManagers.map(pm =>
        pm.id === pmId
          ? {
              ...pm,
              assignments: pm.assignments.map(a =>
                a.id === jobId ? { ...a, [field]: value } : a
              )
            }
          : pm
      )
    });
  };

  // Remove a job row
  const removeJobRow = (pmId: string, jobId: string) => {
    onChange({
      ...schedule,
      projectManagers: schedule.projectManagers.map(pm =>
        pm.id === pmId
          ? { ...pm, assignments: pm.assignments.filter(a => a.id !== jobId) }
          : pm
      )
    });
  };

  // Toggle worker in a job row
  const toggleWorker = (pmId: string, jobId: string, currentWorkers: string[], worker: string) => {
    // Removing — always allow
    if (currentWorkers.includes(worker)) {
      updateJobRow(pmId, jobId, 'workers', currentWorkers.filter(w => w !== worker));
      return;
    }

    // Adding — check if already assigned elsewhere in the same day
    const alreadyUsed = schedule.projectManagers.some(pm =>
      pm.assignments.some(a => a.id !== jobId && a.workers.includes(worker))
    );

    if (alreadyUsed && !window.confirm(`${worker} is already assigned to another job today. Are you sure?`)) {
      return;
    }

    updateJobRow(pmId, jobId, 'workers', [...currentWorkers, worker]);
  };

  // Count totals
  const totalWorkers = schedule.projectManagers.reduce((t, pm) =>
    t + pm.assignments.reduce((at, a) => at + a.workers.length, 0), 0
  );

  return (
    <div className={`bg-white border rounded-lg shadow-sm overflow-hidden ${
      schedule.sentToQB ? 'border-green-400 ring-1 ring-green-200' : 'border-gray-300'
    }`}>
      {/* Card header — always visible */}
      <div
        className={`flex flex-col sm:flex-row sm:items-center sm:justify-between px-3 sm:px-5 py-2 sm:py-3 border-b cursor-pointer select-none gap-2 ${
          schedule.sentToQB ? 'bg-green-50 border-green-200' : 'bg-blue-50 border-blue-200'
        }`}
        onClick={() => setCollapsed(!collapsed)}
      >
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <span className="text-gray-500 text-xs sm:text-sm">{collapsed ? '▶' : '▼'}</span>
          {schedule.sentToQB && (
            <span className="text-green-600 text-sm" title="Sent to QuickBooks Time">✓</span>
          )}
          <h3 className={`text-sm sm:text-lg font-bold truncate ${schedule.sentToQB ? 'text-green-700' : 'text-blue-700'}`}>
            {schedule.dayName || 'New Day'}
          </h3>
          {schedule.date && (
            <span className="text-xs sm:text-sm text-blue-500 flex-shrink-0">
              {parseLocalDate(schedule.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </span>
          )}
          <span className="text-xs text-gray-500 hidden sm:inline">
            · {schedule.projectManagers.length} PM(s) · {totalWorkers} worker(s)
          </span>
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0" onClick={e => e.stopPropagation()}>
          <button
            onClick={onSendToQB}
            className={`px-2 sm:px-3 py-1 text-xs rounded ${
              schedule.sentToQB
                ? 'bg-green-700 text-white hover:bg-green-800'
                : 'bg-green-500 text-white hover:bg-green-600'
            }`}
          >
            {schedule.sentToQB ? '✓ Sent' : 'Send to QB'}
          </button>
          <button
            onClick={onCopy}
            className="px-2 sm:px-3 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600"
          >
            Copy
          </button>
          <button
            onClick={onDelete}
            className="px-2 sm:px-3 py-1 text-xs bg-red-500 text-white rounded hover:bg-red-600"
          >
            Delete
          </button>
        </div>
      </div>

      {/* Collapsed summary — text notes style */}
      {collapsed && schedule.projectManagers.length > 0 && (
        <div className="px-5 py-3 bg-gray-50 border-t border-gray-200 font-mono text-sm text-gray-700 whitespace-pre-line">
          {schedule.projectManagers.map(pm => {
            if (!pm.name && pm.assignments.length === 0) return null;
            const lines: string[] = [];
            if (pm.name) lines.push(pm.name);
            pm.assignments.forEach(a => {
              const workers = a.workers.length > 0 ? a.workers.map(firstName).join(', ') : '(no workers)';
              const job = shortJob(a.job);
              lines.push(`  ${workers} – ${job}`);
            });
            return lines.join('\n');
          }).filter(Boolean).join('\n\n')}
        </div>
      )}

      {/* Card body — collapsible */}
      {!collapsed && (
        <div className="p-3 sm:p-5 space-y-3 sm:space-y-5">
          {/* Date picker */}
          <div className="flex items-center gap-2 sm:gap-4 flex-wrap">
            <label className="text-xs sm:text-sm font-medium text-gray-600">Date</label>
            <input
              type="date"
              value={schedule.date}
              onChange={e => updateDate(e.target.value)}
              className={`px-2 sm:px-3 py-1 sm:py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-400 ${dateBlink ? 'animate-date-blink' : ''}`}
            />
            {schedule.dayName && (
              <span className="text-xs sm:text-sm font-semibold text-blue-600">{schedule.dayName}</span>
            )}
          </div>

          {/* PM blocks */}
          {schedule.projectManagers.map(pm => (
            <PMBlock
              key={pm.id}
              pm={pm}
              availablePMs={availablePMs}
              availableEmployees={availableEmployees}
              availableJobs={availableJobs}
              onUpdateName={(name) => updatePMName(pm.id, name)}
              onRemove={() => removePM(pm.id)}
              onAddJob={() => addJobRow(pm.id)}
              onToggleWorker={(jobId, worker) => {
                const a = pm.assignments.find(a => a.id === jobId);
                if (a) toggleWorker(pm.id, jobId, a.workers, worker);
              }}
              onChangeJob={(jobId, job) => updateJobRow(pm.id, jobId, 'job', job)}
              onRemoveJob={(jobId) => removeJobRow(pm.id, jobId)}
            />
          ))}

          {/* Add PM button */}
          <button
            onClick={addPM}
            className="text-sm text-indigo-600 hover:text-indigo-800 font-medium"
          >
            + add PM
          </button>
        </div>
      )}
    </div>
  );
};

/* ---- Collapsible PM Block ---- */

interface PMBlockProps {
  pm: ProjectManager;
  availablePMs: string[];
  availableEmployees: string[];
  availableJobs: string[];
  onUpdateName: (name: string) => void;
  onRemove: () => void;
  onAddJob: () => void;
  onToggleWorker: (jobId: string, worker: string) => void;
  onChangeJob: (jobId: string, job: string) => void;
  onRemoveJob: (jobId: string) => void;
}

const PMBlock: React.FC<PMBlockProps> = ({
  pm, availablePMs, availableEmployees, availableJobs,
  onUpdateName, onRemove, onAddJob, onToggleWorker, onChangeJob, onRemoveJob
}) => {
  const [collapsed, setCollapsed] = useState(false);
  const workerCount = pm.assignments.reduce((t, a) => t + a.workers.length, 0);

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      {/* PM header */}
      <div
        className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 bg-indigo-50 px-3 sm:px-4 py-2 border-b border-indigo-200 cursor-pointer select-none"
        onClick={() => setCollapsed(!collapsed)}
      >
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <span className="text-gray-500 text-xs">{collapsed ? '▶' : '▼'}</span>
          <div onClick={e => e.stopPropagation()}>
            <select
              value={pm.name}
              onChange={e => onUpdateName(e.target.value)}
              className="px-2 py-1 text-sm font-bold border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-indigo-400 max-w-[160px] sm:max-w-none"
            >
              <option value="">Select PM</option>
              {availablePMs.map(p => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>
          <span className="text-xs text-gray-500 flex-shrink-0">
            {pm.assignments.length} job(s) · {workerCount} worker(s)
          </span>
        </div>
        <button
          onClick={e => { e.stopPropagation(); onRemove(); }}
          className="sm:ml-auto text-red-400 hover:text-red-600 text-xs sm:text-sm self-end sm:self-auto"
        >
          remove PM
        </button>
      </div>

      {/* Collapsed summary */}
      {collapsed && pm.assignments.length > 0 && (
        <div className="px-4 py-2 bg-gray-50 text-xs text-gray-600 font-mono whitespace-pre-line">
          {pm.assignments.map(a => {
            const workers = a.workers.length > 0 ? a.workers.map(firstName).join(', ') : '(no workers)';
            const job = shortJob(a.job);
            return `${workers} – ${job}`;
          }).join('\n')}
        </div>
      )}

      {/* Expanded body */}
      {!collapsed && (
        <div className="p-3 space-y-3">
          {pm.assignments.map(assignment => (
            <JobRowEditor
              key={assignment.id}
              assignment={assignment}
              availableEmployees={availableEmployees}
              availableJobs={availableJobs}
              onToggleWorker={(worker) => onToggleWorker(assignment.id, worker)}
              onChangeJob={(job) => onChangeJob(assignment.id, job)}
              onRemove={() => onRemoveJob(assignment.id)}
            />
          ))}

          <button
            onClick={onAddJob}
            className="text-xs text-blue-600 hover:text-blue-800 font-medium"
          >
            + add another job
          </button>
        </div>
      )}
    </div>
  );
};

/* ---- Job Row Editor ---- */

interface JobRowEditorProps {
  assignment: WorkerAssignment;
  availableEmployees: string[];
  availableJobs: string[];
  onToggleWorker: (worker: string) => void;
  onChangeJob: (job: string) => void;
  onRemove: () => void;
}

const JobRowEditor: React.FC<JobRowEditorProps> = ({
  assignment,
  availableEmployees,
  availableJobs,
  onToggleWorker,
  onChangeJob,
  onRemove
}) => {
  const [showEmployees, setShowEmployees] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [jobSearch, setJobSearch] = useState('');
  const [techSearch, setTechSearch] = useState('');
  const [showJobDropdown, setShowJobDropdown] = useState(false);
  const jobRef = React.useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  React.useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (jobRef.current && !jobRef.current.contains(e.target as Node)) {
        setShowJobDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const filteredJobs = availableJobs.filter(job =>
    job.toLowerCase().includes(jobSearch.toLowerCase())
  );

  const filteredEmployees = availableEmployees.filter(emp =>
    emp.toLowerCase().includes(techSearch.toLowerCase())
  );

  const summaryText = `${assignment.workers.length > 0 ? assignment.workers.map(firstName).join(', ') : '(no workers)'} – ${shortJob(assignment.job)}`;

  return (
    <div className="border border-gray-200 rounded bg-gray-50 overflow-hidden">
      {/* Job row header — always visible, clickable to collapse */}
      <div
        className="flex items-center gap-2 px-3 py-2 cursor-pointer select-none"
        onClick={() => setCollapsed(!collapsed)}
      >
        <span className="text-gray-400 text-xs">{collapsed ? '▶' : '▼'}</span>
        <span className="flex-1 text-sm text-gray-700 truncate">{summaryText}</span>
        <button
          onClick={e => { e.stopPropagation(); onRemove(); }}
          className="text-red-400 hover:text-red-600 text-lg leading-none"
        >
          ×
        </button>
      </div>

      {/* Expanded body */}
      {!collapsed && (
        <div className="px-3 pb-3 space-y-2">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3">
            {/* Employee selector toggle */}
            <button
              onClick={() => { setShowEmployees(!showEmployees); setTechSearch(''); }}
              className="flex-1 text-left px-3 py-1.5 text-sm border border-gray-300 rounded bg-white min-h-[32px]"
            >
              {assignment.workers.length > 0 ? (
                <span className="text-gray-800">{assignment.workers.map(firstName).join(', ')}</span>
              ) : (
                <span className="text-gray-400">Select employees...</span>
              )}
            </button>

            <span className="text-gray-400 hidden sm:inline">–</span>

            {/* Searchable Job dropdown */}
            <div ref={jobRef} className="relative">
              <button
                type="button"
                onClick={() => { setShowJobDropdown(!showJobDropdown); setJobSearch(''); }}
                className="w-full sm:w-auto px-2 py-1.5 text-sm border border-gray-300 rounded bg-white focus:outline-none focus:ring-1 focus:ring-blue-400 sm:min-w-[180px] text-left truncate"
              >
                {assignment.job || <span className="text-gray-400">Select job</span>}
              </button>

              {showJobDropdown && (
                <div className="absolute z-20 mt-1 w-full sm:w-64 bg-white border border-gray-300 rounded shadow-lg">
                  <input
                    type="text"
                    autoFocus
                    value={jobSearch}
                    onChange={e => setJobSearch(e.target.value)}
                    placeholder="Search jobs..."
                    className="w-full px-3 py-2 text-sm border-b border-gray-200 focus:outline-none"
                  />
                  <div className="max-h-48 overflow-y-auto">
                    {assignment.job && (
                      <button
                        type="button"
                        onClick={() => { onChangeJob(''); setShowJobDropdown(false); }}
                        className="w-full text-left px-3 py-1.5 text-sm text-gray-400 hover:bg-gray-100"
                      >
                        Clear selection
                      </button>
                    )}
                    {filteredJobs.length > 0 ? (
                      filteredJobs.map(job => (
                        <button
                          type="button"
                          key={job}
                          onClick={() => { onChangeJob(job); setShowJobDropdown(false); setJobSearch(''); }}
                          className={`w-full text-left px-3 py-1.5 text-sm hover:bg-blue-50 ${
                            assignment.job === job ? 'bg-blue-100 font-semibold' : ''
                          }`}
                        >
                          {job}
                        </button>
                      ))
                    ) : (
                      <div className="px-3 py-2 text-sm text-gray-400">No jobs found</div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Employee checkboxes — shown when toggled */}
          {showEmployees && (
            <div className="border border-gray-300 rounded bg-white">
              <input
                type="text"
                autoFocus
                value={techSearch}
                onChange={e => setTechSearch(e.target.value)}
                placeholder="Search techs..."
                className="w-full px-3 py-2 text-sm border-b border-gray-200 focus:outline-none"
              />
              <div className="p-2 max-h-36 overflow-y-auto">
                {filteredEmployees.length > 0 ? (
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-1">
                    {filteredEmployees.map(emp => (
                      <label key={emp} className="flex items-center gap-1 text-xs cursor-pointer hover:bg-gray-100 p-1 rounded">
                        <input
                          type="checkbox"
                          checked={assignment.workers.includes(emp)}
                          onChange={() => onToggleWorker(emp)}
                          className="h-3 w-3"
                        />
                        <span>{emp}</span>
                      </label>
                    ))}
                  </div>
                ) : (
                  <div className="px-3 py-2 text-sm text-gray-400">No techs found</div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default DayCard;
