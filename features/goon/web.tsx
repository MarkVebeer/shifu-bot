/**
 * Goon counter: dashboard page.
 */
import { colors, findUnknownPlaceholders } from '@shifubot/shared';
import { ExternalLink, Eye, Send } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../apps/web/src/lib/api';
import { useGuild } from '../../apps/web/src/lib/guild';
import { errorText, useI18n } from '../../apps/web/src/lib/i18n';
import { useApi } from '../../apps/web/src/lib/use-api';
import { ChannelPicker } from '../../apps/web/src/ui/channel-picker';
import { DiscordMessagePreview } from '../../apps/web/src/ui/discord-preview';
import { Icon } from '../../apps/web/src/ui/icon';
import { Alert, Avatar, Button, Card, CardHeader, Field, Input, Skeleton, Switch, Textarea } from '../../apps/web/src/ui/primitives';
import { useToast } from '../../apps/web/src/ui/toast';
import { ColorField, SaveBar } from '../../apps/web/src/ui/widgets';
import { buildGoonPanel, GOON_PLACEHOLDERS, goonSettingsSchema, listPath, type GoonSettings } from './manifest';
import type { GoonResponse } from './server';
import type { GoonErrorCode } from './store';

type TextField = 'title' | 'description';

const goonErrorCodes: Record<GoonErrorCode, true> = {
  no_channel: true,
  channel_missing: true,
  missing_permissions: true,
  send_failed: true,
};

export default function GoonPage() {
  const { t, locale: uiLocale } = useI18n();
  const toast = useToast();
  const { guild, setDirty, permissions } = useGuild();
  const base = `/guilds/${guild.id}/features/goon`;
  const goon = useApi<GoonResponse>(base);

  const [draft, setDraft] = useState<GoonSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [reposting, setReposting] = useState(false);
  const saved = goon.data?.settings;

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

  const validation = useMemo(() => (draft ? goonSettingsSchema.safeParse(draft) : null), [draft]);
  const fieldError = (field: keyof GoonSettings) =>
    validation && !validation.success ? validation.error.issues.find((issue) => issue.path[0] === field)?.message : undefined;

  const now = useMemo(() => new Date(), []);
  const payload = useMemo(() => {
    if (!draft || !goon.data) return null;
    return buildGoonPanel(
      { ...draft, color: fieldError('color') ? null : draft.color },
      {
        locale: guild.locale,
        server: { name: guild.name },
        entries: goon.data.status.top,
        total: goon.data.status.total,
        listUrl: `${window.location.origin}${listPath(guild.id)}`,
        updatedAt: now,
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, guild, validation, goon.data]);

  if (goon.error) return <Alert tone="danger">{errorText(t, goon.error)}</Alert>;
  if (!draft || !goon.data) return <GoonSkeleton />;

  const errorLabel = (code: GoonErrorCode) => t(`goon.errors.${code}`);

  const update = <K extends keyof GoonSettings>(key: K, value: GoonSettings[K]) =>
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
      const response = await api<GoonResponse>(base, { method: 'PUT', body: validation.data });
      goon.setData(response);
      setDraft(response.settings);
      void permissions.reload();
      if (response.panelError) toast.error(t('goon.panel.failed', { error: errorLabel(response.panelError) }));
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
      const result = await api<GoonResponse & { channel: { name: string } | null }>(`${base}/panel`, { method: 'POST' });
      goon.setData(result);
      if (result.channel) toast.success(t('goon.panel.reposted', { channel: result.channel.name }));
    } catch (error) {
      const code = (error as { code?: string }).code ?? '';
      toast.error(code in goonErrorCodes ? errorLabel(code as GoonErrorCode) : errorText(t, error));
      void goon.reload();
    } finally {
      setReposting(false);
    }
  };

  const { status } = goon.data;
  const savedChannelSelected = draft.channelId !== null && draft.channelId === saved?.channelId;

  const warnings: { tone: 'warning' | 'danger' | 'info'; text: string }[] = [];
  if (draft.enabled) {
    if (!draft.channelId) warnings.push({ tone: 'warning', text: t('goon.status.noChannel') });
    else if (savedChannelSelected && !status.channelExists) warnings.push({ tone: 'danger', text: t('goon.status.channelMissing') });
    else if (savedChannelSelected && status.missingPermissions.length)
      warnings.push({ tone: 'danger', text: t('goon.status.missingPermissions', { permissions: status.missingPermissions.join(', ') }) });
  }
  if (status.lastError && saved?.enabled) {
    warnings.push({ tone: 'warning', text: t('goon.status.lastError', { error: errorLabel(status.lastError.code) }) });
  }

  const placeholderHint = (field: TextField) => {
    const unknown = findUnknownPlaceholders(draft[field], GOON_PLACEHOLDERS);
    return unknown.length ? t('goon.form.unknownPlaceholder', { names: unknown.map((n) => `{${n}}`).join(', ') }) : undefined;
  };

  const timeLabel = t('goon.preview.today', {
    time: new Intl.DateTimeFormat(uiLocale, { hour: '2-digit', minute: '2-digit' }).format(now),
  });

  const mentions = Object.fromEntries(status.top.map((entry) => [entry.userId, entry.displayName ?? t('goon.top.unknown')]));
  const panelLive = saved?.enabled && status.panel;
  const minutesInput = (field: 'cooldownMinutes' | 'undoMinutes', min: number, max: number) => (
    <div className="flex items-center gap-3">
      <Input
        id={`goon-${field}`}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={draft[field]}
        onChange={(event) => update(field, event.target.value === '' ? 0 : Math.trunc(Number(event.target.value)))}
        aria-invalid={Boolean(fieldError(field))}
        className="w-28 font-mono"
      />
      <span className="text-sm text-muted">{t('goon.form.minutes')}</span>
    </div>
  );

  const preview = payload && (
    <div className="space-y-6">
      <Card className="space-y-4">
        <CardHeader icon={<Eye className="size-5 text-primary" />} title={t('goon.preview.title')} description={t('goon.preview.hint')} />
        <DiscordMessagePreview payload={payload} bot={guild.bot} mentions={mentions} botTag={t('goon.preview.botTag')} timestampLabel={timeLabel} />
        {saved?.enabled && (
          <div className="space-y-3">
            {panelLive ? (
              <a href={status.panel!.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline">
                <ExternalLink className="size-4" aria-hidden />
                {t('goon.status.panelLive', { channel: status.panel!.channelName })}
              </a>
            ) : (
              <p className="text-sm text-warning">{t('goon.status.panelMissing')}</p>
            )}
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Button variant="secondary" onClick={repost} loading={reposting} disabled={dirty} icon={<Send className="size-4" aria-hidden />}>
                {reposting ? t('goon.panel.reposting') : t('goon.panel.repost')}
              </Button>
              <p className="text-xs text-muted">{t('goon.panel.help')}</p>
            </div>
          </div>
        )}
      </Card>

      <Card className="space-y-4">
        <CardHeader icon={<Icon name="leveling" />} title={t('goon.top.title')} />
        {status.top.length ? (
          <ol className="space-y-2">
            {status.top.map((entry, index) => {
              const name = entry.displayName ?? t('goon.top.unknown');
              return (
                <li key={entry.userId} className="flex items-center gap-3">
                  <span className="w-6 text-right font-mono text-sm text-muted">{index + 1}.</span>
                  <Avatar src={entry.avatarUrl} name={name} size={32} />
                  <span className="min-w-0 flex-1 truncate">{name}</span>
                  <span className="font-mono font-semibold">{entry.count.toLocaleString(guild.locale)}</span>
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="text-sm text-muted">{t('goon.top.empty')}</p>
        )}
        <div className="space-y-1 border-t border-line pt-4">
          <a
            href={listPath(guild.id)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline"
          >
            <ExternalLink className="size-4" aria-hidden />
            {t('goon.top.openList')}
          </a>
          <p className="text-xs text-muted">{t('goon.top.openListHelp')}</p>
        </div>
      </Card>
    </div>
  );

  return (
    <div className="animate-fade-up">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
          <Icon name="goon" size={26} className="mr-2 inline-block align-[-3px]" />
          {t('goon.name')}
        </h1>
        <p className="mt-2 max-w-2xl text-muted">{t('goon.description')}</p>
        {status.total > 0 && (
          <p className="mt-3 text-sm text-muted">{t('goon.status.total', { count: status.total.toLocaleString(guild.locale) })}</p>
        )}
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,460px)]">
        <div className="lg:order-last">
          <div className="lg:sticky lg:top-10">{preview}</div>
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
            <CardHeader icon={<Icon name="sparkle" />} title={t('goon.form.general')} />
            <div className="space-y-5">
              <Switch checked={draft.enabled} onChange={(value) => update('enabled', value)} label={t('goon.form.enabled')} description={t('goon.form.enabledHelp')} />
              <ChannelPicker id="goon-channel" label={t('goon.form.channel')} value={draft.channelId} onChange={(value) => update('channelId', value)} error={fieldError('channelId')} />
              <Switch
                checked={draft.showLeaderboard}
                onChange={(value) => update('showLeaderboard', value)}
                label={t('goon.form.showLeaderboard')}
                description={t('goon.form.showLeaderboardHelp')}
              />
            </div>
          </Card>

          <Card>
            <CardHeader icon={<Icon name="settings" />} title={t('goon.form.rules')} />
            <div className="space-y-5">
              <Field label={t('goon.form.cooldown')} help={t('goon.form.cooldownHelp')} htmlFor="goon-cooldownMinutes" error={fieldError('cooldownMinutes')}>
                {minutesInput('cooldownMinutes', 0, 60)}
              </Field>
              <Field label={t('goon.form.undoWindow')} help={t('goon.form.undoWindowHelp')} htmlFor="goon-undoMinutes" error={fieldError('undoMinutes')}>
                {minutesInput('undoMinutes', 1, 30)}
              </Field>
            </div>
          </Card>

          <Card>
            <CardHeader icon={<Icon name="welcome" />} title={t('goon.form.panel')} description={t('goon.form.defaultHint')} />
            <div className="space-y-5">
              <Field label={t('goon.form.title')} htmlFor="goon-title" error={fieldError('title')} warning={placeholderHint('title')}>
                <Input
                  id="goon-title"
                  ref={fieldRefs.title}
                  value={draft.title}
                  maxLength={200}
                  placeholder={t('goon.defaults.title')}
                  onFocus={() => (lastFocused.current = 'title')}
                  onChange={(event) => update('title', event.target.value)}
                  aria-invalid={Boolean(fieldError('title'))}
                />
              </Field>
              <Field label={t('goon.form.description')} htmlFor="goon-description" error={fieldError('description')} warning={placeholderHint('description')}>
                <Textarea
                  id="goon-description"
                  ref={fieldRefs.description}
                  value={draft.description}
                  maxLength={2000}
                  rows={4}
                  placeholder={t('goon.defaults.description')}
                  onFocus={() => (lastFocused.current = 'description')}
                  onChange={(event) => update('description', event.target.value)}
                  aria-invalid={Boolean(fieldError('description'))}
                />
              </Field>
              <div>
                <p className="mb-2 text-sm font-medium">{t('goon.form.placeholders')}</p>
                <ul className="flex flex-wrap gap-2">
                  {GOON_PLACEHOLDERS.map((name) => (
                    <li key={name}>
                      <button
                        type="button"
                        onClick={() => insertPlaceholder(name)}
                        aria-label={t('goon.form.insertPlaceholder', { name: `{${name}}` })}
                        title={t(`goon.placeholder.${name}`)}
                        className="glow-hover inline-flex min-h-10 items-center gap-2 rounded-full border border-line bg-raised/60 px-3 text-sm"
                      >
                        <code className="font-mono text-aqua">{`{${name}}`}</code>
                        <span className="hidden text-muted sm:inline">{t(`goon.placeholder.${name}`)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="grid gap-5 sm:grid-cols-2">
                <Field label={t('goon.form.buttonLabel')} htmlFor="goon-button" error={fieldError('buttonLabel')}>
                  <Input id="goon-button" value={draft.buttonLabel} maxLength={80} placeholder={t('goon.defaults.button')} onChange={(event) => update('buttonLabel', event.target.value)} />
                </Field>
                <Field label={t('goon.form.undoLabel')} htmlFor="goon-undo" error={fieldError('undoLabel')}>
                  <Input id="goon-undo" value={draft.undoLabel} maxLength={80} placeholder={t('goon.defaults.undo')} onChange={(event) => update('undoLabel', event.target.value)} />
                </Field>
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader icon={<Icon name="sparkle" />} title={t('goon.form.style')} />
            <Field label={t('goon.form.color')} htmlFor="goon-color" error={fieldError('color')}>
              <ColorField id="goon-color" value={draft.color} fallback={colors.primary} onChange={(value) => update('color', value)} />
            </Field>
          </Card>

          <SaveBar visible={dirty} saving={saving} onSave={() => void save()} onDiscard={() => setDraft(goon.data!.settings)} />
        </form>
      </div>
    </div>
  );
}

function GoonSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true">
      <Skeleton className="h-9 w-48" />
      <Skeleton className="h-4 w-96 max-w-full" />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,460px)]">
        <div className="space-y-6">
          <Skeleton className="h-72 rounded-card" />
          <Skeleton className="h-56 rounded-card" />
        </div>
        <Skeleton className="h-80 rounded-card" />
      </div>
    </div>
  );
}
