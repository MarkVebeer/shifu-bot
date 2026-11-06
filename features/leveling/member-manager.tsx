/**
 * The member list of the leveling page: search, sorting and the members who left. Picking a row
 * opens the XP editor. The filters live in the URL, so a filtered view survives a reload.
 */
import { ArrowCounterClockwise, ArrowsClockwise, ArrowSquareOut, PencilSimple } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { api } from '../../apps/web/src/lib/api';
import { useGuild } from '../../apps/web/src/lib/guild';
import { errorText, useI18n } from '../../apps/web/src/lib/i18n';
import { formatNumber, RankedList, RankMark, SearchBox, useRankedList } from '../../apps/web/src/ui/member-list';
import { Alert, Avatar, Button, Card, cx, Field, Select, Skeleton } from '../../apps/web/src/ui/primitives';
import { useToast } from '../../apps/web/src/ui/toast';
import { ConfirmDialog } from '../../apps/web/src/ui/widgets';
import { LevelBadge } from './level-badge';
import { leaderboardPath, levelsFor, MEMBER_STATUSES, shownLevels, type LeaderboardKind, type LevelTrack, type MemberStatus, type XpSources } from './manifest';
import { MemberEditor, type EditTarget } from './member-editor';
import type { ManagedMember, ManagedMembersResponse, MemberSearchResponse, XpChangeResponse } from './server';

const fromEntry = (entry: ManagedMember): EditTarget => ({
  userId: entry.userId,
  displayName: entry.displayName,
  avatarUrl: entry.avatarUrl,
  textXp: entry.textXp,
  voiceXp: entry.voiceXp,
  rank: entry.left ? null : entry.rank,
  left: entry.left,
});

export function MemberManager({ enabled }: { enabled: boolean }) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const { guild } = useGuild();
  const base = `/guilds/${guild.id}/features/leveling`;
  const [params, setParams] = useSearchParams();
  const status: MemberStatus = params.get('status') === 'left' ? 'left' : 'current';
  const requestedBy = params.get('by');

  const list = useRankedList<ManagedMember, ManagedMembersResponse>(`${base}/members`, {
    ...(requestedBy ? { by: requestedBy } : {}),
    ...(status === 'left' ? { status } : {}),
  });
  const { updateData, retry, q } = list;

  const [others, setOthers] = useState<MemberSearchResponse['members']>([]);
  const [othersTick, setOthersTick] = useState(0);
  const [target, setTarget] = useState<EditTarget | null>(null);
  const [confirmResetAll, setConfirmResetAll] = useState(false);
  const n = (value: number) => formatNumber(value, locale);

  // Members without XP have no row: look for them on Discord too. Quietly empty when that fails.
  useEffect(() => {
    if (q.length < 2 || status === 'left') {
      setOthers([]);
      return;
    }
    const abort = new AbortController();
    api<MemberSearchResponse>(`${base}/members/search?${new URLSearchParams({ q })}`, { signal: abort.signal })
      .then((response) => setOthers(response.members))
      .catch((error: unknown) => {
        if ((error as Error).name !== 'AbortError') setOthers([]);
      });
    return () => abort.abort();
  }, [base, q, status, othersTick]);

  const setParam = (key: 'by' | 'status', value: string | null) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );

  if (list.state.kind === 'loading') {
    return (
      <div className="space-y-3" aria-busy="true">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (list.state.kind === 'error') {
    return (
      <Alert tone="danger" action={<Button variant="secondary" onClick={list.retry}>{t('common.retry')}</Button>}>
        {errorText(t, { code: list.state.code })}
      </Alert>
    );
  }

  const { data } = list.state;
  const kinds = shownLevels(data.xpSources);

  /** Show a correction in place, so the list does not move under the reader. */
  const applyChange = (userId: string, member: ManagedMember | null) => {
    // A member who just got their first XP is not on the list yet.
    if (member && !data.entries.some((entry) => entry.userId === userId)) retry();
    else if (member) updateData((current) => ({ ...current, entries: current.entries.map((entry) => (entry.userId === userId ? member : entry)) }));
    else {
      updateData((current) => {
        const entries = current.entries.filter((entry) => entry.userId !== userId);
        const removed = current.entries.length - entries.length;
        return { ...current, entries, matches: current.matches - removed, members: current.members - removed };
      });
    }
    setOthersTick((tick) => tick + 1);
  };

  const onSaved = (member: EditTarget, track: LevelTrack, result: XpChangeResponse) => {
    setTarget(null);
    applyChange(member.userId, result.member);
    toast.success(t('leveling.manager.saved', { name: member.displayName, before: n(result.before), after: n(result.after) }), {
      action: {
        label: t('leveling.manager.undo'),
        onClick: () => {
          api<XpChangeResponse>(`${base}/members/${member.userId}/xp?by=${data.by}`, { method: 'POST', body: { track, op: 'set', amount: result.before } })
            .then((undone) => {
              applyChange(member.userId, undone.member);
              toast.success(t('leveling.manager.undone'));
            })
            .catch((error: unknown) => toast.error(errorText(t, error)));
        },
      },
    });
  };

  const onReset = (member: EditTarget) => {
    setTarget(null);
    applyChange(member.userId, null);
    toast.success(t('leveling.manager.resetDone', { name: member.displayName }));
  };

  const resetAll = async () => {
    setConfirmResetAll(false);
    try {
      await api(`${base}/reset`, { method: 'POST' });
      retry();
      toast.success(t('leveling.top.resetDone'));
    } catch (error) {
      toast.error(errorText(t, error));
    }
  };

  return (
    <div className="space-y-4">
      {!enabled && <Alert>{t('leveling.manager.disabled')}</Alert>}

      <Card className="sm:p-4">
        <div className="grid items-end gap-3 @2xl:grid-cols-[minmax(0,1fr)_auto]">
          <Field label={t('memberPages.searchLabel')} htmlFor="leveling-manager-search">
            <SearchBox id="leveling-manager-search" value={list.search} onChange={list.setSearch} />
          </Field>
          {/* Side by side even on a phone, so the list starts as high as possible. */}
          <div className="grid grid-cols-2 items-end gap-3 @2xl:flex">
            {kinds.length > 1 && (
              <div className="min-w-0 @2xl:w-44">
                <Field label={t('leveling.list.rankBy')} htmlFor="leveling-manager-by">
                  <Select id="leveling-manager-by" value={data.by} onChange={(value) => setParam('by', value)}>
                    {kinds.map((kind) => (
                      <option key={kind} value={kind}>
                        {t(`leveling.tracks.${kind}`)}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
            )}
            <div className={cx('min-w-0 @2xl:w-44', kinds.length === 1 && 'col-span-2')}>
              <Field label={t('leveling.manager.status')} htmlFor="leveling-manager-status">
                <Select id="leveling-manager-status" value={status} onChange={(value) => setParam('status', value === 'left' ? value : null)}>
                  {MEMBER_STATUSES.map((item) => (
                    <option key={item} value={item}>
                      {t(`leveling.manager.statusOptions.${item}`)}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Button variant="secondary" className="col-span-2" onClick={list.retry} icon={<ArrowsClockwise className="size-4" aria-hidden />}>
              {t('leveling.manager.refresh')}
            </Button>
          </div>
        </div>
      </Card>

      <section aria-live="polite" className="min-w-0 space-y-4">
        <p className="text-sm text-muted-foreground">{t('leveling.list.members', { count: n(data.members) })}</p>
        <RankedList
          q={list.q}
          matches={data.matches}
          shown={data.entries.length}
          emptyText={status === 'left' ? t('leveling.manager.emptyLeft') : t('leveling.manager.empty')}
          loadingMore={list.loadingMore}
          onLoadMore={() => void list.loadMore()}
        >
          {data.entries.map((entry) => (
            <MemberRow key={entry.userId} member={fromEntry(entry)} by={data.by} sources={data.xpSources} onEdit={setTarget} />
          ))}
        </RankedList>

        {others.length > 0 && (
          <div className="space-y-2 pt-2">
            <div>
              <h2 className="text-[15px] font-semibold tracking-tight">{t('leveling.manager.others')}</h2>
              <p className="text-sm text-muted-foreground">{t('leveling.manager.othersHint')}</p>
            </div>
            <ul className="space-y-2">
              {others.map((member) => (
                <MemberRow
                  key={member.userId}
                  member={{ userId: member.userId, displayName: member.displayName, avatarUrl: member.avatarUrl, textXp: 0, voiceXp: 0, rank: null, left: false }}
                  by={data.by}
                  sources={data.xpSources}
                  onEdit={setTarget}
                />
              ))}
            </ul>
          </div>
        )}
      </section>

      <Card className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:p-4">
        <div className="min-w-0 space-y-1">
          <a href={leaderboardPath(guild.id)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline">
            <ArrowSquareOut className="size-4" aria-hidden />
            {t('leveling.top.openList')}
          </a>
          <p className="text-xs text-muted-foreground">{t('leveling.top.openListHelp')}</p>
        </div>
        {status === 'current' && data.members > 0 && (
          <Button variant="ghost" onClick={() => setConfirmResetAll(true)} icon={<ArrowCounterClockwise className="size-4" aria-hidden />}>
            {t('leveling.top.reset')}
          </Button>
        )}
      </Card>

      {target && <MemberEditor key={target.userId} target={target} sources={data.xpSources} by={data.by} onClose={() => setTarget(null)} onSaved={onSaved} onReset={onReset} />}

      <ConfirmDialog
        open={confirmResetAll}
        title={t('leveling.top.resetTitle')}
        body={t('leveling.top.resetBody')}
        confirmLabel={t('leveling.top.resetConfirm')}
        cancelLabel={t('common.cancel')}
        onConfirm={() => void resetAll()}
        onCancel={() => setConfirmResetAll(false)}
      />
    </div>
  );
}

/** One member. The whole row opens the editor. */
function MemberRow({ member, by, sources, onEdit }: { member: EditTarget; by: LeaderboardKind; sources: XpSources; onEdit: (member: EditTarget) => void }) {
  const { t, locale } = useI18n();
  const levels = levelsFor(member);
  const shownXp = by === 'overall' ? levels.totalXp : by === 'text' ? member.textXp : member.voiceXp;
  const xpText = t('leveling.list.xp', { xp: formatNumber(shownXp, locale) });
  return (
    <li>
      <button
        type="button"
        onClick={() => onEdit(member)}
        aria-label={t('leveling.manager.editMember', { name: member.displayName })}
        className="group flex w-full cursor-pointer items-center gap-2.5 rounded-lg border bg-card px-3 py-2.5 text-left shadow-sm outline-none transition-colors hover:bg-accent/50 focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:gap-4 sm:px-4"
      >
        {member.rank !== null && <RankMark rank={member.rank} label={formatNumber(member.rank, locale)} className="w-8 sm:w-10" />}
        <Avatar src={member.avatarUrl} name={member.displayName} size={40} />
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate font-medium">{member.displayName}</span>
            {member.left && <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">{t('leveling.manager.left')}</span>}
          </span>
          {levels.totalXp > 0 ? (
            <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {shownLevels(sources).map((kind) => (
                <LevelBadge key={kind} kind={kind} level={levels[kind].level} compact />
              ))}
              <span className="font-mono text-xs text-muted-foreground @lg:hidden">{xpText}</span>
            </span>
          ) : (
            <span className="mt-0.5 block text-xs text-muted-foreground">{t('leveling.manager.noXp')}</span>
          )}
        </span>
        {levels.totalXp > 0 && <span className="hidden shrink-0 text-right font-mono font-bold @lg:block">{xpText}</span>}
        <span className="flex shrink-0 items-center gap-1.5 text-sm font-medium text-muted-foreground group-hover:text-foreground">
          <PencilSimple className="size-4" aria-hidden />
          <span className="hidden @2xl:inline">{t('leveling.manager.edit')}</span>
        </span>
      </button>
    </li>
  );
}
