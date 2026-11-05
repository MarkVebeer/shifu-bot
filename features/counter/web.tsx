/**
 * Counters: dashboard page. The list of the server's counters, and the editor of
 * one counter when the URL has ?c=<id>.
 */
import { Button as UiButton } from '@/components/ui/button';
import { colors, findUnknownPlaceholders } from '@shifubot/shared';
import { ArrowLeft, ArrowSquareOut, Eye, PaperPlaneTilt, Plus, Trash } from '@phosphor-icons/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { api } from '../../apps/web/src/lib/api';
import { useGuild } from '../../apps/web/src/lib/guild';
import { errorText, useI18n } from '../../apps/web/src/lib/i18n';
import { useApi } from '../../apps/web/src/lib/use-api';
import { ChannelPicker } from '../../apps/web/src/ui/channel-picker';
import { DiscordMessagePreview } from '../../apps/web/src/ui/discord-preview';
import { Icon } from '../../apps/web/src/ui/icon';
import { Alert, Avatar, Badge, Button, Card, CardHeader, Field, Input, PageHeader, Skeleton, Switch, Textarea } from '../../apps/web/src/ui/primitives';
import { useToast } from '../../apps/web/src/ui/toast';
import { ColorField, ConfirmDialog, SaveBar } from '../../apps/web/src/ui/widgets';
import { buildCounterPanel, COUNTER_PLACEHOLDERS, counterSettingsSchema, DEFAULT_COUNTER_EMOJI, listPath, unitOf, type CounterSettings } from './manifest';
import type { CounterResponse, CountersResponse, CounterView } from './server';
import type { CounterErrorCode } from './store';

type TextField = 'title' | 'description';

const counterErrorCodes: Record<CounterErrorCode | 'limit_reached', true> = {
  no_channel: true,
  channel_missing: true,
  missing_permissions: true,
  send_failed: true,
  limit_reached: true,
};

/** Quick picks next to the emoji field. Any single emoji can be typed. */
const EMOJI_CHOICES = [DEFAULT_COUNTER_EMOJI, '💪', '☕', '🍺', '🏃', '📚', '🎮', '🔥'];

export default function CounterPage() {
  const { t } = useI18n();
  const { guild } = useGuild();
  const base = `/guilds/${guild.id}/features/counter`;
  const counters = useApi<CountersResponse>(base);
  const [params, setParams] = useSearchParams();
  const selected = params.get('c');
  const current = counters.data?.counters.find((counter) => String(counter.id) === selected);

  if (counters.error) return <Alert tone="danger">{errorText(t, counters.error)}</Alert>;
  if (!counters.data) return <PageSkeleton />;

  const open = (id: number) => setParams({ c: String(id) });
  const replace = (view: CounterView) =>
    counters.setData({ ...counters.data!, counters: counters.data!.counters.map((item) => (item.id === view.id ? view : item)) });

  if (selected && current) {
    return (
      <CounterEditor
        key={current.id}
        base={`${base}/${current.id}`}
        counter={current}
        onChange={replace}
        onDeleted={() => {
          counters.setData({ ...counters.data!, counters: counters.data!.counters.filter((item) => item.id !== current.id) });
          setParams({}, { replace: true });
        }}
      />
    );
  }

  return (
    <CounterList
      base={base}
      data={counters.data}
      missing={Boolean(selected)}
      onCreated={(view) => {
        counters.setData({ ...counters.data!, counters: [...counters.data!.counters, view] });
        open(view.id);
      }}
    />
  );
}

function CounterList({ base, data, missing, onCreated }: { base: string; data: CountersResponse; missing: boolean; onCreated: (view: CounterView) => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const { guild } = useGuild();
  const [creating, setCreating] = useState(false);
  const atLimit = data.counters.length >= data.limit;

  const create = async () => {
    setCreating(true);
    try {
      const response = await api<CounterResponse>(base, { method: 'POST' });
      onCreated(response.counter);
    } catch (error) {
      const code = (error as { code?: string }).code ?? '';
      toast.error(`${t('counter.overview.createFailed')}: ${code === 'limit_reached' ? t('counter.errors.limit_reached') : errorText(t, error)}`);
    } finally {
      setCreating(false);
    }
  };

  const createButton = (
    <Button onClick={() => void create()} loading={creating} disabled={atLimit} icon={<Plus className="size-4" aria-hidden />}>
      {t('counter.overview.new')}
    </Button>
  );

  return (
    <div className="animate-fade-up">
      <PageHeader
        title={t('counter.name')}
        description={t('counter.description')}
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm tabular-nums text-muted-foreground">{t('counter.overview.used', { count: data.counters.length, limit: data.limit })}</p>
            {createButton}
          </div>
        }
      />

      <div className="space-y-4">
        {missing && <Alert tone="warning">{t('counter.overview.notFound')}</Alert>}
        {atLimit && <Alert tone="info">{t('counter.overview.limitReached', { limit: data.limit })}</Alert>}

        {data.counters.length === 0 ? (
          <Card className="py-10 text-center">
            <h2 className="text-lg font-semibold">{t('counter.overview.emptyTitle')}</h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">{t('counter.overview.emptyBody')}</p>
            <div className="mt-5 flex justify-center">{createButton}</div>
          </Card>
        ) : (
          <ul className="grid gap-4 @2xl:grid-cols-2">
            {data.counters.map(({ id, settings, status }) => (
              <li key={id} className="min-w-0">
                <Link
                  to={{ search: `?c=${id}` }}
                  className="flex h-full min-w-0 items-start gap-4 rounded-lg border bg-card p-4 shadow-sm transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:p-5"
                >
                  <span aria-hidden className="grid size-11 shrink-0 place-items-center rounded-md bg-muted text-xl">
                    {settings.emoji}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="min-w-0 break-words font-semibold">{settings.name}</span>
                      <Badge tone={settings.enabled ? 'success' : 'muted'}>{settings.enabled ? t('overview.active') : t('overview.inactive')}</Badge>
                    </span>
                    <span className="mt-1 block truncate text-sm text-muted-foreground">
                      {status.panel ? t('counter.overview.channel', { channel: status.panel.channelName }) : t('counter.overview.noChannel')}
                    </span>
                    <span className="mt-1 block text-sm tabular-nums text-muted-foreground">
                      {t('counter.overview.total', { count: status.total.toLocaleString(guild.locale), unit: unitOf(settings, guild.locale) })}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function CounterEditor({
  base,
  counter,
  onChange,
  onDeleted,
}: {
  base: string;
  counter: CounterView;
  onChange: (view: CounterView) => void;
  onDeleted: () => void;
}) {
  const { t, locale: uiLocale } = useI18n();
  const toast = useToast();
  const { guild, setDirty, permissions } = useGuild();
  const saved = counter.settings;
  const { status } = counter;

  const [draft, setDraft] = useState<CounterSettings>(saved);
  const [saving, setSaving] = useState(false);
  const [reposting, setReposting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  useEffect(() => setDirty(dirty), [dirty, setDirty]);
  useEffect(() => () => setDirty(false), [setDirty]);

  const fieldRefs = {
    title: useRef<HTMLInputElement>(null),
    description: useRef<HTMLTextAreaElement>(null),
  };
  const lastFocused = useRef<TextField>('description');

  const validation = useMemo(() => counterSettingsSchema.safeParse(draft), [draft]);
  const fieldError = (field: keyof CounterSettings) => (validation.success ? undefined : validation.error.issues.find((issue) => issue.path[0] === field)?.message);

  const now = useMemo(() => new Date(), []);
  const payload = useMemo(
    () =>
      buildCounterPanel(
        counter.id,
        {
          ...draft,
          color: fieldError('color') ? null : draft.color,
          emoji: fieldError('emoji') ? DEFAULT_COUNTER_EMOJI : draft.emoji,
        },
        {
          locale: guild.locale,
          server: { name: guild.name },
          entries: status.top,
          total: status.total,
          listUrl: `${window.location.origin}${listPath(guild.id, counter.id)}`,
          updatedAt: now,
        },
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [draft, guild, validation, status, counter.id],
  );

  const errorLabel = (code: CounterErrorCode) => t(`counter.errors.${code}`);

  const update = <K extends keyof CounterSettings>(key: K, value: CounterSettings[K]) => setDraft((current) => ({ ...current, [key]: value }));

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
    if (!validation.success) {
      toast.error(t('errors.validation'));
      return;
    }
    setSaving(true);
    try {
      const response = await api<CounterResponse>(base, { method: 'PUT', body: validation.data });
      onChange(response.counter);
      setDraft(response.counter.settings);
      void permissions.reload();
      if (response.panelError) toast.error(t('counter.panel.failed', { error: errorLabel(response.panelError) }));
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
      const result = await api<CounterResponse & { channel: { name: string } | null }>(`${base}/panel`, { method: 'POST' });
      onChange(result.counter);
      if (result.channel) toast.success(t('counter.panel.reposted', { channel: result.channel.name }));
    } catch (error) {
      const code = (error as { code?: string }).code ?? '';
      toast.error(code in counterErrorCodes ? t(`counter.errors.${code as CounterErrorCode}`) : errorText(t, error));
    } finally {
      setReposting(false);
    }
  };

  const remove = async () => {
    setDeleting(true);
    try {
      await api(base, { method: 'DELETE' });
      setDirty(false);
      void permissions.reload();
      toast.success(t('counter.delete.done'));
      onDeleted();
    } catch (error) {
      toast.error(`${t('counter.delete.failed')}: ${errorText(t, error)}`);
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  const savedChannelSelected = draft.channelId !== null && draft.channelId === saved.channelId;

  const warnings: { tone: 'warning' | 'danger' | 'info'; text: string }[] = [];
  if (draft.enabled) {
    if (!draft.channelId) warnings.push({ tone: 'warning', text: t('counter.status.noChannel') });
    else if (savedChannelSelected && !status.channelExists) warnings.push({ tone: 'danger', text: t('counter.status.channelMissing') });
    else if (savedChannelSelected && status.missingPermissions.length)
      warnings.push({ tone: 'danger', text: t('counter.status.missingPermissions', { permissions: status.missingPermissions.join(', ') }) });
  }
  if (status.lastError && saved.enabled) {
    warnings.push({ tone: 'warning', text: t('counter.status.lastError', { error: errorLabel(status.lastError.code) }) });
  }

  const placeholderHint = (field: TextField) => {
    const unknown = findUnknownPlaceholders(draft[field], COUNTER_PLACEHOLDERS);
    return unknown.length ? t('counter.form.unknownPlaceholder', { names: unknown.map((n) => `{${n}}`).join(', ') }) : undefined;
  };

  const timeLabel = t('counter.preview.today', {
    time: new Intl.DateTimeFormat(uiLocale, { hour: '2-digit', minute: '2-digit' }).format(now),
  });

  const mentions = Object.fromEntries(status.top.map((entry) => [entry.userId, entry.displayName ?? t('counter.top.unknown')]));
  const panelLive = saved.enabled && status.panel;
  const minutesInput = (field: 'cooldownMinutes' | 'undoMinutes', min: number, max: number) => (
    <div className="flex items-center gap-3">
      <Input
        id={`counter-${field}`}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={draft[field]}
        onChange={(event) => update(field, event.target.value === '' ? 0 : Math.trunc(Number(event.target.value)))}
        aria-invalid={Boolean(fieldError(field))}
        className="w-28 font-mono"
      />
      <span className="text-sm text-muted-foreground">{t('counter.form.minutes')}</span>
    </div>
  );

  const preview = (
    <div className="space-y-6">
      <Card className="space-y-4">
        <CardHeader icon={<Eye className="size-5 text-primary" />} title={t('counter.preview.title')} description={t('counter.preview.hint')} />
        <DiscordMessagePreview payload={payload} bot={guild.bot} mentions={mentions} botTag={t('counter.preview.botTag')} timestampLabel={timeLabel} />
        {saved.enabled && (
          <div className="space-y-3">
            {panelLive ? (
              <a href={status.panel!.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline">
                <ArrowSquareOut className="size-4" aria-hidden />
                {t('counter.status.panelLive', { channel: status.panel!.channelName })}
              </a>
            ) : (
              <p className="text-sm text-warning">{t('counter.status.panelMissing')}</p>
            )}
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Button variant="secondary" onClick={repost} loading={reposting} disabled={dirty} icon={<PaperPlaneTilt className="size-4" aria-hidden />}>
                {reposting ? t('counter.panel.reposting') : t('counter.panel.repost')}
              </Button>
              <p className="text-xs text-muted-foreground">{t('counter.panel.help')}</p>
            </div>
          </div>
        )}
      </Card>

      <Card className="space-y-4">
        <CardHeader icon={<Icon name="leveling" />} title={t('counter.top.title')} />
        {status.top.length ? (
          <ol className="space-y-2">
            {status.top.map((entry, index) => {
              const name = entry.displayName ?? t('counter.top.unknown');
              return (
                <li key={entry.userId} className="flex items-center gap-3">
                  <span className="w-6 text-right font-mono text-sm text-muted-foreground">{index + 1}.</span>
                  <Avatar src={entry.avatarUrl} name={name} size={32} />
                  <span className="min-w-0 flex-1 truncate">{name}</span>
                  <span className="font-mono font-semibold">{entry.count.toLocaleString(guild.locale)}</span>
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="text-sm text-muted-foreground">{t('counter.top.empty')}</p>
        )}
        <div className="space-y-1 border-t border-border pt-4">
          <a href={listPath(guild.id, counter.id)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline">
            <ArrowSquareOut className="size-4" aria-hidden />
            {t('counter.top.openList')}
          </a>
          <p className="text-xs text-muted-foreground">{t('counter.top.openListHelp')}</p>
        </div>
      </Card>
    </div>
  );

  return (
    <div className="animate-fade-up">
      <Link to={{ search: '' }} className="mb-4 inline-flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden />
        {t('counter.overview.back')}
      </Link>
      <PageHeader
        title={
          <span className="flex min-w-0 items-center gap-2">
            <span aria-hidden>{saved.emoji}</span>
            <span className="min-w-0 break-words">{saved.name}</span>
          </span>
        }
        badge={<Badge tone={saved.enabled ? 'success' : 'muted'}>{saved.enabled ? t('overview.active') : t('overview.inactive')}</Badge>}
        actions={
          status.total > 0 ? (
            <p className="text-sm tabular-nums text-muted-foreground">
              {t('counter.status.total', { count: status.total.toLocaleString(guild.locale), unit: unitOf(saved, guild.locale) })}
            </p>
          ) : undefined
        }
      />

      <div className="grid gap-6 @4xl:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
        <div className="min-w-0 @4xl:order-last">
          <div className="@4xl:sticky @4xl:top-16">{preview}</div>
        </div>

        <form
          className="@container min-w-0 space-y-6"
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
            <CardHeader icon={<Icon name="counter" />} title={t('counter.form.identity')} description={t('counter.form.identityHelp')} />
            <div className="space-y-5">
              <div className="grid gap-5 @md:grid-cols-2">
                <Field label={t('counter.form.name')} htmlFor="counter-name" error={fieldError('name')}>
                  <Input
                    id="counter-name"
                    value={draft.name}
                    maxLength={50}
                    placeholder={t('counter.form.namePlaceholder')}
                    onChange={(event) => update('name', event.target.value)}
                    aria-invalid={Boolean(fieldError('name'))}
                  />
                </Field>
                <Field label={t('counter.form.unit')} help={t('counter.form.unitHelp')} htmlFor="counter-unit" error={fieldError('unit')}>
                  <Input
                    id="counter-unit"
                    value={draft.unit}
                    maxLength={30}
                    placeholder={t('counter.defaults.unit')}
                    onChange={(event) => update('unit', event.target.value)}
                    aria-invalid={Boolean(fieldError('unit'))}
                  />
                </Field>
              </div>
              <Field label={t('counter.form.emoji')} help={t('counter.form.emojiHelp')} htmlFor="counter-emoji" error={fieldError('emoji')}>
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    id="counter-emoji"
                    value={draft.emoji}
                    maxLength={32}
                    onChange={(event) => update('emoji', event.target.value)}
                    aria-invalid={Boolean(fieldError('emoji'))}
                    className="w-20 text-center text-lg"
                  />
                  {EMOJI_CHOICES.map((choice) => (
                    <UiButton
                      key={choice}
                      type="button"
                      variant={draft.emoji === choice ? 'secondary' : 'outline'}
                      aria-pressed={draft.emoji === choice}
                      aria-label={choice}
                      onClick={() => update('emoji', choice)}
                      className="size-10 p-0 text-lg"
                    >
                      {choice}
                    </UiButton>
                  ))}
                </div>
              </Field>
            </div>
          </Card>

          <Card>
            <CardHeader icon={<Icon name="sparkle" />} title={t('counter.form.general')} />
            <div className="space-y-5">
              <Switch checked={draft.enabled} onChange={(value) => update('enabled', value)} label={t('counter.form.enabled')} description={t('counter.form.enabledHelp')} />
              <ChannelPicker id="counter-channel" label={t('counter.form.channel')} value={draft.channelId} onChange={(value) => update('channelId', value)} error={fieldError('channelId')} />
              <Switch
                checked={draft.showLeaderboard}
                onChange={(value) => update('showLeaderboard', value)}
                label={t('counter.form.showLeaderboard')}
                description={t('counter.form.showLeaderboardHelp')}
              />
            </div>
          </Card>

          <Card>
            <CardHeader icon={<Icon name="settings" />} title={t('counter.form.rules')} />
            <div className="space-y-5">
              <Field label={t('counter.form.cooldown')} help={t('counter.form.cooldownHelp')} htmlFor="counter-cooldownMinutes" error={fieldError('cooldownMinutes')}>
                {minutesInput('cooldownMinutes', 0, 60)}
              </Field>
              <Field label={t('counter.form.undoWindow')} help={t('counter.form.undoWindowHelp')} htmlFor="counter-undoMinutes" error={fieldError('undoMinutes')}>
                {minutesInput('undoMinutes', 1, 30)}
              </Field>
            </div>
          </Card>

          <Card>
            <CardHeader icon={<Icon name="welcome" />} title={t('counter.form.panel')} description={t('counter.form.defaultHint')} />
            <div className="space-y-5">
              <Field label={t('counter.form.title')} htmlFor="counter-title" error={fieldError('title')} warning={placeholderHint('title')}>
                <Input
                  id="counter-title"
                  ref={fieldRefs.title}
                  value={draft.title}
                  maxLength={200}
                  placeholder={t('counter.defaults.title')}
                  onFocus={() => (lastFocused.current = 'title')}
                  onChange={(event) => update('title', event.target.value)}
                  aria-invalid={Boolean(fieldError('title'))}
                />
              </Field>
              <Field label={t('counter.form.description')} htmlFor="counter-description" error={fieldError('description')} warning={placeholderHint('description')}>
                <Textarea
                  id="counter-description"
                  ref={fieldRefs.description}
                  value={draft.description}
                  maxLength={2000}
                  rows={4}
                  placeholder={t('counter.defaults.description')}
                  onFocus={() => (lastFocused.current = 'description')}
                  onChange={(event) => update('description', event.target.value)}
                  aria-invalid={Boolean(fieldError('description'))}
                />
              </Field>
              <div>
                <p className="mb-2 text-sm font-medium">{t('counter.form.placeholders')}</p>
                <ul className="flex flex-wrap gap-2">
                  {COUNTER_PLACEHOLDERS.map((name) => (
                    <li key={name}>
                      <UiButton
                        type="button"
                        onClick={() => insertPlaceholder(name)}
                        aria-label={t('counter.form.insertPlaceholder', { name: `{${name}}` })}
                        title={t(`counter.placeholder.${name}`)}
                        variant="outline"
                        className="h-10 rounded-full font-normal"
                      >
                        <code className="font-mono">{`{${name}}`}</code>
                        <span className="hidden text-muted-foreground sm:inline">{t(`counter.placeholder.${name}`)}</span>
                      </UiButton>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="grid gap-5 @md:grid-cols-2">
                <Field label={t('counter.form.buttonLabel')} htmlFor="counter-button" error={fieldError('buttonLabel')}>
                  <Input id="counter-button" value={draft.buttonLabel} maxLength={80} placeholder={t('counter.defaults.button')} onChange={(event) => update('buttonLabel', event.target.value)} />
                </Field>
                <Field label={t('counter.form.undoLabel')} htmlFor="counter-undo" error={fieldError('undoLabel')}>
                  <Input id="counter-undo" value={draft.undoLabel} maxLength={80} placeholder={t('counter.defaults.undo')} onChange={(event) => update('undoLabel', event.target.value)} />
                </Field>
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader icon={<Icon name="sparkle" />} title={t('counter.form.style')} />
            <Field label={t('counter.form.color')} htmlFor="counter-color" error={fieldError('color')}>
              <ColorField id="counter-color" value={draft.color} fallback={colors.primary} onChange={(value) => update('color', value)} />
            </Field>
          </Card>

          <Card>
            <div className="flex flex-col gap-3 @md:flex-row @md:items-center @md:justify-between">
              <p className="min-w-0 text-sm text-muted-foreground">{t('counter.delete.help')}</p>
              <Button variant="danger" className="shrink-0" onClick={() => setConfirmDelete(true)} icon={<Trash className="size-4" aria-hidden />}>
                {t('counter.delete.button')}
              </Button>
            </div>
          </Card>

          <SaveBar visible={dirty} saving={saving} onSave={() => void save()} onDiscard={() => setDraft(saved)} />
        </form>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title={t('counter.delete.title', { name: saved.name })}
        body={t('counter.delete.body')}
        confirmLabel={t('counter.delete.confirm')}
        cancelLabel={t('common.cancel')}
        onConfirm={() => {
          if (!deleting) void remove();
        }}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}

function PageSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true">
      <Skeleton className="h-9 w-48" />
      <Skeleton className="h-4 w-96 max-w-full" />
      <div className="grid gap-4 @2xl:grid-cols-2">
        <Skeleton className="h-28 rounded-lg" />
        <Skeleton className="h-28 rounded-lg" />
      </div>
    </div>
  );
}
