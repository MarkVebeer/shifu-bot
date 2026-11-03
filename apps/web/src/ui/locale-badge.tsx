import type { Locale } from '@shifubot/shared';
import { cx } from './primitives';

/** Language code badge ("EN", "HU"). Used instead of flag emoji, which Windows does not render. */
export function LocaleBadge({ locale, active, size = 'md' }: { locale: Locale; active?: boolean; size?: 'sm' | 'md' }) {
  return (
    <span
      aria-hidden
      className={cx(
        'inline-grid shrink-0 place-items-center rounded-token font-mono font-semibold ring-1 transition',
        size === 'md' ? 'size-11 text-sm' : 'size-8 text-xs',
        active ? 'bg-brand text-bg ring-primary/60' : 'bg-raised text-muted ring-line',
      )}
    >
      {locale.toUpperCase()}
    </span>
  );
}
