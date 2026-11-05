import { useT } from '../../apps/web/src/lib/i18n';
import { Icon } from '../../apps/web/src/ui/icon';
import { cx } from '../../apps/web/src/ui/primitives';
import { activeTracks, LEVEL_EMOJI, XP_SOURCES, type XpSources } from './manifest';

/** "What earns XP": messages and voice, messages only, or voice only. Used on the Leveling page and in setup. */
export function XpSourcePicker({ value, onChange }: { value: XpSources; onChange: (value: XpSources) => void }) {
  const t = useT();
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-medium text-ink">{t('leveling.form.sources')}</legend>
      <div role="radiogroup" aria-label={t('leveling.form.sources')} className="grid gap-2 sm:grid-cols-3">
        {XP_SOURCES.map((source) => {
          const selected = value === source;
          return (
            <button
              key={source}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(source)}
              className={cx(
                'glass-raised flex min-h-11 flex-col items-start gap-1 px-3 py-2.5 text-left transition duration-200',
                selected ? 'border-white/70' : 'hover:border-white/40',
              )}
            >
              <span className="flex items-center gap-2 text-sm font-semibold">
                <span aria-hidden className="flex items-center gap-1 text-muted">
                  {activeTracks(source).map((track) => (
                    <Icon key={track} name={LEVEL_EMOJI[track]} size={14} />
                  ))}
                </span>
                {t(`leveling.form.sourceOptions.${source}`)}
              </span>
              <span className="text-xs text-muted">{t(`leveling.form.sourceHints.${source}`)}</span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
