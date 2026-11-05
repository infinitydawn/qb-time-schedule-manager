'use client';

import { useCallback, useEffect, useState } from 'react';

/** Resolves to the catalogue names, or null if the DB is unavailable. */
async function fetchWorkTypeNames(): Promise<string[] | null> {
  try {
    const res = await fetch('/api/work-types');
    if (!res.ok) return null;
    const data = await res.json();
    return (data.workTypes || []).map((w: { name: string }) => w.name);
  } catch {
    // DB offline — the dropdown still shows types already used on schedules
    return null;
  }
}

export const useWorkTypes = () => {
  const [workTypes, setWorkTypes] = useState<string[]>([]);

  const reloadWorkTypes = useCallback(async () => {
    const names = await fetchWorkTypeNames();
    if (names) setWorkTypes(names);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchWorkTypeNames().then(names => {
      if (names && !cancelled) setWorkTypes(names);
    });
    return () => { cancelled = true; };
  }, []);

  /** Adds a work type; resolves to the stored name, or null on failure. */
  const addWorkType = useCallback(async (name: string): Promise<string | null> => {
    const clean = name.trim();
    if (!clean) return null;
    try {
      const res = await fetch('/api/work-types', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: clean }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || 'Failed to add work type');
        return null;
      }
      const stored: string = data.workType?.name || clean;
      setWorkTypes(prev => (
        prev.some(w => w.toLowerCase() === stored.toLowerCase())
          ? prev
          : [...prev, stored].sort((a, b) => a.localeCompare(b))
      ));
      return stored;
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to add work type');
      return null;
    }
  }, []);

  return { workTypes, addWorkType, reloadWorkTypes };
};
