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
      success: (message: string) => toast.success(message, { duration: 4000 }),
      error: (message: string) => toast.error(message, { duration: 7000 }),
    }),
    [],
  );
}
