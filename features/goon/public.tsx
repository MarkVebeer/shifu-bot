/**
 * Goon counter: the full list for members, linked from the Discord panel.
 * Shown inside MemberShell, which handles sign-in, membership and the tabs.
 */
import { useI18n } from '../../apps/web/src/lib/i18n';
import { formatNumber, RankedList, RankRow, SearchBox, useRankedList, YourPlace } from '../../apps/web/src/ui/member-list';
import { ListSkeleton, Message, useMemberServer } from '../../apps/web/src/ui/member-shell';
import { Button } from '../../apps/web/src/ui/primitives';
import type { GoonListResponse } from './server';
import type { GoonListEntry } from './store';

export default function GoonListPage() {
  const { t, locale } = useI18n();
  const { guildId, me } = useMemberServer();
  const list = useRankedList<GoonListEntry, GoonListResponse>(`/servers/${guildId}/goon`);
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
  return (
    <div className="space-y-5">
      <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
        <span>{t('goon.list.total', { count: n(data.total) })}</span>
        <span>{t('goon.list.members', { count: n(data.members) })}</span>
      </p>

      {data.me ? (
        <YourPlace rank={data.me.rank} name={me.user.globalName ?? me.user.username} value={n(data.me.count)} unit={t('goon.list.goons')} />
      ) : (
        <p className="glass-raised px-5 py-4 text-sm text-muted">{t('goon.list.notOnList')}</p>
      )}

      <SearchBox value={list.search} onChange={list.setSearch} />

      <RankedList
        q={list.q}
        matches={data.matches}
        shown={data.entries.length}
        emptyText={t('goon.list.empty')}
        loadingMore={list.loadingMore}
        onLoadMore={() => void list.loadMore()}
      >
        {data.entries.map((entry) => (
          <RankRow
            key={entry.userId}
            rank={entry.rank}
            name={entry.displayName ?? t('goon.top.unknown')}
            avatarUrl={entry.avatarUrl}
            mine={entry.userId === me.user.id}
            value={n(entry.count)}
          />
        ))}
      </RankedList>
    </div>
  );
}
