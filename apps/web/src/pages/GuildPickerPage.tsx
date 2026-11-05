import type { GuildListItem } from '@shifubot/shared';
import { ArrowRight, ArrowsClockwise, Plus, SignOut } from '@phosphor-icons/react';
import { useState } from 'react';
import { Link } from 'react-router';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { errorText, useCookieLocale, useT } from '../lib/i18n';
import { useApi } from '../lib/use-api';
import { Button as UiButton } from '@/components/ui/button';
import { Alert, Avatar, Badge, Button, ButtonLink, Logo, Skeleton, Card, PageHeader } from '../ui/primitives';
import { LanguageSwitcher } from '../ui/widgets';

export function GuildPickerPage() {
  const t = useT();
  const { me, logout } = useAuth();
  const { locale, setLocale } = useCookieLocale();
  const { data, error, loading, setData } = useApi<{ guilds: GuildListItem[] }>('/guilds');
  const [refreshing, setRefreshing] = useState(false);

  const refresh = async () => {
    setRefreshing(true);
    try {
      setData(await api<{ guilds: GuildListItem[] }>('/guilds?refresh=1'));
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 border-b border-border bg-background/70 backdrop-blur-xl">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3">
          <Logo size={32} />
          <span className="font-semibold">ShifuBot</span>
          <div className="ml-auto flex items-center gap-2">
            <div className="hidden sm:block">
              <LanguageSwitcher value={locale} onChange={setLocale} />
            </div>
            {me && <Avatar src={me.user.avatarUrl} name={me.user.username} size={36} />}
            <Button variant="ghost" size="icon" onClick={() => void logout()} aria-label={t('common.logout')} title={t('common.logout')}>
              <SignOut className="size-5" aria-hidden />
            </Button>
          </div>
        </div>
      </header>

      <main id="main" className="mx-auto max-w-5xl px-4 py-8">
        <div className="mb-4 sm:hidden">
          <LanguageSwitcher value={locale} onChange={setLocale} />
        </div>
        <PageHeader
          title={t('guilds.title')}
          description={t('guilds.subtitle')}
          actions={
            <Button variant="secondary" onClick={refresh} loading={refreshing} icon={<ArrowsClockwise className="size-4" aria-hidden />}>
              {t('guilds.refresh')}
            </Button>
          }
        />

        {error ? (
          <Alert tone="danger">{errorText(t, error)}</Alert>
        ) : loading || !data ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true" aria-label={t('common.loading')}>
            {Array.from({ length: 6 }, (_, index) => (
              <Card key={index} className="flex items-center gap-4 p-5 sm:p-5">
                <Skeleton className="size-14 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              </Card>
            ))}
          </div>
        ) : data.guilds.length === 0 ? (
          <Alert>{t('guilds.empty')}</Alert>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {data.guilds.map((guild, index) => (
              <li
                key={guild.id}
                data-slot="card" className="flex animate-fade-up flex-col gap-4 rounded-xl border bg-card p-5 text-card-foreground shadow-sm transition-colors hover:bg-accent/30"
                style={{ animationDelay: `${Math.min(index, 10) * 30}ms` }}
              >
                <div className="flex items-center gap-4">
                  <Avatar src={guild.iconUrl} name={guild.name} size={56} />
                  <div className="min-w-0">
                    <h2 className="truncate font-semibold">{guild.name}</h2>
                    <div className="mt-1 flex flex-wrap gap-2">
                      {guild.botPresent ? (
                        <Badge tone="success">{t('guilds.withBot')}</Badge>
                      ) : (
                        <Badge>{t('guilds.withoutBot')}</Badge>
                      )}
                      {guild.memberCount !== null && <Badge>{t('guilds.members', { count: guild.memberCount })}</Badge>}
                    </div>
                  </div>
                </div>
                {guild.botPresent ? (
                  <UiButton asChild className="min-h-11">
                    <Link to={`/guilds/${guild.id}`}>
                      {t('guilds.manage')}
                      <ArrowRight aria-hidden />
                    </Link>
                  </UiButton>
                ) : (
                  <ButtonLink href={guild.inviteUrl} external variant="secondary" icon={<Plus className="size-4" aria-hidden />}>
                    {t('guilds.invite')}
                  </ButtonLink>
                )}
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
