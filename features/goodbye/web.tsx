/**
 * Goodbye feature: dashboard page.
 */
import { colors, emoji, findUnknownPlaceholders } from '@shifubot/shared';
import { Eye, Send } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../apps/web/src/lib/api';
import { useAuth } from '../../apps/web/src/lib/auth';
import { useGuild } from '../../apps/web/src/lib/guild';
import { errorText, useI18n } from '../../apps/web/src/lib/i18n';
import { useApi } from '../../apps/web/src/lib/use-api';
import { DiscordMessagePreview } from '../../apps/web/src/ui/discord-preview';
import { Alert, Button, Card, CardHeader, Field, Input, Skeleton, Switch, Textarea, cx } from '../../apps/web/src/ui/primitives';
import { useToast } from '../../apps/web/src/ui/toast';
import { ColorField, SaveBar } from '../../apps/web/src/ui/widgets';
import {
  GOODBYE_PLACEHOLDERS,
  buildGoodbyeMessage,
  goodbyeManifest,
  goodbyeSettingsSchema,
  type GoodbyeSettings,
} from './manifest';
import type { GoodbyeResponse } from './server';
import { ChannelPicker } from '../../apps/web/src/ui/channel-picker';

type TextField = 'title' | 'description' | 'footer';

export default function GoodbyePage() {
  const { t, locale: uiLocale } = useI18n();
  const toast = useToast();
  const { me } = useAuth();
  const { guild, setDirty, permissions } = useGuild();
  const base = `/guilds/${guild.id}`;
  const goodbye = useApi<GoodbyeResponse>(`${base}/features/goodbye`);

  const [draft, setDraft] = useState<GoodbyeSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const saved = goodbye.data?.settings;

  useEffect(() => {
    if (saved && !draft) setDraft(saved);
  }, [saved, draft]);

  const dirty = Boolean(draft && saved && JSON.stringify(draft) !== JSON.stringify(saved));
  useEffect(() => setDirty(dirty), [dirty, setDirty]);
  useEffect(() => () => setDirty(false), [setDirty]);

  const fieldRefs = {
    title: useRef<HTMLInputElement>(null),
    description: useRef<HTMLTextAreaElement>(null),
    footer: useRef<HTMLInputElement>(null),
  };
  const lastFocused = useRef<TextField>('description');

  const validation = useMemo(() => (draft ? goodbyeSettingsSchema.safeParse(draft) : null), [draft]);
  const fieldError = (field: keyof GoodbyeSettings) =>
    validation && !validation.success
      ? validation.error.issues.find((issue) => issue.path[0] === field)?.message
      : undefined;

  const now = useMemo(() => new Date(), []);
  const memberName = me?.user.globalName ?? me?.user.username ?? 'member';
  const payload = useMemo(() => {
    if (!draft || !me) return null;
    const previewSettings: GoodbyeSettings = {
      ...draft,
      bannerUrl: fieldError('bannerUrl') ? null : draft.bannerUrl || null,
      color: fieldError('color') ? null : draft.color,
    };
    return buildGoodbyeMessage(previewSettings, {
      locale: guild.locale,
      member: { id: me.user.id, username: me.user.username, displayName: memberName, avatarUrl: me.user.avatarUrl },
      server: { name: guild.name, memberCount: guild.memberCount },
      now,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, me, guild, now, memberName, validation]);

  if (goodbye.error) return <Alert tone="danger">{errorText(t, goodbye.error)}</Alert>;
  if (!draft || !goodbye.data) return <GoodbyeSkeleton />;

  const update = <K extends keyof GoodbyeSettings>(key: K, value: GoodbyeSettings[K]) =>
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
      const response = await api<GoodbyeResponse>(`${base}/features/goodbye`, { method: 'PUT', body: validation.data });
      goodbye.setData(response);
      setDraft(response.settings);
      void permissions.reload();
      toast.success(t('toast.saved'));
    } catch (error) {
      toast.error(`${t('toast.saveFailed')}: ${errorText(t, error)}`);
    } finally {
      setSaving(false);
    }
  };

  const discard = () => setDraft(goodbye.data!.settings);

  const sendTest = async () => {
    if (!validation?.success) {
      toast.error(t('errors.validation'));
      return;
    }
    setTesting(true);
    try {
      const result = await api<{ channel: { name: string } }>(`${base}/features/goodbye/test`, {
        method: 'POST',
        body: validation.data,
      });
      toast.success(t('goodbye.test.sent', { channel: result.channel.name }));
      void goodbye.reload();
    } catch (error) {
      const code = (error as { code?: string }).code ?? '';
      const reason = code in goodbyeErrorKeys ? t(goodbyeErrorKeys[code as keyof typeof goodbyeErrorKeys]) : errorText(t, error);
      toast.error(t('goodbye.test.failed', { error: reason }));
      void goodbye.reload();
    } finally {
      setTesting(false);
    }
  };

  const { status, maxPerMinute } = goodbye.data;
  const savedChannelSelected = draft.channelId !== null && draft.channelId === saved?.channelId;

  const warnings: { tone: 'warning' | 'danger' | 'info'; text: string }[] = [];
  if (!draft.channelId) warnings.push({ tone: 'warning', text: t('goodbye.status.noChannel') });
  else if (savedChannelSelected && !status.channelExists) warnings.push({ tone: 'danger', text: t('goodbye.status.channelMissing') });
  else if (savedChannelSelected && status.missingPermissions.length)
    warnings.push({
      tone: 'danger',
      text: t('goodbye.status.missingPermissions', { permissions: status.missingPermissions.join(', ') }),
    });
  if (status.lastError) {
    warnings.push({
      tone: 'warning',
      text: t('goodbye.status.lastError', { error: t(goodbyeErrorKeys[status.lastError.code]) }),
    });
  }

  const placeholderHint = (field: TextField) => {
    const unknown = findUnknownPlaceholders(draft[field], GOODBYE_PLACEHOLDERS);
    return unknown.length ? t('goodbye.form.unknownPlaceholder', { names: unknown.map((n) => `{${n}}`).join(', ') }) : undefined;
  };

  // Default texts follow the server language (set on the Settings page).
  const defaults = goodbyeManifest.messages[guild.locale].defaults;

  const timeLabel = t('goodbye.preview.today', {
    time: new Intl.DateTimeFormat(uiLocale, { hour: '2-digit', minute: '2-digit' }).format(now),
  });

  const preview = payload && (
    <Card className="space-y-4">
      <CardHeader icon={<Eye className="size-5 text-primary" />} title={t('goodbye.preview.title')} description={t('goodbye.preview.hint')} />
      <DiscordMessagePreview
        payload={payload}
        bot={guild.bot}
        mentions={{}}
        botTag={t('goodbye.preview.botTag')}
        timestampLabel={timeLabel}
      />
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Button variant="secondary" onClick={sendTest} loading={testing} icon={<Send className="size-4" aria-hidden />}>
          {testing ? t('goodbye.test.sending') : t('goodbye.test.button')}
        </Button>
        <p className="text-xs text-muted">{t('goodbye.test.help')}</p>
      </div>
    </Card>
  );

  return (
    <div className="animate-fade-up">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
          <span aria-hidden>{emoji.goodbye} </span>
          {t('goodbye.name')}
        </h1>
        <p className="mt-2 max-w-2xl text-muted">{t('goodbye.description')}</p>
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
            <CardHeader icon={emoji.sparkle} title={t('goodbye.form.general')} />
            <div className="space-y-5">
              <Switch checked={draft.enabled} onChange={(value) => update('enabled', value)} label={t('goodbye.form.enabled')} description={t('goodbye.form.enabledHelp')} />
              <ChannelPicker
                id="goodbye-channel"
                value={draft.channelId}
                onChange={(value) => update('channelId', value)}
                error={fieldError('channelId')}
              />
              <Alert tone="info">{t('goodbye.status.rateLimited', { count: maxPerMinute })}</Alert>
            </div>
          </Card>

          <Card>
            <CardHeader icon={emoji.goodbye} title={t('goodbye.form.content')} description={t('goodbye.form.defaultHint')} />
            <div className="space-y-5">
              <Field label={t('goodbye.form.title')} htmlFor="goodbye-title" error={fieldError('title')} warning={placeholderHint('title')}>
                <Input
                  id="goodbye-title"
                  ref={fieldRefs.title}
                  value={draft.title}
                  maxLength={200}
                  placeholder={defaults.title}
                  onFocus={() => (lastFocused.current = 'title')}
                  onChange={(event) => update('title', event.target.value)}
                  aria-invalid={Boolean(fieldError('title'))}
                />
              </Field>
              <Field label={t('goodbye.form.description')} htmlFor="goodbye-description" error={fieldError('description')} warning={placeholderHint('description')}>
                <Textarea
                  id="goodbye-description"
                  ref={fieldRefs.description}
                  value={draft.description}
                  maxLength={2000}
                  rows={5}
                  placeholder={defaults.description}
                  onFocus={() => (lastFocused.current = 'description')}
                  onChange={(event) => update('description', event.target.value)}
                  aria-invalid={Boolean(fieldError('description'))}
                />
              </Field>
              <div>
                <p className="mb-2 text-sm font-medium">{t('goodbye.form.placeholders')}</p>
                <ul className="flex flex-wrap gap-2">
                  {GOODBYE_PLACEHOLDERS.map((name) => (
                    <li key={name}>
                      <button
                        type="button"
                        onClick={() => insertPlaceholder(name)}
                        aria-label={t('goodbye.form.insertPlaceholder', { name: `{${name}}` })}
                        title={t(`goodbye.placeholder.${name}`)}
                        className="glow-hover inline-flex min-h-10 items-center gap-2 rounded-full border border-line bg-raised/60 px-3 text-sm"
                      >
                        <code className="font-mono text-aqua">{`{${name}}`}</code>
                        <span className="hidden text-muted sm:inline">{t(`goodbye.placeholder.${name}`)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader icon={emoji.sparkle} title={t('goodbye.form.style')} />
            <div className="space-y-5">
              <Field label={t('goodbye.form.color')} htmlFor="goodbye-color" error={fieldError('color')}>
                <ColorField id="goodbye-color" value={draft.color} fallback={colors.primary} onChange={(value) => update('color', value)} />
              </Field>
              <Switch checked={draft.showAvatar} onChange={(value) => update('showAvatar', value)} label={t('goodbye.form.showAvatar')} description={t('goodbye.form.showAvatarHelp')} />
              <Field
                label={t('goodbye.form.banner')}
                help={t('goodbye.form.bannerHelp')}
                htmlFor="goodbye-banner"
                error={draft.bannerUrl ? fieldError('bannerUrl') : undefined}
                optional
                optionalLabel={t('common.optional')}
              >
                <Input
                  id="goodbye-banner"
                  type="url"
                  inputMode="url"
                  value={draft.bannerUrl ?? ''}
                  placeholder="https://"
                  onChange={(event) => update('bannerUrl', event.target.value || null)}
                  aria-invalid={Boolean(draft.bannerUrl && fieldError('bannerUrl'))}
                  className="font-mono"
                />
              </Field>
              <Field
                label={t('goodbye.form.footer')}
                help={t('goodbye.form.footerHelp')}
                warning={placeholderHint('footer')}
                htmlFor="goodbye-footer"
                error={fieldError('footer')}
                optional
                optionalLabel={t('common.optional')}
              >
                <Input
                  id="goodbye-footer"
                  ref={fieldRefs.footer}
                  value={draft.footer}
                  maxLength={200}
                  onFocus={() => (lastFocused.current = 'footer')}
                  onChange={(event) => update('footer', event.target.value)}
                />
              </Field>
            </div>
          </Card>

          <SaveBar visible={dirty} saving={saving} onSave={() => void save()} onDiscard={discard} />
        </form>
      </div>
    </div>
  );
}

const goodbyeErrorKeys = {
  no_channel: 'goodbye.errors.no_channel',
  channel_missing: 'goodbye.errors.channel_missing',
  missing_permissions: 'goodbye.errors.missing_permissions',
  send_failed: 'goodbye.errors.send_failed',
} as const;

function GoodbyeSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true">
      <Skeleton className="h-9 w-48" />
      <Skeleton className="h-4 w-96 max-w-full" />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,460px)]">
        <div className={cx('space-y-6')}>
          <Skeleton className="h-56 rounded-card" />
          <Skeleton className="h-72 rounded-card" />
        </div>
        <Skeleton className="h-80 rounded-card" />
      </div>
    </div>
  );
}
