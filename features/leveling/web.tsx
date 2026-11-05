/**
 * Leveling feature: dashboard page.
 */
import { Button as UiButton } from '@/components/ui/button';
import { colors, findUnknownPlaceholders } from '@shifubot/shared';
import { ArrowCounterClockwise, ArrowSquareOut, Eye, PaperPlaneTilt, Trophy } from '@phosphor-icons/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../apps/web/src/lib/api';
import { useAuth } from '../../apps/web/src/lib/auth';
import { useGuild } from '../../apps/web/src/lib/guild';
import { errorText, useI18n } from '../../apps/web/src/lib/i18n';
import { useApi } from '../../apps/web/src/lib/use-api';
import { ChannelMultiPicker } from '../../apps/web/src/ui/channel-multi-picker';
import { ChannelPicker } from '../../apps/web/src/ui/channel-picker';
import { DiscordMessagePreview } from '../../apps/web/src/ui/discord-preview';
import { Icon } from '../../apps/web/src/ui/icon';
import { RankMark } from '../../apps/web/src/ui/member-list';
import { Alert, Avatar, Button, Card, CardHeader, Field, Input, Select, Skeleton, Switch, Textarea, cx, PageHeader, Badge } from '../../apps/web/src/ui/primitives';
import { useToast } from '../../apps/web/src/ui/toast';
import { ColorField, ConfirmDialog, SaveBar } from '../../apps/web/src/ui/widgets';
import {
  activeTracks,
  ANNOUNCE_MODES,
  buildLeaderboardPanel,
  buildLevelUpMessage,
  LEADERBOARD_INTERVALS,
  LEADERBOARD_SIZES,
  leaderboardPath,
  LEVEL_EMOJI,
  LEVEL_UP_PLACEHOLDERS,
  levelingSettingsSchema,
  shownLevels,
  XP_RULES,
  type AnnounceMode,
  type LevelingSettings,
  type LevelTrack,
} from './manifest';
import type { ChannelStatus, LevelingErrorCode, LevelingResponse, TopResponse } from './server';
import { XpSourcePicker } from './xp-source-picker';

type TextField = 'title' | 'description';

export default function LevelingPage() {
  const { t, locale: uiLocale } = useI18n();
  const toast = useToast();
  const { me } = useAuth();
  const { guild, setDirty, permissions } = useGuild();
  const base = `/guilds/${guild.id}/features/leveling`;
  const leveling = useApi<LevelingResponse>(base);
  const top = useApi<TopResponse>(`${base}/top`);

  const [draft, setDraft] = useState<LevelingSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [reposting, setReposting] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const saved = leveling.data?.settings;

  useEffect(() => {
    if (saved && !draft) setDraft(saved);
  }, [saved, draft]);

  const dirty = Boolean(draft && saved && JSON.stringify(draft) !== JSON.stringify(saved));
  useEffect(() => setDirty(dirty), [dirty, setDirty]);
  useEffect(() => () => setDirty(false), [setDirty]);

  const fieldRefs = {
    title: useRef<HTMLInputElement>(null),
    description: useRef<HTMLTextAreaElement>(null),
  };
  const lastFocused = useRef<TextField>('description');

  const validation = useMemo(() => (draft ? levelingSettingsSchema.safeParse(draft) : null), [draft]);
  const fieldError = (field: keyof LevelingSettings) =>
    validation && !validation.success ? validation.error.issues.find((issue) => issue.path[0] === field)?.message : undefined;

  const now = useMemo(() => new Date(), []);
  const memberName = me?.user.globalName ?? me?.user.username ?? 'member';
  const topMembers = top.data?.members ?? [];
  // The list is ranked with the saved setting, so it is labeled with that one too.
  const topSources = leveling.data?.settings.xpSources ?? 'both';
  const n = (value: number) => value.toLocaleString(guild.locale);

  const levelUpPayload = useMemo(() => {
    if (!draft || !me) return null;
    return buildLevelUpMessage(
      { ...draft, color: fieldError('color') ? null : draft.color },
      {
        locale: guild.locale,
        member: { id: me.user.id, displayName: memberName, avatarUrl: me.user.avatarUrl },
        track: activeTracks(draft.xpSources)[0]!,
        level: 5,
        server: { name: guild.name },
        now,
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, me, guild, now, memberName, validation]);

  const leaderboardPayload = useMemo(() => {
    if (!draft) return null;
    return buildLeaderboardPanel(
      { color: fieldError('color') ? null : draft.color, leaderboardSize: draft.leaderboardSize, xpSources: draft.xpSources },
      {
        locale: guild.locale,
        server: { name: guild.name },
        entries: topMembers.map((member) => ({ userId: member.userId, textXp: member.textXp, voiceXp: member.voiceXp })),
        updatedAt: now,
        listUrl: `${window.location.origin}${leaderboardPath(guild.id)}`,
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, guild, topMembers, now, validation]);

  if (leveling.error) return <Alert tone="danger">{errorText(t, leveling.error)}</Alert>;
  if (!draft || !leveling.data) return <LevelingSkeleton />;

  const errorLabel = (code: LevelingErrorCode) => t(`leveling.errors.${code}`);
  const update = <K extends keyof LevelingSettings>(key: K, value: LevelingSettings[K]) =>
    setDraft((current) => (current ? { ...current, [key]: value } : current));

  const insertPlaceholder = (name: string) => {
    const field = lastFocused.current;
    const element = fieldRefs[field].current;
    const token = `{${name}}`;
    const value = draft[field];
    const start = element?.selectionStart ?? value.length;
    const end = element?.selectionEnd ?? value.length;
    update(field, value.slice(0, start) + token + value.slice(end));
    requestAnimationFrame(() => {
      element?.focus();
      element?.setSelectionRange(start + token.length, start + token.length);
    });
  };

  const save = async () => {
    if (!validation?.success) {
      toast.error(t('errors.validation'));
      return;
    }
    setSaving(true);
    try {
      const response = await api<LevelingResponse>(base, { method: 'PUT', body: validation.data });
      leveling.setData(response);
      setDraft(response.settings);
      void permissions.reload();
      if (response.panelError) toast.error(t('leveling.panel.failed', { error: errorLabel(response.panelError) }));
      else toast.success(t('toast.saved'));
    } catch (error) {
      toast.error(`${t('toast.saveFailed')}: ${errorText(t, error)}`);
    } finally {
      setSaving(false);
    }
  };

  const repost = async () => {
    setReposting(true);
    try {
      const result = await api<LevelingResponse & { channel: { name: string } | null }>(`${base}/panel`, { method: 'POST' });
      leveling.setData(result);
      if (result.channel) toast.success(t('leveling.panel.reposted', { channel: result.channel.name }));
    } catch (error) {
      const code = (error as { code?: string }).code ?? '';
      toast.error(code in levelingErrorCodes ? errorLabel(code as LevelingErrorCode) : errorText(t, error));
      void leveling.reload();
    } finally {
      setReposting(false);
    }
  };

  const resetAll = async () => {
    setConfirmReset(false);
    try {
      top.setData(await api<TopResponse>(`${base}/reset`, { method: 'POST' }));
      toast.success(t('leveling.top.resetDone'));
    } catch (error) {
      toast.error(errorText(t, error));
    }
  };

  const { status } = leveling.data;
  const warnings: { tone: 'warning' | 'danger'; text: string }[] = [];
  const channelWarning = (state: ChannelStatus | null, selectedId: string | null, savedId: string | null | undefined) => {
    if (!state || selectedId !== savedId) return;
    if (!state.exists) warnings.push({ tone: 'danger', text: t('leveling.status.channelMissing') });
    else if (state.missingPermissions.length)
      warnings.push({
        tone: 'danger',
        text: t('leveling.status.missingPermissions', { channel: state.name ?? '', permissions: state.missingPermissions.join(', ') }),
      });
  };
  if (draft.enabled) {
    if (draft.announceMode === 'channel') {
      if (!draft.announceChannelId) warnings.push({ tone: 'warning', text: t('leveling.status.noAnnounceChannel') });
      channelWarning(status.announceChannel, draft.announceChannelId, saved?.announceChannelId);
    }
    channelWarning(status.leaderboardChannel, draft.leaderboardChannelId, saved?.leaderboardChannelId);
  }
  if (status.lastError && saved?.enabled) warnings.push({ tone: 'warning', text: t('leveling.status.lastError', { error: errorLabel(status.lastError.code) }) });

  const placeholderHint = (field: TextField) => {
    const unknown = findUnknownPlaceholders(draft[field], LEVEL_UP_PLACEHOLDERS);
    return unknown.length ? t('leveling.form.unknownPlaceholder', { names: unknown.map((n) => `{${n}}`).join(', ') }) : undefined;
  };

  const timeLabel = t('leveling.preview.today', {
    time: new Intl.DateTimeFormat(uiLocale, { hour: '2-digit', minute: '2-digit' }).format(now),
  });
  const intervalLabel = (minutes: number) =>
    minutes === 1 ? t('leveling.form.interval1') : minutes === 60 ? t('leveling.form.interval60') : t('leveling.form.interval', { count: minutes });
  const mentions = Object.fromEntries([...topMembers.map((member) => [member.userId, member.displayName]), ...(me ? [[me.user.id, memberName]] : [])]);
  const showPanelTools = saved?.enabled && saved.leaderboardChannelId;

  const previews = (
    <div className="space-y-6">
      {levelUpPayload && draft.announceMode !== 'off' && (
        <Card className="space-y-4">
          <CardHeader icon={<Eye className="size-5 text-primary" />} title={t('leveling.preview.levelUpTitle')} description={t('leveling.preview.levelUpHint')} />
          <DiscordMessagePreview payload={levelUpPayload} bot={guild.bot} mentions={mentions} botTag={t('leveling.preview.botTag')} timestampLabel={timeLabel} />
        </Card>
      )}
      {leaderboardPayload && draft.leaderboardChannelId && (
        <Card className="space-y-4">
          <CardHeader icon={<Trophy className="size-5 text-primary" />} title={t('leveling.preview.leaderboardTitle')} description={t('leveling.preview.leaderboardHint')} />
          <DiscordMessagePreview payload={leaderboardPayload} bot={guild.bot} mentions={mentions} botTag={t('leveling.preview.botTag')} timestampLabel={timeLabel} />
          {showPanelTools && (
            <div className="space-y-3">
              {status.panel ? (
                <a href={status.panel.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline">
                  <ArrowSquareOut className="size-4" aria-hidden />
                  {t('leveling.status.panelLive', { channel: status.panel.channelName })}
                </a>
              ) : (
                <p className="text-sm text-warning">{t('leveling.status.panelMissing')}</p>
              )}
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <Button variant="secondary" onClick={repost} loading={reposting} disabled={dirty} icon={<PaperPlaneTilt className="size-4" aria-hidden />}>
                  {reposting ? t('leveling.panel.reposting') : t('leveling.panel.repost')}
                </Button>
                <p className="text-xs text-muted-foreground">{t('leveling.panel.help')}</p>
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  );

  return (
    <div className="animate-fade-up space-y-6">
      <PageHeader
        title={t('leveling.name')}
        description={t('leveling.description')}
        badge={<Badge tone={leveling.data.settings.enabled ? 'success' : 'muted'}>{leveling.data.settings.enabled ? t('overview.active') : t('overview.inactive')}</Badge>}
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,460px)]">
        <div className="lg:order-last">
          <div className="lg:sticky lg:top-10">{previews}</div>
        </div>

        <form
          className="space-y-6"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
          noValidate
        >
          {warnings.map((warning) => (
            <Alert key={warning.text} tone={warning.tone}>
              {warning.text}
            </Alert>
          ))}

          <Card>
            <CardHeader
              icon={<Icon name="sparkle" />}
              title={t('leveling.form.general')}
              description={[
                draft.xpSources !== 'voice' && t('leveling.form.rulesText', { min: XP_RULES.messageMin, max: XP_RULES.messageMax }),
                draft.xpSources !== 'text' && t('leveling.form.rulesVoice', {
                    voice: XP_RULES.voicePerMinute.toLocaleString(guild.locale),
                    cap: XP_RULES.voiceDailyCap,
                    hours: XP_RULES.voiceCapMinutes / 60,
                  }),
                draft.xpSources === 'both' && t('leveling.form.rulesBoth'),
              ]
                .filter(Boolean)
                .join(' ')}
            />
            <ul className="mb-5 grid gap-2 sm:grid-cols-3" aria-label={t('leveling.levels.title')}>
              {shownLevels(draft.xpSources).map((kind) => (
                <li key={kind} className="rounded-lg border bg-muted/50 px-3 py-2.5">
                  <LevelBadge kind={kind} />
                  <p className="mt-1.5 text-xs text-muted-foreground">{t(`leveling.levels.${kind}Help`)}</p>
                </li>
              ))}
            </ul>
            <div className="space-y-5">
              <Switch checked={draft.enabled} onChange={(value) => update('enabled', value)} label={t('leveling.form.enabled')} description={t('leveling.form.enabledHelp')} />
              <XpSourcePicker value={draft.xpSources} onChange={(value) => update('xpSources', value)} />
              <ChannelMultiPicker
                id="leveling-ignored"
                value={draft.ignoredChannelIds}
                onChange={(value) => update('ignoredChannelIds', value)}
                label={t('leveling.form.ignored')}
                help={t('leveling.form.ignoredHelp')}
                placeholder={t('leveling.form.ignoredPlaceholder')}
                emptyText={t('leveling.form.ignoredEmpty')}
                removeLabel={(name) => t('leveling.form.remove', { name })}
                error={fieldError('ignoredChannelIds')}
              />
            </div>
          </Card>

          <Card>
            <CardHeader icon={<Icon name="rocket" />} title={t('leveling.form.levelUp')} description={t('leveling.form.defaultHint')} />
            <div className="space-y-5">
              <Field label={t('leveling.form.announceMode')} help={t(`leveling.form.announceModesHelp.${draft.announceMode}`)} htmlFor="leveling-announce-mode">
                <Select id="leveling-announce-mode" value={draft.announceMode} onChange={(value) => update('announceMode', value as AnnounceMode)} aria-describedby="leveling-announce-mode-help">
                  {ANNOUNCE_MODES.map((mode) => (
                    <option key={mode} value={mode}>
                      {t(`leveling.form.announceModes.${mode}`)}
                    </option>
                  ))}
                </Select>
              </Field>
              {draft.announceMode !== 'off' && (
                <>
                  {/* "Where it happened" speaks for itself: a channel is only needed for "In a chosen channel". */}
                  {draft.announceMode === 'channel' && (
                    <ChannelPicker
                      id="leveling-announce-channel"
                      label={t('leveling.form.announceChannel')}
                      value={draft.announceChannelId}
                      onChange={(value) => update('announceChannelId', value)}
                      error={fieldError('announceChannelId')}
                    />
                  )}
                  <Field label={t('leveling.form.title')} htmlFor="leveling-title" error={fieldError('title')} warning={placeholderHint('title')}>
                    <Input
                      id="leveling-title"
                      ref={fieldRefs.title}
                      value={draft.title}
                      maxLength={200}
                      placeholder={t('leveling.defaults.title')}
                      onFocus={() => (lastFocused.current = 'title')}
                      onChange={(event) => update('title', event.target.value)}
                    />
                  </Field>
                  <Field label={t('leveling.form.description')} htmlFor="leveling-description" error={fieldError('description')} warning={placeholderHint('description')}>
                    <Textarea
                      id="leveling-description"
                      ref={fieldRefs.description}
                      value={draft.description}
                      maxLength={2000}
                      rows={3}
                      placeholder={t('leveling.defaults.description')}
                      onFocus={() => (lastFocused.current = 'description')}
                      onChange={(event) => update('description', event.target.value)}
                    />
                  </Field>
                  <div>
                    <p className="mb-2 text-sm font-medium">{t('leveling.form.placeholders')}</p>
                    <ul className="flex flex-wrap gap-2">
                      {LEVEL_UP_PLACEHOLDERS.map((name) => (
                        <li key={name}>
                          <UiButton
                            type="button"
                            onClick={() => insertPlaceholder(name)}
                            aria-label={t('leveling.form.insertPlaceholder', { name: `{${name}}` })}
                            title={t(`leveling.placeholder.${name}`)}
                            variant="outline"
                        className="h-10 rounded-full font-normal"
                          >
                            <code className="font-mono">{`{${name}}`}</code>
                            <span className="hidden text-muted-foreground sm:inline">{t(`leveling.placeholder.${name}`)}</span>
                          </UiButton>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <Switch checked={draft.mentionUser} onChange={(value) => update('mentionUser', value)} label={t('leveling.form.mention')} description={t('leveling.form.mentionHelp')} />
                </>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader icon={<Trophy className="size-5 text-primary" />} title={t('leveling.form.leaderboard')} description={t('leveling.form.leaderboardHelp')} />
            <div className="space-y-5">
              <ChannelPicker
                id="leveling-leaderboard-channel"
                label={t('leveling.form.leaderboardChannel')}
                value={draft.leaderboardChannelId}
                onChange={(value) => update('leaderboardChannelId', value)}
              />
              {draft.leaderboardChannelId && (
                <div className="grid gap-5 sm:grid-cols-2">
                  <Field label={t('leveling.form.leaderboardInterval')} help={t('leveling.form.intervalHelp')} htmlFor="leveling-interval">
                    <Select
                      id="leveling-interval"
                      value={String(draft.leaderboardInterval)}
                      onChange={(value) => update('leaderboardInterval', Number(value) as LevelingSettings['leaderboardInterval'])}
                      aria-describedby="leveling-interval-help"
                    >
                      {LEADERBOARD_INTERVALS.map((minutes) => (
                        <option key={minutes} value={minutes}>
                          {intervalLabel(minutes)}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label={t('leveling.form.leaderboardSize')} htmlFor="leveling-size">
                    <Select id="leveling-size" value={String(draft.leaderboardSize)} onChange={(value) => update('leaderboardSize', Number(value) as LevelingSettings['leaderboardSize'])}>
                      {LEADERBOARD_SIZES.map((size) => (
                        <option key={size} value={size}>
                          {t('leveling.form.size', { count: size })}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader icon={<Icon name="sparkle" />} title={t('leveling.form.color')} />
            <Field label={t('leveling.form.color')} htmlFor="leveling-color" error={fieldError('color')}>
              <ColorField id="leveling-color" value={draft.color} fallback={colors.primary} onChange={(value) => update('color', value)} />
            </Field>
          </Card>

          <SaveBar visible={dirty} saving={saving} onSave={() => void save()} onDiscard={() => setDraft(leveling.data!.settings)} />
        </form>
      </div>

      <Card className="space-y-4">
        <CardHeader icon={<Trophy className="size-5 text-primary" />} title={t('leveling.top.title')} description={t('leveling.top.hint')} />
        {top.loading && !top.data ? (
          <Skeleton className="h-40 rounded-lg" />
        ) : topMembers.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('leveling.top.empty')}</p>
        ) : (
          <ol className="divide-y divide-border">
            {topMembers.map((member, index) => (
              <li key={member.userId} className="flex items-start gap-3 py-3">
                <RankMark rank={index + 1} className="w-8 pt-0.5" />
                <Avatar src={member.avatarUrl} name={member.displayName} size={36} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="truncate font-medium">{member.displayName}</p>
                    <p className="shrink-0 font-mono text-xs text-muted-foreground">{t('leveling.top.xp', { xp: n(member.xp) })}</p>
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {shownLevels(topSources).map((kind) => (
                      <LevelBadge
                        key={kind}
                        kind={kind}
                        level={{ overall: member.overallLevel, text: member.textLevel, voice: member.voiceLevel }[kind]}
                        detail={kind === 'overall' ? t('leveling.top.overallDetail') : undefined}
                      />
                    ))}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {activeTracks(topSources)
                      .map((track) =>
                        track === 'text'
                          ? t('leveling.top.textDetail', { xp: n(member.textXp), messages: n(member.messages) })
                          : t('leveling.top.voiceDetail', { xp: n(member.voiceXp), minutes: n(member.voiceMinutes) }),
                      )
                      .join(' · ')}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        )}
        <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <a
              href={leaderboardPath(guild.id)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline"
            >
              <ArrowSquareOut className="size-4" aria-hidden />
              {t('leveling.top.openList')}
            </a>
            <p className="text-xs text-muted-foreground">{t('leveling.top.openListHelp')}</p>
          </div>
          {topMembers.length > 0 && (
            <Button variant="ghost" onClick={() => setConfirmReset(true)} icon={<ArrowCounterClockwise className="size-4" aria-hidden />}>
              {t('leveling.top.reset')}
            </Button>
          )}
        </div>
      </Card>

      <ConfirmDialog
        open={confirmReset}
        title={t('leveling.top.resetTitle')}
        body={t('leveling.top.resetBody')}
        confirmLabel={t('leveling.top.resetConfirm')}
        cancelLabel={t('common.cancel')}
        onConfirm={() => void resetAll()}
        onCancel={() => setConfirmReset(false)}
      />
    </div>
  );
}

const levelingErrorCodes: Record<LevelingErrorCode, true> = {
  no_channel: true,
  channel_missing: true,
  missing_permissions: true,
  send_failed: true,
  panel_deleted: true,
};

const badgeTones = {
  text: 'bg-muted text-foreground ring-border',
  voice: 'bg-muted text-foreground ring-border',
  overall: 'bg-foreground text-background ring-foreground',
} as const;

/** "Chat level 12" style badge with the level kind's icon. The same icon and wording for a level kind everywhere. */
function LevelBadge({ kind, level, detail }: { kind: LevelTrack | 'overall'; level?: number; detail?: string }) {
  const { t } = useI18n();
  const label = t(`leveling.tracks.${kind}`);
  const text = level === undefined ? t('leveling.levels.name', { label }) : t('leveling.levels.badge', { label, level });
  return (
    <span
      title={detail}
      className={cx('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ring-1', badgeTones[kind])}
    >
      <Icon name={LEVEL_EMOJI[kind]} size={14} />
      {text}
    </span>
  );
}

function LevelingSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true">
      <Skeleton className="h-9 w-48" />
      <Skeleton className="h-4 w-96 max-w-full" />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,460px)]">
        <div className="space-y-6">
          <Skeleton className="h-56 rounded-lg" />
          <Skeleton className="h-72 rounded-lg" />
        </div>
        <Skeleton className="h-80 rounded-lg" />
      </div>
    </div>
  );
}
