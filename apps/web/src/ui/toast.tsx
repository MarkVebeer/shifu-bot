/**
 * Toasts, shown with shadcn/ui's Sonner. Pages call useToast().success / .error;
 * the provider renders the one Toaster for the app.
 */
import { useMemo, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Toaster } from '@/components/ui/sonner';
import { useT } from '../lib/i18n';

export function ToastProvider({ children }: { children: ReactNode }) {
  const t = useT();
  return (
    <>
      {children}
      <Toaster position="bottom-right" visibleToasts={4} closeButton toastOptions={{ closeButton: true }} containerAriaLabel={t('toast.close')} />
    </>
  );
}

export function useToast() {
  return useMemo(
    () => ({
      /** With an `action` (for example Undo) the toast stays longer, so there is time to press it. */
      success: (message: string, options?: { action: { label: string; onClick: () => void } }) =>
        toast.success(message, { duration: options ? 8000 : 4000, action: options?.action }),
      error: (message: string) => toast.error(message, { duration: 7000 }),
    }),
    [],
  );
}
