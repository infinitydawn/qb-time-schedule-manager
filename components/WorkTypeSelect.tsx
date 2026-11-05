'use client';

import React, { useEffect, useRef, useState } from 'react';

interface WorkTypeSelectProps {
  value: string;
  options: string[];
  disabled?: boolean;
  onChange: (value: string) => void;
  /** Persists a new work type; resolves to the stored name or null on failure. */
  onAdd: (name: string) => Promise<string | null>;
}

const WorkTypeSelect: React.FC<WorkTypeSelectProps> = ({ value, options, disabled = false, onChange, onAdd }) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const close = () => {
    setOpen(false);
    setSearch('');
    setAdding(false);
    setNewName('');
  };

  const filtered = options.filter(o => o.toLowerCase().includes(search.trim().toLowerCase()));
  const exactMatch = options.some(o => o.toLowerCase() === search.trim().toLowerCase());

  const startAdding = (prefill: string) => {
    setAdding(true);
    setNewName(prefill.trim());
  };

  const saveNew = async () => {
    const name = newName.trim();
    if (!name || saving) return;
    setSaving(true);
    const stored = await onAdd(name);
    setSaving(false);
    if (stored) {
      onChange(stored);
      close();
    }
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => (open ? close() : setOpen(true))}
        className="w-full sm:w-48 px-2 py-1.5 text-sm border border-gray-300 rounded bg-white text-left truncate focus:outline-none focus:ring-1 focus:ring-blue-400"
      >
        {value || <span className="text-gray-400">Work type</span>}
        <span className="float-right text-gray-400 text-xs leading-5">▾</span>
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full sm:w-64 bg-white border border-gray-300 rounded shadow-lg">
          {adding ? (
            <div className="flex items-center gap-1 p-2 border-b border-gray-200">
              <input
                type="text"
                autoFocus
                value={newName}
                maxLength={100}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') { e.preventDefault(); void saveNew(); }
                  if (e.key === 'Escape') { setAdding(false); }
                }}
                placeholder="New work type name"
                className="flex-1 min-w-0 px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-400"
              />
              <button
                type="button"
                disabled={!newName.trim() || saving}
                onClick={() => void saveNew()}
                className="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-300"
              >
                {saving ? '…' : 'Add'}
              </button>
              <button
                type="button"
                onClick={() => setAdding(false)}
                className="px-1.5 py-1 text-xs text-gray-500 hover:text-gray-700"
                aria-label="Cancel adding work type"
              >
                ✕
              </button>
            </div>
          ) : (
            <div className="flex items-center border-b border-gray-200">
              <input
                type="text"
                autoFocus
                value={search}
                onChange={e => setSearch(e.target.value)}
                onKeyDown={e => { if (e.key === 'Escape') close(); }}
                placeholder="Search work types..."
                className="flex-1 min-w-0 px-3 py-2 text-sm focus:outline-none"
              />
              <button
                type="button"
                onClick={() => startAdding(search)}
                title="Add a new work type"
                aria-label="Add a new work type"
                className="mx-1.5 w-6 h-6 flex items-center justify-center text-sm font-bold text-blue-600 border border-blue-200 rounded hover:bg-blue-50"
              >
                +
              </button>
            </div>
          )}

          <div className="max-h-48 overflow-y-auto">
            {value && (
              <button
                type="button"
                onClick={() => { onChange(''); close(); }}
                className="w-full text-left px-3 py-1.5 text-sm text-gray-400 hover:bg-gray-100"
              >
                Clear work type
              </button>
            )}
            {filtered.map(o => (
              <button
                type="button"
                key={o}
                onClick={() => { onChange(o); close(); }}
                className={`w-full text-left px-3 py-1.5 text-sm hover:bg-blue-50 ${value === o ? 'bg-blue-100 font-semibold' : ''}`}
              >
                {o}
              </button>
            ))}
            {filtered.length === 0 && !search.trim() && (
              <div className="px-3 py-2 text-sm text-gray-400">No work types yet — use + to add one</div>
            )}
            {search.trim() && !exactMatch && !adding && (
              <button
                type="button"
                onClick={() => startAdding(search)}
                className="w-full text-left px-3 py-1.5 text-sm text-blue-600 hover:bg-blue-50"
              >
                + Add &ldquo;{search.trim()}&rdquo;
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default WorkTypeSelect;
