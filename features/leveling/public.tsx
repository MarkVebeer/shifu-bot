/**
 * Leveling: the full leaderboard for members, linked from the Discord leaderboard panel.
 * Shown inside MemberShell, which handles sign-in, membership and the tabs between lists.
 * When chat and voice both earn XP, the list can be ranked by overall, chat or voice level.
 */
import { useSearchParams } from 'react-router';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useI18n } from '../../apps/web/src/lib/i18n';
import { formatNumber, RankedList, RankRow, SearchBox, useRankedList, YourPlace } from '../../apps/web/src/ui/member-list';
import { ListSkeleton, Message, useMemberServer } from '../../apps/web/src/ui/member-shell';
import { Button, cx } from '../../apps/web/src/ui/primitives';
import { levelsFor, shownLevels, type LeaderboardKind } from './manifest';
import type { LeaderboardListEntry, LeaderboardListResponse } from './server';

const KINDS: LeaderboardKind[] = ['overall', 'text', 'voice'];

export default function LevelingLeaderboardPage() {
  const { t, locale } = useI18n();
  const { guildId, me } = useMemberServer();
  const [params, setParams] = useSearchParams();
  const requested = params.get('by');
  const by = KINDS.includes(requested as LeaderboardKind) ? (requested as LeaderboardKind) : null;
  const list = useRankedList<LeaderboardListEntry, LeaderboardListResponse>(`/servers/${guildId}/leveling`, by ? { by } : {});
  const n = (value: number) => formatNumber(value, locale);
  const label = (kind: LeaderboardKind) => t(`leveling.tracks.${kind}`);

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
  const kinds = shownLevels(data.xpSources);
  const kind = data.by;

  const setKind = (next: LeaderboardKind) =>
    setParams(
      (current) => {
        const updated = new URLSearchParams(current);
        updated.set('by', next);
        return updated;
      },
      { replace: true },
    );

  /** Level and XP of the kind the list is ranked by, plus the other levels as a second line. */
  const describe = (entry: LeaderboardListEntry) => {
    const levels = levelsFor(entry);
    const progress = levels[kind];
    const xp = kind === 'overall' ? levels.totalXp : kind === 'text' ? entry.textXp : entry.voiceXp;
    const others = kinds.filter((other) => other !== kind).map((other) => `${label(other)} ${levels[other].level}`);
    return { level: progress.level, progress, xp, others: others.join(' · ') };
  };

  const value = (level: number, xp: number) => (
    <>
      <span className="block">{t('leveling.list.level', { level: n(level) })}</span>
      <span className="block font-sans text-xs font-normal text-muted-foreground">{t('leveling.list.xp', { xp: n(xp) })}</span>
    </>
  );

  const mine = data.me ? describe(data.me) : null;

  return (
    <div className="space-y-5">
      {kinds.length > 1 && (
        <Tabs value={kind} onValueChange={(next) => setKind(next as LeaderboardKind)}>
          <TabsList aria-label={t('leveling.list.rankBy')} className="grid h-11 w-full grid-cols-3">
            {kinds.map((option) => (
              <TabsTrigger key={option} value={option}>
                {label(option)}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      )}

      <p className="text-sm text-muted-foreground">
        {t('leveling.list.members', { count: n(data.members) })}
        {kind === 'overall' && <> · {t('leveling.list.overallHint')}</>}
      </p>

      {data.me && mine ? (
        <YourPlace
          rank={data.me.rank}
          name={me.user.globalName ?? me.user.username}
          value={n(mine.level)}
          unit={t('leveling.list.levelUnit')}
          detail={t('leveling.list.nextLevel', { left: n(mine.progress.needed - mine.progress.current) })}
        />
      ) : (
        <p className="rounded-lg border bg-muted/50 px-5 py-4 text-sm text-muted-foreground">{t('leveling.list.notOnList')}</p>
      )}

      <SearchBox value={list.search} onChange={list.setSearch} />

      <RankedList
        q={list.q}
        matches={data.matches}
        shown={data.entries.length}
        emptyText={t('leveling.list.empty')}
        loadingMore={list.loadingMore}
        onLoadMore={() => void list.loadMore()}
      >
        {data.entries.map((entry) => {
          const info = describe(entry);
          return (
            <RankRow
              key={entry.userId}
              rank={entry.rank}
              name={entry.displayName}
              avatarUrl={entry.avatarUrl}
              mine={entry.userId === me.user.id}
              value={value(info.level, info.xp)}
              detail={info.others || undefined}
            />
          );
        })}
      </RankedList>
    </div>
  );
}
