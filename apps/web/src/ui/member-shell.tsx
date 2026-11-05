/**
 * The frame around member pages (/servers/:guildId/<feature>): the full lists
 * every member of a server can open from Discord. No dashboard menu, only:
 * top bar (logo, language, logout), the server, tabs to switch between the
 * server's lists, and the page. Also handles signing in and "not a member".
 */
import type { MemberPagesResponse, MeResponse } from '@shifubot/shared';
import { SignOut } from '@phosphor-icons/react';
import { createContext, Suspense, useContext, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import type { AppMessageKey } from '../../../../features';
import { memberPages } from '../features';
import { api, ApiRequestError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useCookieLocale, useI18n } from '../lib/i18n';
import { DiscordGlyph } from '../pages/LoginPage';
import { Avatar, Button, ButtonLink, Card, Logo, Skeleton, cx } from './primitives';
import { Icon } from './icon';
import { LanguageSwitcher } from './widgets';

interface MemberServerValue {
  guildId: string;
  server: MemberPagesResponse['server'];
  me: MeResponse;
}

const MemberServerContext = createContext<MemberServerValue | null>(null);

/** The server and the signed in member, for pages inside MemberShell. */
export function useMemberServer(): MemberServerValue {
  const value = useContext(MemberServerContext);
  if (!value) throw new Error('useMemberServer must be used inside MemberShell');
  return value;
}

type LoadState = { kind: 'loading' } | { kind: 'ready'; data: MemberPagesResponse } | { kind: 'error'; code: string };

export function MemberShell({ guildId, featureId }: { guildId: string; featureId: string }) {
  const { t } = useI18n();
  const { me, loading: authLoading } = useAuth();
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (authLoading || !me) return;
    const abort = new AbortController();
    setState({ kind: 'loading' });
    api<MemberPagesResponse>(`/servers/${guildId}`, { signal: abort.signal })
      .then((data) => setState({ kind: 'ready', data }))
      .catch((error: unknown) => {
        if ((error as Error).name === 'AbortError') return;
        setState({ kind: 'error', code: error instanceof ApiRequestError ? error.code : 'internal' });
      });
    return () => abort.abort();
  }, [authLoading, me, guildId, retry]);

  let body: ReactNode;
  if (authLoading) body = <ShellSkeleton />;
  else if (!me)
    body = (
      <Message title={t('memberPages.signInTitle')} text={t('memberPages.signInBody')}>
        <ButtonLink
          href={`/auth/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`}
          className="mt-6 min-h-12 w-full text-base"
          icon={<DiscordGlyph />}
        >
          {t('memberPages.signIn')}
        </ButtonLink>
      </Message>
    );
  else if (state.kind === 'loading') body = <ShellSkeleton />;
  else if (state.kind === 'error') {
    if (state.code === 'not_member') body = <Message title={t('memberPages.notMemberTitle')} text={t('memberPages.notMemberBody')} />;
    else if (state.code === 'not_found' || state.code === 'validation')
      body = <Message title={t('memberPages.notFoundTitle')} text={t('memberPages.notFoundBody')} />;
    else
      body = (
        <Message title={t('memberPages.errorTitle')} text="">
          <Button className="mt-4" onClick={() => setRetry((n) => n + 1)}>
            {t('memberPages.retry')}
          </Button>
        </Message>
      );
  } else {
    const { server, pages } = state.data;
    const page = memberPages.find((item) => item.id === featureId);
    const tabs = memberPages.filter((item) => pages.includes(item.id));
    body = (
      <div className="space-y-5">
        <header className="flex items-center gap-4">
          <Avatar src={server.iconUrl} name={server.name} size={56} />
          <h1 className="min-w-0 truncate text-2xl font-bold tracking-tight sm:text-3xl">{server.name}</h1>
        </header>
        {tabs.length > 1 && (
          <nav aria-label={t('memberPages.tabs')} className="flex h-11 items-center gap-1 overflow-x-auto rounded-lg bg-muted p-1 text-muted-foreground">
            {tabs.map((tab) => {
              const active = tab.id === featureId;
              return (
                <Link
                  key={tab.id}
                  to={`/servers/${guildId}/${tab.id}`}
                  aria-current={active ? 'page' : undefined}
                  className={cx(
                    'inline-flex h-full flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-md px-4 text-sm font-medium transition-[color,box-shadow]',
                    active ? 'bg-background text-foreground shadow-sm' : 'hover:text-foreground',
                  )}
                >
                  <Icon name={tab.icon} size={16} />
                  {t(`${tab.id}.name` as AppMessageKey)}
                </Link>
              );
            })}
          </nav>
        )}
        {page && pages.includes(featureId) ? (
          <MemberServerContext.Provider value={{ guildId, server, me }}>
            <Suspense fallback={<ListSkeleton />}>
              <page.Page />
            </Suspense>
          </MemberServerContext.Provider>
        ) : (
          <Message title={t('memberPages.notFoundTitle')} text={t('memberPages.notFoundBody')} />
        )}
      </div>
    );
  }

  return <PageFrame>{body}</PageFrame>;
}

function PageFrame({ children }: { children: ReactNode }) {
  const { locale, setLocale } = useCookieLocale();
  const { t } = useI18n();
  const { me, logout } = useAuth();
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col px-4 py-6">
      <div className="mb-6 flex items-center justify-between gap-3">
        <span className="inline-flex min-w-0 items-center gap-2 font-semibold">
          <Logo size={28} />
          {/* On the narrowest phones the logo alone leaves room for the language switch. */}
          <span className="max-[399px]:sr-only">ShifuBot</span>
        </span>
        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
          <LanguageSwitcher value={locale} onChange={setLocale} />
          {me && (
            <Button
              variant="ghost"
              className="px-3 sm:px-4"
              // Stay on this page: after signing out it shows the sign-in card.
              onClick={() => void logout(window.location.pathname + window.location.search)}
              aria-label={t('common.logout')}
              title={t('common.logout')}
              icon={<SignOut className="size-5" aria-hidden />}
            >
              <span className="hidden sm:inline">{t('common.logout')}</span>
            </Button>
          )}
        </div>
      </div>
      <div className="flex-1 animate-fade-up">{children}</div>
    </main>
  );
}

/** A centered card for sign-in, "members only" and errors. */
export function Message({ title, text, children }: { title: string; text: string; children?: ReactNode }) {
  return (
    <div className="flex min-h-[60dvh] items-center justify-center">
      <Card className="w-full max-w-md p-8 text-center sm:p-10">
        <div className="mx-auto mb-5 grid size-16 place-items-center rounded-2xl border bg-muted" aria-hidden>
          <Logo size={40} />
        </div>
        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">{title}</h1>
        {text && <p className="mt-3 text-muted-foreground">{text}</p>}
        {children}
      </Card>
    </div>
  );
}

/** Placeholder rows while a list loads. */
export function ListSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true">
      <Skeleton className="h-20 rounded-lg" />
      <Skeleton className="h-11 rounded-full" />
      {Array.from({ length: 8 }, (_, i) => (
        <Skeleton key={i} className="h-14 rounded-lg" />
      ))}
    </div>
  );
}

function ShellSkeleton() {
  return (
    <div className="space-y-5" aria-busy="true">
      <div className="flex items-center gap-4">
        <Skeleton className="size-14 rounded-full" />
        <Skeleton className="h-8 w-48" />
      </div>
      <Skeleton className="h-12 rounded-full" />
      <ListSkeleton />
    </div>
  );
}
