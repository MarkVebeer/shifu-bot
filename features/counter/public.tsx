/**
 * Counters: the full list for members, linked from the Discord panel.
 * Shown inside MemberShell, which handles sign-in, membership and the tabs between
 * features. When several counters are on, tabs here switch between them (?c=<id>).
 */
import { useSearchParams } from 'react-router';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useI18n } from '../../apps/web/src/lib/i18n';
import { formatNumber, RankedList, RankRow, SearchBox, useRankedList, YourPlace } from '../../apps/web/src/ui/member-list';
import { ListSkeleton, Message, useMemberServer } from '../../apps/web/src/ui/member-shell';
import { Button } from '../../apps/web/src/ui/primitives';
import type { CounterListResponse } from './server';
import type { CounterListEntry } from './store';

export default function CounterListPage() {
  const { t, locale } = useI18n();
  const { guildId, me } = useMemberServer();
  const [params, setParams] = useSearchParams();
  const requested = params.get('c');
  const list = useRankedList<CounterListEntry, CounterListResponse>(`/servers/${guildId}/counter`, requested ? { counter: requested } : {});
  const n = (value: number) => formatNumber(value, locale);

  if (list.state.kind === 'loading') return <ListSkeleton />;
  if (list.state.kind === 'error')
    return (
      <Message title={t('memberPages.errorTitle')} text="">
        <Button className="mt-4" onClick={list.retry}>
          {t('memberPages.retry')}
        </Button>
      </Message>
    );

  const { data } = list.state;
  const counter = data.counters.find((item) => item.id === data.counterId);
  const unit = counter?.unit ?? '';

  const pick = (id: string) =>
    setParams(
      (current) => {
        const updated = new URLSearchParams(current);
        updated.set('c', id);
        return updated;
      },
      { replace: true },
    );

  return (
    <div className="space-y-5">
      {data.counters.length > 1 ? (
        <Tabs value={String(data.counterId)} onValueChange={pick}>
          <TabsList aria-label={t('counter.list.pick')} className="flex h-11 w-full justify-start overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {data.counters.map((item) => (
              <TabsTrigger key={item.id} value={String(item.id)} className="max-w-56 flex-1 basis-auto">
                <span aria-hidden>{item.emoji}</span>
                <span className="truncate">{item.name}</span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      ) : (
        counter && (
          <h2 className="flex min-w-0 items-center gap-2 text-lg font-semibold">
            <span aria-hidden>{counter.emoji}</span>
            <span className="min-w-0 break-words">{counter.name}</span>
          </h2>
        )
      )}

      <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
        <span>{t('counter.list.total', { count: n(data.total), unit })}</span>
        <span>{t('counter.list.members', { count: n(data.members) })}</span>
      </p>

      {data.me ? (
        <YourPlace rank={data.me.rank} name={me.user.globalName ?? me.user.username} value={n(data.me.count)} unit={unit} />
      ) : (
        <p className="rounded-lg border bg-muted/50 px-5 py-4 text-sm text-muted-foreground">{t('counter.list.notOnList')}</p>
      )}

      <SearchBox value={list.search} onChange={list.setSearch} />

      <RankedList
        q={list.q}
        matches={data.matches}
        shown={data.entries.length}
        emptyText={t('counter.list.empty')}
        loadingMore={list.loadingMore}
        onLoadMore={() => void list.loadMore()}
      >
        {data.entries.map((entry) => (
          <RankRow
            key={entry.userId}
            rank={entry.rank}
            name={entry.displayName ?? t('counter.top.unknown')}
            avatarUrl={entry.avatarUrl}
            mine={entry.userId === me.user.id}
            value={n(entry.count)}
          />
        ))}
      </RankedList>
    </div>
  );
}
