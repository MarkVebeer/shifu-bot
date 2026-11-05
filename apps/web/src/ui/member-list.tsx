/**
 * Building blocks of the ranked lists on member pages (goon counter, leveling):
 * a hook that loads a list with search and paging, the search box, and rows.
 */
import { MagnifyingGlass } from '@phosphor-icons/react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { api, ApiRequestError } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { Avatar, Button, Input, cx } from './primitives';

export const LIST_PAGE = 50;

interface ListPage<E> {
  entries: E[];
  matches: number;
}

type ListState<R> = { kind: 'loading' } | { kind: 'ready'; data: R } | { kind: 'error'; code: string };

/**
 * Loads `path` with ?q=&offset=&limit= and keeps the search (and any `extra` params) in the URL,
 * so a filtered list can be shared. The search box value is debounced.
 */
export function useRankedList<E, R extends ListPage<E>>(path: string, extra: Record<string, string> = {}) {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const [search, setSearch] = useState(q);
  const [state, setState] = useState<ListState<R>>({ kind: 'loading' });
  const [loadingMore, setLoadingMore] = useState(false);
  const [retry, setRetry] = useState(0);
  const extraKey = JSON.stringify(extra);

  // Debounced search, kept in the URL next to the other params.
  useEffect(() => {
    const timer = setTimeout(() => {
      if (search.trim() === q) return;
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          if (search.trim()) next.set('q', search.trim());
          else next.delete('q');
          return next;
        },
        { replace: true },
      );
    }, 250);
    return () => clearTimeout(timer);
  }, [search, q, setParams]);

  const query = useCallback(
    (offset: number) =>
      new URLSearchParams({ ...(JSON.parse(extraKey) as Record<string, string>), limit: String(LIST_PAGE), ...(offset ? { offset: String(offset) } : {}), ...(q ? { q } : {}) }),
    [extraKey, q],
  );

  useEffect(() => {
    const abort = new AbortController();
    // Keep showing the old list while a new search loads, so the page does not jump.
    setState((current) => (current.kind === 'ready' ? current : { kind: 'loading' }));
    api<R>(`${path}?${query(0)}`, { signal: abort.signal })
      .then((data) => setState({ kind: 'ready', data }))
      .catch((error: unknown) => {
        if ((error as Error).name === 'AbortError') return;
        setState({ kind: 'error', code: error instanceof ApiRequestError ? error.code : 'internal' });
      });
    return () => abort.abort();
  }, [path, query, retry]);

  const loadMore = useCallback(async () => {
    if (state.kind !== 'ready') return;
    setLoadingMore(true);
    try {
      const next = await api<R>(`${path}?${query(state.data.entries.length)}`);
      setState({ kind: 'ready', data: { ...next, entries: [...state.data.entries, ...next.entries] } });
    } catch {
      // Keep what is shown; the button stays so the user can try again.
    } finally {
      setLoadingMore(false);
    }
  }, [state, path, query]);

  return { q, search, setSearch, state, loadingMore, loadMore, retry: () => setRetry((n) => n + 1) };
}

export function SearchBox({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const { t } = useI18n();
  return (
    <div className="relative">
      <MagnifyingGlass className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <Input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={t('memberPages.search')}
        aria-label={t('memberPages.searchLabel')}
        maxLength={100}
        className="pl-11"
      />
    </div>
  );
}

/** One ranked member. The top 3 get a medal and a bigger row; the viewer's own row is highlighted. */
export function RankRow({
  rank,
  name,
  avatarUrl,
  mine,
  value,
  detail,
}: {
  rank: number;
  name: string;
  avatarUrl: string | null;
  mine: boolean;
  /** The number the list is ranked by, shown on the right. */
  value: ReactNode;
  /** Optional second line under the name, e.g. levels. */
  detail?: ReactNode;
}) {
  const { t, locale } = useI18n();
  const podium = rank <= 3;
  return (
    <li
      className={cx('flex items-center gap-3 rounded-lg border bg-card px-4 shadow-sm sm:gap-4', podium ? 'py-4' : 'py-2.5', mine && 'border-primary')}
      aria-current={mine || undefined}
    >
      <RankMark rank={rank} label={formatNumber(rank, locale)} className="w-10" />
      <Avatar src={avatarUrl} name={name} size={podium ? 44 : 36} />
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-2">
          <span className={cx('truncate', podium && 'text-lg font-semibold')}>{name}</span>
          {mine && <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-primary">{t('memberPages.you')}</span>}
        </span>
        {detail && <span className="mt-0.5 block truncate text-xs text-muted-foreground">{detail}</span>}
      </span>
      <span className={cx('shrink-0 text-right font-mono font-bold', podium ? 'text-xl' : 'text-base')}>{value}</span>
    </li>
  );
}

/** "Your place" card above a list. */
export function YourPlace({ rank, name, value, unit, detail }: { rank: number; name: string; value: ReactNode; unit: string; detail?: ReactNode }) {
  const { t, locale } = useI18n();
  return (
    <section className="flex items-center gap-4 rounded-lg border border-primary/60 bg-card px-5 py-4 shadow-sm" aria-label={t('memberPages.yourPlace')}>
      <span className="grid min-w-14 place-items-center rounded-md bg-muted px-2 py-1 font-mono text-xl font-bold text-primary ring-1 ring-primary/30">
        #{formatNumber(rank, locale)}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm text-muted-foreground">{t('memberPages.yourPlace')}</p>
        <p className="truncate font-semibold">{name}</p>
        {detail && <p className="truncate text-xs text-muted-foreground">{detail}</p>}
      </div>
      <span className="text-right">
        <span className="block font-mono text-2xl font-bold">{value}</span>
        <span className="text-xs text-muted-foreground">{unit}</span>
      </span>
    </section>
  );
}

/** The list, its empty and no-result states, the match count and the "Show more" button. */
export function RankedList({
  q,
  matches,
  shown,
  emptyText,
  loadingMore,
  onLoadMore,
  children,
}: {
  q: string;
  matches: number;
  shown: number;
  emptyText: string;
  loadingMore: boolean;
  onLoadMore: () => void;
  children: ReactNode;
}) {
  const { t, locale } = useI18n();
  return (
    <>
      {q && matches > 0 && <p className="-mt-2 text-sm text-muted-foreground">{t('memberPages.matches', { count: formatNumber(matches, locale) })}</p>}
      {shown ? (
        <ol className="space-y-2">{children}</ol>
      ) : (
        <p data-slot="card" className="rounded-xl border bg-card p-6 text-center text-muted-foreground shadow-sm">{q ? t('memberPages.noResults', { q }) : emptyText}</p>
      )}
      {shown < matches && (
        <div className="flex justify-center">
          <Button variant="secondary" onClick={onLoadMore} loading={loadingMore}>
            {loadingMore ? t('common.loading') : t('memberPages.loadMore')}
          </Button>
        </div>
      )}
    </>
  );
}

export function formatNumber(value: number, locale: string): string {
  return value.toLocaleString(locale === 'hu' ? 'hu-HU' : 'en-US');
}

/** Rank number. The top three get a filled white circle so the podium stands out without medal emoji. */
export function RankMark({ rank, label, className }: { rank: number; label?: string; className?: string }) {
  const text = label ?? String(rank);
  return (
    <span className={cx('grid shrink-0 place-items-center', className)}>
      {rank <= 3 ? (
        <span className="grid size-8 place-items-center rounded-full bg-foreground font-mono text-sm font-bold text-background">{text}</span>
      ) : (
        <span className="font-mono text-sm text-muted-foreground">#{text}</span>
      )}
    </span>
  );
}
