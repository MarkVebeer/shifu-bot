import { CheckCircle2, X, XCircle } from 'lucide-react';
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { useT } from '../lib/i18n';
import { cx } from './primitives';

type ToastTone = 'success' | 'error';
interface ToastItem {
  id: number;
  tone: ToastTone;
  message: string;
}

const ToastContext = createContext<((tone: ToastTone, message: string) => void) | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setItems((current) => current.filter((item) => item.id !== id)), []);
  const push = useCallback(
    (tone: ToastTone, message: string) => {
      const id = nextId.current++;
      setItems((current) => [...current.slice(-3), { id, tone, message }]);
      setTimeout(() => dismiss(id), tone === 'error' ? 7000 : 4000);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={push}>
      {children}
      <ToastViewport items={items} dismiss={dismiss} />
    </ToastContext.Provider>
  );
}

function ToastViewport({ items, dismiss }: { items: ToastItem[]; dismiss: (id: number) => void }) {
  const t = useT();
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-3 z-[60] flex flex-col items-center gap-2 px-4 sm:top-auto sm:bottom-6 sm:right-6 sm:left-auto sm:items-end"
    >
      {items.map((item) => (
        <div
          key={item.id}
          role={item.tone === 'error' ? 'alert' : 'status'}
          className={cx(
            'glass pointer-events-auto flex w-full max-w-sm animate-toast-in items-center gap-3 px-4 py-3 text-sm',
            item.tone === 'success' ? 'border-success/40' : 'border-danger/40',
          )}
        >
          {item.tone === 'success' ? (
            <CheckCircle2 className="size-5 shrink-0 text-success" aria-hidden />
          ) : (
            <XCircle className="size-5 shrink-0 text-danger" aria-hidden />
          )}
          <p className="min-w-0 flex-1">{item.message}</p>
          <button
            type="button"
            onClick={() => dismiss(item.id)}
            className="grid size-8 shrink-0 place-items-center rounded-full text-muted hover:bg-raised hover:text-ink"
            aria-label={t('toast.close')}
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
      ))}
    </div>
  );
}

export function useToast() {
  const push = useContext(ToastContext);
  if (!push) throw new Error('useToast must be used inside ToastProvider');
  return useMemo(
    () => ({ success: (message: string) => push('success', message), error: (message: string) => push('error', message) }),
    [push],
  );
}
