import { useEffect, useRef, useState } from 'react';

export type ToastTone = 'success' | 'error' | 'info';

export type ToastNotification = {
  id: string;
  tone: ToastTone;
  title: string;
  message?: string;
};

type ToastInput = Omit<ToastNotification, 'id'> & {
  durationMs?: number;
};

function createToastId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function useDashboardToasts() {
  const [toasts, setToasts] = useState<ToastNotification[]>([]);
  const timers = useRef(new Map<string, number>());

  useEffect(() => {
    return () => {
      for (const timer of timers.current.values()) {
        window.clearTimeout(timer);
      }

      timers.current.clear();
    };
  }, []);

  function dismissToast(id: string) {
    const timer = timers.current.get(id);

    if (timer) {
      window.clearTimeout(timer);
      timers.current.delete(id);
    }

    setToasts((current) => current.filter((toast) => toast.id !== id));
  }

  function pushToast({ durationMs = 4500, ...toast }: ToastInput) {
    const id = createToastId();

    setToasts((current) => [...current, { id, ...toast }]);

    const timer = window.setTimeout(() => {
      dismissToast(id);
    }, durationMs);

    timers.current.set(id, timer);

    return id;
  }

  return { toasts, pushToast, dismissToast };
}

export function ToastViewport({ toasts, onDismiss }: { toasts: ToastNotification[]; onDismiss: (id: string) => void }) {
  return (
    <div className="toast-viewport" aria-live="polite" aria-label="Notifications">
      {toasts.map((toast) => (
        <article key={toast.id} className={`toast toast--${toast.tone}`} role={toast.tone === 'error' ? 'alert' : 'status'}>
          <div className="toast__content">
            <p className="toast__title">{toast.title}</p>
            {toast.message ? <p className="toast__message">{toast.message}</p> : null}
          </div>
          <button type="button" className="toast__dismiss" onClick={() => onDismiss(toast.id)} aria-label="Dismiss notification">
            ×
          </button>
        </article>
      ))}
    </div>
  );
}