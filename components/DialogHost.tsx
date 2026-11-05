'use client';

import React, { useEffect, useRef, useState } from 'react';
import { DialogRequest, resolveDialog, subscribeDialogs } from '@/utils/dialog';

/** Renders queued appConfirm / appAlert dialogs one at a time. Mount once. */
const DialogHost: React.FC = () => {
  const [queue, setQueue] = useState<DialogRequest[]>([]);
  const okRef = useRef<HTMLButtonElement>(null);

  useEffect(() => subscribeDialogs(setQueue), []);

  const current = queue[0];

  useEffect(() => {
    if (!current) return;
    okRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        resolveDialog(current.id, current.kind === 'alert');
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [current]);

  if (!current) return null;

  const isConfirm = current.kind === 'confirm';
  const title = current.title || (isConfirm ? 'Please confirm' : 'Notice');

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 px-4">
      <div
        role={isConfirm ? 'alertdialog' : 'dialog'}
        aria-modal="true"
        aria-labelledby={`dialog-title-${current.id}`}
        className="w-full max-w-md bg-white rounded-lg shadow-xl border border-gray-200"
      >
        <div className="px-5 pt-4 pb-3">
          <h2 id={`dialog-title-${current.id}`} className="text-base font-semibold text-gray-800">
            {title}
          </h2>
          <p className="mt-2 text-sm text-gray-700 whitespace-pre-wrap break-words max-h-[60vh] overflow-y-auto">
            {current.message}
          </p>
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 bg-gray-50 border-t border-gray-200 rounded-b-lg">
          {isConfirm && (
            <button
              type="button"
              onClick={() => resolveDialog(current.id, false)}
              className="px-3 py-1.5 text-sm rounded border border-gray-300 bg-white text-gray-700 hover:bg-gray-100"
            >
              {current.cancelLabel || 'Cancel'}
            </button>
          )}
          <button
            ref={okRef}
            type="button"
            onClick={() => resolveDialog(current.id, true)}
            className={`px-3 py-1.5 text-sm rounded text-white ${
              current.danger ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'
            }`}
          >
            {current.confirmLabel || 'OK'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default DialogHost;
