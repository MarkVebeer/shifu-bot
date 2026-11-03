import { LOCALES, type Locale } from '@shifubot/shared';
import { api } from '../lib/api';
import { useT } from '../lib/i18n';
import { defineSetupSection, type SetupSectionProps } from '../lib/setup';
import { LocaleBadge } from '../ui/locale-badge';
import { cx } from '../ui/primitives';

interface LanguageValue {
  locale: Locale;
}

function LanguagePicker({ value, onChange }: SetupSectionProps<LanguageValue>) {
  const t = useT();
  return (
    <div role="radiogroup" aria-label={t('setup.language.title')} className="grid gap-3 sm:grid-cols-2">
      {LOCALES.map((locale) => {
        const selected = value.locale === locale;
        return (
          <button
            key={locale}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange({ locale })}
            className={cx(
              'glass-raised flex min-h-16 items-center gap-4 px-4 py-3 text-left transition duration-200',
              selected ? 'border-primary/70 shadow-glow' : 'hover:border-primary/40',
            )}
          >
            <LocaleBadge locale={locale} active={selected} />
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">{t(`lang.${locale}`)}</span>
              <span className="block text-sm text-muted">{t(`setup.language.${locale}Hint`)}</span>
            </span>
            <span
              aria-hidden
              className={cx(
                'grid size-6 shrink-0 place-items-center rounded-full border-2 transition',
                selected ? 'border-primary bg-primary' : 'border-line',
              )}
            >
              {selected && <span className="size-2 rounded-full bg-bg" />}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export const languageSection = defineSetupSection<LanguageValue>({
  id: 'language',
  emoji: 'globe',
  title: 'setup.language.title',
  description: 'setup.language.description',
  load: async (guild) => ({ locale: guild.locale }),
  save: async (guild, value) => {
    await api(`/guilds/${guild.id}/settings`, { method: 'PUT', body: { locale: value.locale } });
  },
  summary: (value, t) => t(`lang.${value.locale}`),
  Component: LanguagePicker,
});
