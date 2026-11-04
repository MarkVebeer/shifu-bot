/**
 * Goon counter: the full list page for members, linked from the Discord panel.
 * Only the list: server header, the viewer's own place, search and the ranking.
 * The bot checks that the signed in user is a member of the server.
 */
import { LogOut, Search } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { api, ApiRequestError } from '../../apps/web/src/lib/api';
import { useAuth } from '../../apps/web/src/lib/auth';
import { useCookieLocale, useI18n } from '../../apps/web/src/lib/i18n';
import { DiscordGlyph } from '../../apps/web/src/pages/LoginPage';
import { Avatar, Button, ButtonLink, Input, Logo, Skeleton, cx } from '../../apps/web/src/ui/primitives';
import { LanguageSwitcher } from '../../apps/web/src/ui/widgets';
import type { GoonListResponse } from './server';
import type { GoonListEntry } from './store';

const PAGE = 50;
const MEDALS = ['🥇', '🥈', '🥉'];

type LoadState = { kind: 'loading' } | { kind: 'ready'; data: GoonListResponse } | { kind: 'error'; code: string };

export default function GoonListPage() {
  const { guildId = '' } = useParams();
  const { t, locale } = useI18n();
  const { me, loading: authLoading } = useAuth();
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const [search, setSearch] = useState(q);
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [loadingMore, setLoadingMore] = useState(false);
  const [retry, setRetry] = useState(0);
  const controller = useRef<AbortController | null>(null);
  const base = `/servers/${guildId}/goon`;
  const number = (value: number) => value.toLocaleString(locale === 'hu' ? 'hu-HU' : 'en-US');

  // Debounced search, kept in the URL so a search can be shared.
  useEffect(() => {
    const timer = setTimeout(() => {
      if (search.trim() === q) return;
      setParams(search.trim() ? { q: search.trim() } : {}, { replace: true });
    }, 250);
    return () => clearTimeout(timer);
  }, [search, q, setParams]);

  useEffect(() => {
    if (authLoading || !me) return;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setState((current) => (current.kind === 'ready' ? current : { kind: 'loading' }));
    const query = new URLSearchParams({ limit: String(PAGE), ...(q ? { q } : {}) });
    api<GoonListResponse>(`${base}?${query}`, { signal: abort.signal })
      .then((data) => setState({ kind: 'ready', data }))
      .catch((error: unknown) => {
        if ((error as Error).name === 'AbortError') return;
        setState({ kind: 'error', code: error instanceof ApiRequestError ? error.code : 'internal' });
      });
    return () => abort.abort();
  }, [authLoading, me, base, q, retry]);

  const loadMore = useCallback(async () => {
    if (state.kind !== 'ready') return;
    setLoadingMore(true);
    try {
      const query = new URLSearchParams({ limit: String(PAGE), offset: String(state.data.entries.length), ...(q ? { q } : {}) });
      const next = await api<GoonListResponse>(`${base}?${query}`);
      setState({ kind: 'ready', data: { ...next, entries: [...state.data.entries, ...next.entries] } });
    } catch {
      // Keep what is shown; the button stays so the user can try again.
    } finally {
      setLoadingMore(false);
    }
  }, [state, base, q]);

  let body;
  if (authLoading) body = <ListSkeleton />;
  else if (!me)
    body = (
      <Message title={t('goon.list.signInTitle')} text={t('goon.list.signInBody')}>
        <ButtonLink
          href={`/auth/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`}
          className="mt-6 min-h-12 w-full text-base"
          icon={<DiscordGlyph />}
        >
          {t('goon.list.signIn')}
        </ButtonLink>
      </Message>
    );
  else if (state.kind === 'loading') body = <ListSkeleton />;
  else if (state.kind === 'error') {
    if (state.code === 'not_member') body = <Message title={t('goon.list.notMemberTitle')} text={t('goon.list.notMemberBody')} />;
    else if (state.code === 'not_found' || state.code === 'validation') body = <Message title={t('goon.list.notFoundTitle')} text={t('goon.list.notFoundBody')} />;
    else
      body = (
        <Message title={t('goon.list.errorTitle')} text="">
          <Button className="mt-4" onClick={() => setRetry((n) => n + 1)}>
            {t('goon.list.retry')}
          </Button>
        </Message>
      );
  } else {
    const { data } = state;
    const more = data.entries.length < data.matches;
    body = (
      <div className="space-y-5">
        <header className="glass flex items-center gap-4 p-5 sm:p-6">
          <Avatar src={data.server.iconUrl} name={data.server.name} size={64} />
          <div className="min-w-0">
            <p className="text-sm font-medium text-muted">
              <span aria-hidden>🍆 </span>
              {t('goon.list.title')}
            </p>
            <h1 className="truncate text-2xl font-bold tracking-tight sm:text-3xl">{data.server.name}</h1>
            <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
              <span>{t('goon.list.total', { count: number(data.total) })}</span>
              <span>{t('goon.list.members', { count: number(data.members) })}</span>
            </p>
          </div>
        </header>

        <section className="glass-raised flex items-center gap-4 border-primary/40 px-5 py-4" aria-label={t('goon.list.yourPlace')}>
          {data.me ? (
            <>
              <span className="grid min-w-14 place-items-center rounded-token bg-brand-soft px-2 py-1 font-mono text-xl font-bold text-primary ring-1 ring-primary/30">
                #{number(data.me.rank)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm text-muted">{t('goon.list.yourPlace')}</p>
                <p className="truncate font-semibold">{me.user.globalName ?? me.user.username}</p>
              </div>
              <span className="text-right">
                <span className="block font-mono text-2xl font-bold">{number(data.me.count)}</span>
                <span className="text-xs text-muted">{t('goon.list.goons')}</span>
              </span>
            </>
          ) : (
            <p className="text-sm text-muted">{t('goon.list.notOnList')}</p>
          )}
        </section>

        <div className="relative">
          <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <Input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('goon.list.search')}
            aria-label={t('goon.list.searchLabel')}
            maxLength={100}
            className="pl-11"
          />
        </div>
        {q && data.matches > 0 && <p className="-mt-2 text-sm text-muted">{t('goon.list.matches', { count: number(data.matches) })}</p>}

        {data.entries.length ? (
          <ol className="space-y-2">
            {data.entries.map((entry) => (
              <Row key={entry.userId} entry={entry} mine={entry.userId === me.user.id} number={number} youLabel={t('goon.list.you')} unknown={t('goon.top.unknown')} />
            ))}
          </ol>
        ) : (
          <p className="glass p-6 text-center text-muted">{q ? t('goon.list.noResults', { q }) : t('goon.list.empty')}</p>
        )}

        {more && (
          <div className="flex justify-center">
            <Button variant="secondary" onClick={() => void loadMore()} loading={loadingMore}>
              {loadingMore ? t('goon.list.loading') : t('goon.list.loadMore')}
            </Button>
          </div>
        )}
      </div>
    );
  }

  return (
    <PageFrame>
      {body}
    </PageFrame>
  );
}

function Row({
  entry,
  mine,
  number,
  youLabel,
  unknown,
}: {
  entry: GoonListEntry;
  mine: boolean;
  number: (value: number) => string;
  youLabel: string;
  unknown: string;
}) {
  const podium = entry.rank <= 3;
  const name = entry.displayName ?? unknown;
  return (
    <li
      className={cx(
        'glass-raised flex items-center gap-3 px-4 sm:gap-4',
        podium ? 'py-4' : 'py-2.5',
        mine && 'border-primary/70 shadow-glow',
      )}
      aria-current={mine || undefined}
    >
      <span className={cx('w-10 shrink-0 text-center font-mono', podium ? 'text-2xl' : 'text-sm text-muted')}>
        {MEDALS[entry.rank - 1] ?? `#${number(entry.rank)}`}
      </span>
      <Avatar src={entry.avatarUrl} name={name} size={podium ? 44 : 36} />
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <span className={cx('truncate', podium && 'text-lg font-semibold')}>{name}</span>
        {mine && <span className="shrink-0 rounded-full bg-brand-soft px-2 py-0.5 text-xs font-semibold text-primary">{youLabel}</span>}
      </span>
      <span className={cx('shrink-0 font-mono font-bold', podium ? 'text-xl' : 'text-base')}>{number(entry.count)}</span>
    </li>
  );
}

function PageFrame({ children }: { children: ReactNode }) {
  const { locale, setLocale } = useCookieLocale();
  const { t } = useI18n();
  const { me, logout } = useAuth();
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col px-4 py-6">
      <div className="mb-6 flex items-center justify-between gap-3">
        <span className="inline-flex items-center gap-2 font-semibold">
          <Logo size={28} />
          ShifuBot
        </span>
        <div className="flex items-center gap-1 sm:gap-2">
          <LanguageSwitcher value={locale} onChange={setLocale} />
          {me && (
            <Button
              variant="ghost"
              className="px-3 sm:px-4"
              // Stay on this page: after signing out it shows the sign-in card.
              onClick={() => void logout(window.location.pathname + window.location.search)}
              aria-label={t('common.logout')}
              title={t('common.logout')}
              icon={<LogOut className="size-5" aria-hidden />}
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

function Message({ title, text, children }: { title: string; text: string; children?: ReactNode }) {
  return (
    <div className="flex min-h-[60dvh] items-center justify-center">
      <div className="glass w-full max-w-md p-8 text-center sm:p-10">
        <div className="mx-auto mb-5 grid size-16 place-items-center rounded-3xl bg-brand-soft text-3xl ring-1 ring-primary/30" aria-hidden>
          🍆
        </div>
        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">{title}</h1>
        {text && <p className="mt-3 text-muted">{text}</p>}
        {children}
      </div>
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="space-y-5" aria-busy="true">
      <Skeleton className="h-28 rounded-card" />
      <Skeleton className="h-20 rounded-card" />
      <Skeleton className="h-11 rounded-full" />
      {Array.from({ length: 8 }, (_, i) => (
        <Skeleton key={i} className="h-14 rounded-card" />
      ))}
    </div>
  );
}
