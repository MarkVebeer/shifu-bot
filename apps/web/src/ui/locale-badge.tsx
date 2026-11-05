import type { Locale } from '@shifubot/shared';
import { cx } from './primitives';

/** Language code badge ("EN", "HU"). Used instead of flag emoji, which Windows does not render. */
export function LocaleBadge({ locale, active, size = 'md' }: { locale: Locale; active?: boolean; size?: 'sm' | 'md' }) {
  return (
    <span
      aria-hidden
      className={cx(
        'inline-grid shrink-0 place-items-center rounded-md font-mono font-semibold ring-1 transition',
        size === 'md' ? 'size-11 text-sm' : 'size-8 text-xs',
        active ? 'bg-primary text-primary-foreground ring-primary' : 'bg-muted text-muted-foreground ring-border',
      )}
    >
      {locale.toUpperCase()}
    </span>
  );
}
