/**
 * In-page replacements for window.confirm / window.alert.
 *
 * Native dialogs are blocked in some embedded browsers (e.g. the Claude desktop
 * browser pane returns false from confirm()), which silently broke buttons like
 * "Pull from QB". These render a modal via <DialogHost /> (mounted in the root
 * layout) and resolve a promise instead. If no host is mounted they fall back
 * to the native dialogs.
 */

export interface DialogOptions {
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Red confirm button for destructive actions */
  danger?: boolean;
}

export interface DialogRequest extends DialogOptions {
  id: number;
  kind: 'alert' | 'confirm';
  message: string;
  resolve: (ok: boolean) => void;
}

type Listener = (queue: DialogRequest[]) => void;

let queue: DialogRequest[] = [];
let listener: Listener | null = null;
let nextId = 1;

const emit = () => listener?.([...queue]);

export function subscribeDialogs(fn: Listener): () => void {
  listener = fn;
  emit();
  return () => {
    if (listener === fn) listener = null;
  };
}

/** Called by the host when the user answers the front dialog. */
export function resolveDialog(id: number, ok: boolean) {
  const req = queue.find(r => r.id === id);
  if (!req) return;
  queue = queue.filter(r => r.id !== id);
  emit();
  req.resolve(ok);
}

function open(kind: DialogRequest['kind'], message: string, opts: DialogOptions = {}): Promise<boolean> {
  if (!listener) {
    if (typeof window === 'undefined') return Promise.resolve(false);
    if (kind === 'alert') {
      window.alert(message);
      return Promise.resolve(true);
    }
    return Promise.resolve(window.confirm(message));
  }
  return new Promise<boolean>(resolve => {
    queue = [...queue, { id: nextId++, kind, message, resolve, ...opts }];
    emit();
  });
}

export const appConfirm = (message: string, opts?: DialogOptions) => open('confirm', message, opts);

export const appAlert = async (message: string, opts?: DialogOptions) => {
  await open('alert', message, opts);
};
