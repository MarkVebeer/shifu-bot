import { emoji, type Locale } from '@shifubot/shared';
import { ArrowRight, Users } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { featurePages } from '../features';
import { api } from '../lib/api';
import { useGuild } from '../lib/guild';
import { errorText, useT } from '../lib/i18n';
import { Avatar, Badge, Card, CardHeader } from '../ui/primitives';
import { useToast } from '../ui/toast';
import { LanguageSwitcher } from '../ui/widgets';

export function OverviewPage() {
  const t = useT();
  const toast = useToast();
  const { guild, reload } = useGuild();
  const [saving, setSaving] = useState(false);

  const changeLocale = async (locale: Locale) => {
    if (locale === guild.locale || saving) return;
    setSaving(true);
    try {
      await api(`/guilds/${guild.id}/settings`, { method: 'PUT', body: { locale } });
      await reload();
      toast.success(t('toast.saved'));
    } catch (error) {
      toast.error(`${t('toast.saveFailed')}: ${errorText(t, error)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="animate-fade-up space-y-6">
      <header className="flex items-center gap-4">
        <Avatar src={guild.iconUrl} name={guild.name} size={64} />
        <div className="min-w-0">
          <p className="text-sm text-muted">{t('overview.title')}</p>
          <h1 className="truncate text-2xl font-bold tracking-tight sm:text-3xl">{guild.name}</h1>
        </div>
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader icon={<Users className="size-5 text-primary" />} title={t('overview.members')} />
          <p className="font-mono text-4xl font-semibold text-gradient">{guild.memberCount.toLocaleString(guild.locale)}</p>
        </Card>
        <Card>
          <CardHeader icon={emoji.globe} title={t('overview.language')} description={t('overview.languageHelp')} />
          <div aria-busy={saving}>
            <LanguageSwitcher value={guild.locale} onChange={changeLocale} />
          </div>
        </Card>
      </div>

      <section aria-labelledby="features-heading">
        <h2 id="features-heading" className="mb-3 text-lg font-semibold">
          {t('overview.features')}
        </h2>
        <ul className="grid gap-4 md:grid-cols-2">
          {featurePages.map((feature) => {
            const enabled = guild.features.find((item) => item.id === feature.id)?.enabled ?? false;
            const key = feature.id as 'welcome';
            return (
              <li key={feature.id}>
                <Link
                  to={`/guilds/${guild.id}/features/${feature.id}`}
                  className="glass glow-hover group flex h-full items-start gap-4 p-5 hover:-translate-y-0.5"
                >
                  <span className="grid size-12 shrink-0 place-items-center rounded-token bg-brand-soft text-2xl ring-1 ring-primary/25" aria-hidden>
                    {feature.emoji}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="font-semibold">{t(`${key}.name`)}</span>
                      <Badge tone={enabled ? 'success' : 'muted'}>{enabled ? t('overview.active') : t('overview.inactive')}</Badge>
                    </span>
                    <span className="mt-1 block text-sm text-muted">{t(`${key}.description`)}</span>
                  </span>
                  <ArrowRight className="mt-1 size-5 shrink-0 text-muted transition group-hover:translate-x-0.5 group-hover:text-primary" aria-hidden />
                </Link>
              </li>
            );
          })}
          <li>
            <Link
              to={`/guilds/${guild.id}/upcoming`}
              className="flex h-full items-center gap-4 rounded-card border border-dashed border-line p-5 text-muted transition hover:border-primary/50 hover:text-ink"
            >
              <span className="text-2xl" aria-hidden>
                {emoji.soon}
              </span>
              <span className="font-medium">{t('upcoming.title')}</span>
            </Link>
          </li>
        </ul>
      </section>
    </div>
  );
}
