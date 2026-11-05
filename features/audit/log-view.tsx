/**
 * The audit log list with its filters. Filters live in the URL query, so a filtered view can be
 * shared and survives a reload.
 */
import type { ChannelOption } from '@shifubot/shared';
import { ArrowsClockwise, DownloadSimple, Funnel, MagnifyingGlass, X } from '@phosphor-icons/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { api } from '../../apps/web/src/lib/api';
import { useGuild } from '../../apps/web/src/lib/guild';
import { errorText, useI18n } from '../../apps/web/src/lib/i18n';
import { useApi } from '../../apps/web/src/lib/use-api';
import { Button as UiButton } from '@/components/ui/button';
import { Toggle } from '@/components/ui/toggle';
import { Alert, Avatar, Button, Card, Field, Input, Select, Skeleton, cx } from '../../apps/web/src/ui/primitives';
import { EventRow } from './event-row';
import { CategoryIcon, categoryLabel, typeLabel } from './labels';
import { AUDIT_CATEGORIES, typesByCategory, USER_ROLES, type AuditCategory, type AuditEvent, type AuditEventsResponse, type AuditUser, type UserRole } from './manifest';

const RANGES = { '1h': 3_600_000, '24h': 86_400_000, '7d': 7 * 86_400_000, '30d': 30 * 86_400_000 } as const;
type Range = keyof typeof RANGES | 'all' | 'custom';
const RANGE_KEYS: Range[] = ['1h', '24h', '7d', '30d', 'all', 'custom'];
const PAGE = 50;
const POLL_MS = 15_000;

/** Funnel params kept in the URL, next to "tab". */
const FILTER_PARAMS = ['range', 'from', 'to', 'categories', 'types', 'user', 'userRole', 'channel', 'q'] as const;

const toLocalInput = (ms: number) => {
  const date = new Date(ms);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
};

type Names = Pick<AuditEventsResponse, 'users' | 'channels' | 'roles'>;

export function LogView({ enabled }: { enabled: boolean }) {
  const { t } = useI18n();
  const { guild } = useGuild();
  const base = `/guilds/${guild.id}/features/audit`;
  const [params, setParams] = useSearchParams();

  const range = (RANGE_KEYS as string[]).includes(params.get('range') ?? '') ? (params.get('range') as Range) : 'all';
  const categories = (params.get('categories') ?? '').split(',').filter((item): item is AuditCategory => (AUDIT_CATEGORIES as readonly string[]).includes(item));
  const types = (params.get('types') ?? '').split(',').filter(Boolean);
  const userId = params.get('user');
  const userRole = ((USER_ROLES as readonly string[]).includes(params.get('userRole') ?? '') ? params.get('userRole') : 'any') as UserRole;
  const channelId = params.get('channel');
  const q = params.get('q') ?? '';

  const setFilter = useCallback(
    (changes: Partial<Record<(typeof FILTER_PARAMS)[number], string | null>>) => {
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          for (const [key, value] of Object.entries(changes)) {
            if (value === null || value === '') next.delete(key);
            else next.set(key, value);
          }
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  // Rolling ranges are computed when the query is built; "refresh" moves them forward.
  const [refreshTick, setRefreshTick] = useState(0);
  const query = useMemo(() => {
    const search = new URLSearchParams();
    if (range in RANGES) search.set('from', String(Date.now() - RANGES[range as keyof typeof RANGES]));
    if (range === 'custom') {
      if (params.get('from')) search.set('from', params.get('from')!);
      if (params.get('to')) search.set('to', params.get('to')!);
    }
    if (categories.length) search.set('categories', categories.join(','));
    if (types.length) search.set('types', types.join(','));
    if (userId) {
      search.set('user', userId);
      search.set('userRole', userRole);
    }
    if (channelId) search.set('channel', channelId);
    if (q.trim()) search.set('q', q.trim());
    return search.toString();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, refreshTick]);

  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [names, setNames] = useState<Names>({ users: {}, channels: {}, roles: {} });
  const [nextBefore, setNextBefore] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [newCount, setNewCount] = useState(0);
  const controller = useRef<AbortController | null>(null);

  const merge = (current: Names, add: Names): Names => ({
    users: { ...current.users, ...add.users },
    channels: { ...current.channels, ...add.channels },
    roles: { ...current.roles, ...add.roles },
  });

  const loadFirst = useCallback(async () => {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setLoading(true);
    setError(null);
    setNewCount(0);
    try {
      const response = await api<AuditEventsResponse>(`${base}/events?${query}&limit=${PAGE}`, { signal: current.signal });
      setEvents(response.events);
      setNames((existing) => merge(existing, response));
      setNextBefore(response.nextBefore);
    } catch (err) {
      if ((err as Error).name !== 'AbortError') setError(err);
    } finally {
      if (controller.current === current) setLoading(false);
    }
    // refreshTick: Refresh must reload even when the query string stays the same (e.g. "All time").
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, query, refreshTick]);

  useEffect(() => {
    void loadFirst();
    return () => controller.current?.abort();
  }, [loadFirst]);

  const loadMore = async () => {
    if (!nextBefore) return;
    setLoadingMore(true);
    try {
      const response = await api<AuditEventsResponse>(`${base}/events?${query}&limit=${PAGE}&before=${nextBefore}`);
      setEvents((current) => [...current, ...response.events]);
      setNames((existing) => merge(existing, response));
      setNextBefore(response.nextBefore);
    } catch (err) {
      setError(err);
    } finally {
      setLoadingMore(false);
    }
  };

  // Look for newer events now and then, without moving the list under the reader.
  const newestId = events[0]?.id ?? 0;
  useEffect(() => {
    if (!enabled || loading) return;
    const timer = setInterval(async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const response = await api<AuditEventsResponse>(`${base}/events?${query}&limit=100&after=${newestId}`);
        setNewCount(response.events.length);
      } catch {
        // Ignore: the next tick tries again.
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [base, query, newestId, enabled, loading]);

  const activeFilters =
    (range !== 'all' ? 1 : 0) + (categories.length ? 1 : 0) + (types.length ? 1 : 0) + (userId ? 1 : 0) + (channelId ? 1 : 0) + (q ? 1 : 0);
  const clearAll = () => setFilter(Object.fromEntries(FILTER_PARAMS.map((key) => [key, null])));

  const exportHref = (format: 'csv' | 'json') => `/api${base}/export?${query}&format=${format}`;

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
      <Filters
        range={range}
        params={params}
        categories={categories}
        types={types}
        userId={userId}
        userRole={userRole}
        channelId={channelId}
        q={q}
        names={names}
        setFilter={setFilter}
        activeFilters={activeFilters}
        clearAll={clearAll}
      />

      <section aria-live="polite" className="min-w-0 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={() => setRefreshTick((tick) => tick + 1)} icon={<ArrowsClockwise className="size-4" aria-hidden />}>
              {t('audit.list.refresh')}
            </Button>
            {newCount > 0 && (
              <Button onClick={() => setRefreshTick((tick) => tick + 1)} className="animate-fade-in">
                {t('audit.list.newEvents', { count: newCount >= 100 ? '99+' : String(newCount) })}
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2 text-sm">
            <DownloadSimple className="size-4 text-muted-foreground" aria-hidden />
            <span className="text-muted-foreground">{t('audit.list.export')}</span>
            {(['csv', 'json'] as const).map((format) => (
              <a key={format} href={exportHref(format)} download className="inline-flex min-h-9 items-center rounded-full border border-border px-3 font-medium hover:border-primary/60">
                {format === 'csv' ? t('audit.list.exportCsv') : t('audit.list.exportJson')}
              </a>
            ))}
          </div>
        </div>

        {!enabled && <Alert tone="info">{t('audit.list.emptyOff')}</Alert>}
        {Boolean(error) && <Alert tone="danger">{errorText(t, error)}</Alert>}

        {loading ? (
          <ul className="space-y-2" aria-busy="true">
            {Array.from({ length: 6 }, (_, index) => (
              <li key={index}>
                <Skeleton className="h-20 w-full" />
              </li>
            ))}
          </ul>
        ) : events.length === 0 ? (
          <Card>
            <p className="text-center text-muted-foreground">{t('audit.list.empty')}</p>
          </Card>
        ) : (
          <>
            <ul className="space-y-2">
              {events.map((event) => (
                <EventRow
                  key={event.id}
                  event={event}
                  names={names}
                  actions={{
                    onUser: (id) => setFilter({ user: id, userRole: 'any' }),
                    onChannel: (id) => setFilter({ channel: id }),
                  }}
                />
              ))}
            </ul>
            <div className="flex justify-center pt-2">
              {nextBefore ? (
                <Button variant="secondary" onClick={() => void loadMore()} loading={loadingMore}>
                  {loadingMore ? t('audit.list.loading') : t('audit.list.loadMore')}
                </Button>
              ) : (
                <p className="text-sm text-muted-foreground">{t('audit.list.end')}</p>
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function Filters({
  range,
  params,
  categories,
  types,
  userId,
  userRole,
  channelId,
  q,
  names,
  setFilter,
  activeFilters,
  clearAll,
}: {
  range: Range;
  params: URLSearchParams;
  categories: AuditCategory[];
  types: string[];
  userId: string | null;
  userRole: UserRole;
  channelId: string | null;
  q: string;
  names: Names;
  setFilter: (changes: Partial<Record<(typeof FILTER_PARAMS)[number], string | null>>) => void;
  activeFilters: number;
  clearAll: () => void;
}) {
  const { t } = useI18n();
  const { guild } = useGuild();
  const [open, setOpen] = useState(false);
  const channels = useApi<{ channels: ChannelOption[] }>(`/guilds/${guild.id}/channels?kind=all`);
  const grouped = useMemo(() => typesByCategory(), []);

  // The search box writes to the URL a moment after typing stops.
  const [text, setText] = useState(q);
  useEffect(() => setText(q), [q]);
  useEffect(() => {
    if (text === q) return;
    const timer = setTimeout(() => setFilter({ q: text || null }), 400);
    return () => clearTimeout(timer);
  }, [text, q, setFilter]);

  const toggleCategory = (category: AuditCategory) => {
    const next = categories.includes(category) ? categories.filter((item) => item !== category) : [...categories, category];
    setFilter({ categories: next.join(',') || null });
  };

  return (
    <aside className="min-w-0">
      <Button variant="secondary" className="mb-3 w-full xl:hidden" onClick={() => setOpen((value) => !value)} aria-expanded={open} icon={<Funnel className="size-4" aria-hidden />}>
        {t('audit.filters.title')}
        {activeFilters > 0 && ` · ${t('audit.filters.active', { count: String(activeFilters) })}`}
      </Button>
      <Card className={cx('space-y-5 xl:sticky xl:top-6 xl:block', open ? 'block' : 'hidden')}>
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-semibold">{t('audit.filters.title')}</h2>
          {activeFilters > 0 && (
            <UiButton variant="link" size="sm" className="h-auto px-0" onClick={clearAll}>
              {t('audit.filters.clear')}
            </UiButton>
          )}
        </div>

        <Field label={t('audit.filters.search')} htmlFor="audit-search">
          <div className="relative">
            <MagnifyingGlass className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input id="audit-search" type="search" value={text} onChange={(event) => setText(event.target.value)} placeholder={t('audit.filters.searchPlaceholder')} className="pl-9" maxLength={200} />
          </div>
        </Field>

        <Field label={t('audit.filters.time')} htmlFor="audit-range">
          <Select id="audit-range" value={range} onChange={(value) => setFilter({ range: value === 'all' ? null : value, ...(value !== 'custom' ? { from: null, to: null } : {}) })}>
            {RANGE_KEYS.map((key) => (
              <option key={key} value={key}>
                {t(`audit.filters.time${key === 'all' ? 'All' : key === 'custom' ? 'Custom' : key}` as 'audit.filters.timeAll')}
              </option>
            ))}
          </Select>
        </Field>
        {range === 'custom' && (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
            {(['from', 'to'] as const).map((key) => (
              <Field key={key} label={t(`audit.filters.${key}`)} htmlFor={`audit-${key}`}>
                <Input
                  id={`audit-${key}`}
                  type="datetime-local"
                  value={params.get(key) ? toLocalInput(Number(params.get(key))) : ''}
                  onChange={(event) => setFilter({ [key]: event.target.value ? String(new Date(event.target.value).getTime()) : null })}
                />
              </Field>
            ))}
          </div>
        )}

        <fieldset>
          <legend className="mb-2 text-sm font-medium">{t('audit.filters.categories')}</legend>
          <div className="flex flex-wrap gap-1.5">
            {AUDIT_CATEGORIES.map((category) => {
              const active = categories.includes(category);
              return (
                <Toggle
                  key={category}
                  variant="outline"
                  size="sm"
                  pressed={active}
                  onPressedChange={() => toggleCategory(category)}
                  className="h-9 rounded-full px-3 text-xs"
                >
                  <CategoryIcon category={category} className="size-3.5" />
                  {categoryLabel(t, category)}
                </Toggle>
              );
            })}
          </div>
        </fieldset>

        <Field label={t('audit.filters.types')} htmlFor="audit-types">
          <div className="space-y-2">
            {types.length > 0 && (
              <ul className="flex flex-wrap gap-1.5">
                {types.map((type) => (
                  <li key={type}>
                    <span className="inline-flex min-h-9 items-center gap-1 rounded-full border bg-muted/50 py-0.5 pl-3 pr-1 text-xs">
                      {typeLabel(t, type)}
                      <UiButton
                        variant="ghost"
                        size="icon-sm"
                        className="size-7 rounded-full text-muted-foreground hover:text-destructive"
                        onClick={() => setFilter({ types: types.filter((item) => item !== type).join(',') || null })}
                        aria-label={t('audit.filters.remove', { name: typeLabel(t, type) })}
                      >
                        <X aria-hidden />
                      </UiButton>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <Select id="audit-types" value="" onChange={(value) => value && setFilter({ types: [...types, value].join(',') })}>
              <option value="">{t('audit.filters.typesPlaceholder')}</option>
              {AUDIT_CATEGORIES.map((category) => (
                <optgroup key={category} label={categoryLabel(t, category)}>
                  {grouped[category]
                    .filter((type) => !types.includes(type))
                    .map((type) => (
                      <option key={type} value={type}>
                        {typeLabel(t, type)}
                      </option>
                    ))}
                </optgroup>
              ))}
            </Select>
          </div>
        </Field>

        <UserFilter userId={userId} names={names} onChange={(id) => setFilter({ user: id, userRole: id ? userRole : null })} />
        {userId && (
          <Field label={t('audit.filters.userRole')} htmlFor="audit-user-role">
            <Select id="audit-user-role" value={userRole} onChange={(value) => setFilter({ userRole: value })}>
              {USER_ROLES.map((role) => (
                <option key={role} value={role}>
                  {t(`audit.filters.userRoles.${role}`)}
                </option>
              ))}
            </Select>
          </Field>
        )}

        <Field label={t('audit.filters.channel')} htmlFor="audit-channel">
          <Select id="audit-channel" value={channelId ?? ''} onChange={(value) => setFilter({ channel: value || null })}>
            <option value="">{t('audit.filters.anyChannel')}</option>
            {(channels.data?.channels ?? [])
              .filter((channel) => channel.kind !== 'category')
              .map((channel) => (
                <option key={channel.id} value={channel.id}>
                  {channel.kind === 'voice' ? '♪' : '#'} {channel.name}
                  {channel.parentName ? ` · ${channel.parentName}` : ''}
                </option>
              ))}
          </Select>
        </Field>
      </Card>
    </aside>
  );
}

/** Pick a member by name or id, from the names the audit log has seen. */
function UserFilter({ userId, names, onChange }: { userId: string | null; names: Names; onChange: (id: string | null) => void }) {
  const { t } = useI18n();
  const { guild } = useGuild();
  const [text, setText] = useState('');
  const [results, setResults] = useState<AuditUser[]>([]);
  const [picked, setPicked] = useState<AuditUser | null>(null);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      api<{ users: AuditUser[] }>(`/guilds/${guild.id}/features/audit/users?q=${encodeURIComponent(text.trim())}`, { signal: controller.signal })
        .then((response) => setResults(response.users))
        .catch(() => undefined);
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [text, focused, guild.id]);

  const selected = userId ? (picked?.id === userId ? picked : names.users[userId]) : null;

  if (userId) {
    const name = selected?.name ?? userId;
    return (
      <Field label={t('audit.filters.user')} htmlFor="audit-user">
        <span className="inline-flex min-h-11 max-w-full items-center gap-2 rounded-full border bg-muted/50 py-1 pl-1 pr-1 text-sm">
          <Avatar src={selected?.avatarUrl ?? null} name={name} size={32} />
          <span className="truncate">{name}</span>
          <UiButton
            id="audit-user"
            variant="ghost"
            size="icon-sm"
            className="rounded-full text-muted-foreground hover:text-destructive"
            onClick={() => onChange(null)}
            aria-label={t('audit.filters.remove', { name })}
          >
            <X aria-hidden />
          </UiButton>
        </span>
      </Field>
    );
  }

  return (
    <Field label={t('audit.filters.user')} htmlFor="audit-user">
      <div className="relative">
        <Input
          id="audit-user"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 150)}
          placeholder={t('audit.filters.userPlaceholder')}
          autoComplete="off"
          role="combobox"
          aria-expanded={focused && results.length > 0}
          aria-controls="audit-user-results"
        />
        {focused && results.length > 0 && (
          <ul id="audit-user-results" role="listbox" className="absolute inset-x-0 top-full z-20 mt-1 max-h-72 animate-in fade-in-0 zoom-in-95 overflow-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
            {results.map((user) => (
              <li key={user.id} role="option" aria-selected={false}>
                <button
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    setPicked(user);
                    setText('');
                    onChange(user.id);
                  }}
                  className="flex w-full items-center gap-2 rounded-sm p-2 text-left text-sm outline-none hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent"
                >
                  <Avatar src={user.avatarUrl} name={user.name} size={28} />
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{user.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">@{user.username}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Field>
  );
}
