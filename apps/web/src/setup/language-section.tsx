import { LOCALES, type Locale } from '@shifubot/shared';
import { api } from '../lib/api';
import { useT } from '../lib/i18n';
import { defineSetupSection, type SetupSectionProps } from '../lib/setup';
import { LocaleBadge } from '../ui/locale-badge';
import { ChoiceCards } from '../ui/widgets';

interface LanguageValue {
  locale: Locale;
}

function LanguagePicker({ value, onChange }: SetupSectionProps<LanguageValue>) {
  const t = useT();
  return (
    <ChoiceCards
      aria-label={t('setup.language.title')}
      value={value.locale}
      onChange={(locale) => onChange({ locale })}
      choices={LOCALES.map((locale) => ({
        value: locale,
        leading: <LocaleBadge locale={locale} active={value.locale === locale} size="sm" />,
        title: t(`lang.${locale}`),
        hint: t(`setup.language.${locale}Hint`),
      }))}
    />
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
