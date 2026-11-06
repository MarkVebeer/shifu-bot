/**
 * "Chat level 12" style badge with the level kind's icon. The same icon and wording for a level kind everywhere.
 */
import { useI18n } from '../../apps/web/src/lib/i18n';
import { Icon } from '../../apps/web/src/ui/icon';
import { cx } from '../../apps/web/src/ui/primitives';
import { LEVEL_EMOJI, type LevelTrack } from './manifest';

const badgeTones = {
  text: 'bg-muted text-foreground ring-border',
  voice: 'bg-muted text-foreground ring-border',
  overall: 'bg-foreground text-background ring-foreground',
} as const;

/** `compact` shows only the icon and the number, for rows that must fit a phone. */
export function LevelBadge({ kind, level, compact }: { kind: LevelTrack | 'overall'; level?: number; compact?: boolean }) {
  const { t } = useI18n();
  const label = t(`leveling.tracks.${kind}`);
  const text = level === undefined ? t('leveling.levels.name', { label }) : t('leveling.levels.badge', { label, level });
  return (
    <span title={compact ? text : undefined} className={cx('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ring-1', badgeTones[kind])}>
      <Icon name={LEVEL_EMOJI[kind]} size={14} />
      {compact ? (
        <>
          <span aria-hidden>{level}</span>
          <span className="sr-only">{text}</span>
        </>
      ) : (
        text
      )}
    </span>
  );
}
