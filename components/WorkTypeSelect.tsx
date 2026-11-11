'use client';

import React, { useEffect, useRef, useState } from 'react';
import { joinWorkTypes, splitWorkTypes } from '@/utils/workNotes';

interface WorkTypeSelectProps {
  /** Selected work types as a comma-separated list ("A, B") */
  value: string;
  options: string[];
  disabled?: boolean;
  onChange: (value: string) => void;
  /** Persists a new work type; resolves to the stored name or null on failure. */
  onAdd: (name: string) => Promise<string | null>;
}

/** Searchable multi-select for work types, with + to add new ones. */
const WorkTypeSelect: React.FC<WorkTypeSelectProps> = ({ value, options, disabled = false, onChange, onAdd }) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [addError, setAddError] = useState('');
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const selected = splitWorkTypes(value);
  const isSelected = (name: string) => selected.some(s => s.toLowerCase() === name.toLowerCase());

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
    setAddError('');
  };

  const toggle = (name: string) => {
    onChange(joinWorkTypes(
      isSelected(name)
        ? selected.filter(s => s.toLowerCase() !== name.toLowerCase())
        : [...selected, name]
    ));
  };

  // Selected types first (in the order picked), then the rest alphabetically
  const allOptions = [
    ...selected,
    ...options.filter(o => !isSelected(o)),
  ];
  const query = search.trim().toLowerCase();
  const filtered = allOptions.filter(o => o.toLowerCase().includes(query));
  const exactMatch = allOptions.some(o => o.toLowerCase() === query);

  const startAdding = (prefill: string) => {
    setAdding(true);
    setNewName(prefill.trim());
    setAddError('');
  };

  const saveNew = async () => {
    const name = newName.trim();
    if (!name || saving) return;
    if (name.includes(',')) {
      setAddError('Names can\'t contain commas');
      return;
    }
    setSaving(true);
    const stored = await onAdd(name);
    setSaving(false);
    if (stored) {
      if (!isSelected(stored)) onChange(joinWorkTypes([...selected, stored]));
      setAdding(false);
      setNewName('');
      setSearch('');
      setAddError('');
    }
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => (open ? close() : setOpen(true))}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="w-full sm:w-64 min-h-[34px] px-2 py-1 text-sm border border-gray-300 rounded bg-white text-left flex items-center gap-1 focus:outline-none focus:ring-1 focus:ring-blue-400"
      >
        <span className="flex-1 flex flex-wrap gap-1 min-w-0">
          {selected.length === 0 ? (
            <span className="text-gray-400 py-0.5">Work types</span>
          ) : (
            selected.map(name => (
              <span key={name} className="inline-flex items-center max-w-full px-1.5 py-0.5 text-xs rounded bg-blue-100 text-blue-800 truncate">
                {name}
              </span>
            ))
          )}
        </span>
        <span className="text-gray-400 text-xs flex-shrink-0">▾</span>
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full sm:w-72 bg-white border border-gray-300 rounded shadow-lg">
          {adding ? (
            <div className="p-2 border-b border-gray-200">
              <div className="flex items-center gap-1">
                <input
                  type="text"
                  autoFocus
                  value={newName}
                  maxLength={100}
                  onChange={e => { setNewName(e.target.value); setAddError(''); }}
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
              {addError && <div className="mt-1 text-xs text-red-600">{addError}</div>}
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

          <div role="listbox" aria-multiselectable="true" className="max-h-56 overflow-y-auto py-1">
            {filtered.map(o => (
              <label
                key={o}
                role="option"
                aria-selected={isSelected(o)}
                className={`flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer hover:bg-blue-50 ${isSelected(o) ? 'font-semibold' : ''}`}
              >
                <input
                  type="checkbox"
                  checked={isSelected(o)}
                  onChange={() => toggle(o)}
                  className="h-3.5 w-3.5"
                />
                <span className="truncate">{o}</span>
              </label>
            ))}
            {allOptions.length === 0 && !query && (
              <div className="px-3 py-2 text-sm text-gray-400">No work types yet — use + to add one</div>
            )}
            {query && filtered.length === 0 && exactMatch === false && !adding && (
              <div className="px-3 py-1 text-xs text-gray-400">No matches</div>
            )}
            {query && !exactMatch && !adding && (
              <button
                type="button"
                onClick={() => startAdding(search)}
                className="w-full text-left px-3 py-1.5 text-sm text-blue-600 hover:bg-blue-50"
              >
                + Add &ldquo;{search.trim()}&rdquo;
              </button>
            )}
          </div>

          <div className="flex items-center justify-between px-3 py-1.5 border-t border-gray-200 bg-gray-50 text-xs">
            <span className="text-gray-500">{selected.length} selected</span>
            <span className="flex items-center gap-3">
              {selected.length > 0 && (
                <button type="button" onClick={() => onChange('')} className="text-gray-500 hover:text-gray-700">
                  Clear
                </button>
              )}
              <button type="button" onClick={close} className="font-semibold text-blue-600 hover:text-blue-800">
                Done
              </button>
            </span>
          </div>
        </div>
      )}
    </div>
  );
};

export default WorkTypeSelect;
