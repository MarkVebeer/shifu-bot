import { CaretRight, GearSix } from '@phosphor-icons/react';
import { Link } from 'react-router';
import { Button as UiButton } from '@/components/ui/button';
import { featurePages } from '../features';
import { useGuild } from '../lib/guild';
import { useT } from '../lib/i18n';
import { Icon } from '../ui/icon';
import { LocaleBadge } from '../ui/locale-badge';
import { PermissionCheck } from '../ui/permission-check';
import { Avatar, Badge, PageHeader } from '../ui/primitives';

export function OverviewPage() {
  const t = useT();
  const { guild } = useGuild();
  const active = guild.features.filter((item) => item.enabled).length;

  return (
    <div className="animate-fade-up space-y-8">
      <PageHeader eyebrow={t('overview.title')} title={guild.name} leading={<Avatar src={guild.iconUrl} name={guild.name} size={52} />} />

      {/* Key facts in one strip instead of a card per number. */}
      <dl className="grid overflow-hidden rounded-lg border bg-card sm:grid-cols-3 sm:divide-x">
        <div className="p-5">
          <dt className="text-xs font-medium uppercase tracking-[0.08em] text-subtle">{t('overview.members')}</dt>
          <dd className="mt-2 text-3xl font-semibold tabular-nums tracking-tight">{guild.memberCount.toLocaleString(guild.locale)}</dd>
        </div>
        <div className="border-t p-5 sm:border-t-0">
          <dt className="text-xs font-medium uppercase tracking-[0.08em] text-subtle">{t('overview.features')}</dt>
          <dd className="mt-2 text-3xl font-semibold tabular-nums tracking-tight">
            {active}
            <span className="text-lg font-normal text-subtle"> / {featurePages.length}</span>
          </dd>
        </div>
        <div className="border-t p-5 sm:border-t-0">
          <dt className="text-xs font-medium uppercase tracking-[0.08em] text-subtle">{t('overview.language')}</dt>
          <dd className="mt-2 flex items-center justify-between gap-3">
            <span className="flex items-center gap-2.5 text-lg font-semibold">
              <LocaleBadge locale={guild.locale} size="sm" active />
              {t(`lang.${guild.locale}`)}
            </span>
            <UiButton asChild variant="ghost" size="sm" className="text-muted-foreground">
              <Link to={`/guilds/${guild.id}/settings`} aria-label={t('overview.changeInSettings')} title={t('overview.changeInSettings')}>
                <GearSix aria-hidden />
              </Link>
            </UiButton>
          </dd>
        </div>
      </dl>

      <PermissionCheck variant="card" />

      <section aria-labelledby="features-heading">
        <h2 id="features-heading" className="mb-3 text-sm font-semibold">
          {t('overview.features')}
        </h2>
        <ul className="divide-y overflow-hidden rounded-lg border bg-card">
          {featurePages.map((feature) => {
            const enabled = guild.features.find((item) => item.id === feature.id)?.enabled ?? false;
            const key = feature.id as 'welcome';
            return (
              <li key={feature.id}>
                <Link
                  to={`/guilds/${guild.id}/features/${feature.id}`}
                  className="group flex items-center gap-4 px-5 py-4 outline-none transition-colors hover:bg-accent/40 focus-visible:bg-accent/40"
                >
                  <Icon name={feature.icon} size={18} className="shrink-0 text-muted-foreground transition-colors group-hover:text-brand" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{t(`${key}.name`)}</span>
                    <span className="mt-0.5 block truncate text-sm text-muted-foreground">{t(`${key}.description`)}</span>
                  </span>
                  <Badge tone={enabled ? 'success' : 'muted'}>{enabled ? t('overview.active') : t('overview.inactive')}</Badge>
                  <CaretRight className="size-4 shrink-0 text-subtle transition group-hover:translate-x-0.5 group-hover:text-foreground" aria-hidden />
                </Link>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
