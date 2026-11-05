import { useT } from '../../apps/web/src/lib/i18n';
import { Icon } from '../../apps/web/src/ui/icon';
import { ChoiceCards } from '../../apps/web/src/ui/widgets';
import { activeTracks, LEVEL_EMOJI, XP_SOURCES, type XpSources } from './manifest';

/** "What earns XP": messages and voice, messages only, or voice only. Used on the Leveling page and in setup. */
export function XpSourcePicker({ value, onChange }: { value: XpSources; onChange: (value: XpSources) => void }) {
  const t = useT();
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-medium">{t('leveling.form.sources')}</legend>
      <ChoiceCards
        aria-label={t('leveling.form.sources')}
        className="sm:grid-cols-3"
        value={value}
        onChange={onChange}
        choices={XP_SOURCES.map((source) => ({
          value: source,
          title: (
            <span className="flex items-center gap-2">
              <span aria-hidden className="flex items-center gap-1 text-muted-foreground">
                {activeTracks(source).map((track) => (
                  <Icon key={track} name={LEVEL_EMOJI[track]} size={14} />
                ))}
              </span>
              {t(`leveling.form.sourceOptions.${source}`)}
            </span>
          ),
          hint: t(`leveling.form.sourceHints.${source}`),
        }))}
      />
    </fieldset>
  );
}
