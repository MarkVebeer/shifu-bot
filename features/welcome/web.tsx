/**
 * Welcome feature: dashboard page.
 */
import { colors, emoji, findUnknownPlaceholders, type ChannelOption, type Locale } from '@shifubot/shared';
import { Eye, Send } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../apps/web/src/lib/api';
import { useAuth } from '../../apps/web/src/lib/auth';
import { useGuild } from '../../apps/web/src/lib/guild';
import { errorText, useI18n } from '../../apps/web/src/lib/i18n';
import { useApi } from '../../apps/web/src/lib/use-api';
import { DiscordMessagePreview } from '../../apps/web/src/ui/discord-preview';
import { Alert, Button, Card, CardHeader, Field, Input, Select, Skeleton, Switch, Textarea, cx } from '../../apps/web/src/ui/primitives';
import { useToast } from '../../apps/web/src/ui/toast';
import { ColorField, LanguageSwitcher, SaveBar } from '../../apps/web/src/ui/widgets';
import {
  WELCOME_PLACEHOLDERS,
  buildWelcomeMessage,
  welcomeManifest,
  welcomeSettingsSchema,
  type WelcomeSettings,
} from './manifest';
import type { WelcomeResponse } from './server';
import { getTranslator } from '..';

type TextField = 'title' | 'description' | 'footer';

export default function WelcomePage() {
  const { t, locale: uiLocale } = useI18n();
  const toast = useToast();
  const { me } = useAuth();
  const { guild, reload, setDirty } = useGuild();
  const base = `/guilds/${guild.id}`;
  const welcome = useApi<WelcomeResponse>(`${base}/features/welcome`);
  const channels = useApi<{ channels: ChannelOption[] }>(`${base}/channels`);

  const [draft, setDraft] = useState<WelcomeSettings | null>(null);
  const [draftLocale, setDraftLocale] = useState<Locale>(guild.locale);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const saved = welcome.data?.settings;

  useEffect(() => {
    if (saved && !draft) setDraft(saved);
  }, [saved, draft]);
  useEffect(() => setDraftLocale(guild.locale), [guild.locale]);

  const dirty = Boolean(draft && saved && (JSON.stringify(draft) !== JSON.stringify(saved) || draftLocale !== guild.locale));
  useEffect(() => setDirty(dirty), [dirty, setDirty]);
  useEffect(() => () => setDirty(false), [setDirty]);

  const fieldRefs = {
    title: useRef<HTMLInputElement>(null),
    description: useRef<HTMLTextAreaElement>(null),
    footer: useRef<HTMLInputElement>(null),
  };
  const lastFocused = useRef<TextField>('description');

  const validation = useMemo(() => (draft ? welcomeSettingsSchema.safeParse(draft) : null), [draft]);
  const fieldError = (field: keyof WelcomeSettings) =>
    validation && !validation.success
      ? validation.error.issues.find((issue) => issue.path[0] === field)?.message
      : undefined;

  const now = useMemo(() => new Date(), []);
  const memberName = me?.user.globalName ?? me?.user.username ?? 'member';
  const payload = useMemo(() => {
    if (!draft || !me) return null;
    const previewSettings: WelcomeSettings = {
      ...draft,
      bannerUrl: fieldError('bannerUrl') ? null : draft.bannerUrl || null,
      color: fieldError('color') ? null : draft.color,
    };
    return buildWelcomeMessage(previewSettings, {
      locale: draftLocale,
      member: { id: me.user.id, username: me.user.username, displayName: memberName, avatarUrl: me.user.avatarUrl },
      server: { name: guild.name, memberCount: guild.memberCount },
      now,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, draftLocale, me, guild, now, memberName, validation]);

  if (welcome.error) return <Alert tone="danger">{errorText(t, welcome.error)}</Alert>;
  if (!draft || !welcome.data) return <WelcomeSkeleton />;

  const update = <K extends keyof WelcomeSettings>(key: K, value: WelcomeSettings[K]) =>
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
      const response = await api<WelcomeResponse>(`${base}/features/welcome`, { method: 'PUT', body: validation.data });
      welcome.setData(response);
      setDraft(response.settings);
      if (draftLocale !== guild.locale) {
        await api(`${base}/settings`, { method: 'PUT', body: { locale: draftLocale } });
        await reload();
      }
      // Use the newly saved language: `t` still belongs to the previous one.
      toast.success(getTranslator(draftLocale)('toast.saved'));
    } catch (error) {
      toast.error(`${t('toast.saveFailed')}: ${errorText(t, error)}`);
    } finally {
      setSaving(false);
    }
  };

  const discard = () => {
    setDraft(welcome.data!.settings);
    setDraftLocale(guild.locale);
  };

  const sendTest = async () => {
    if (!validation?.success) {
      toast.error(t('errors.validation'));
      return;
    }
    setTesting(true);
    try {
      const result = await api<{ channel: { name: string } }>(`${base}/features/welcome/test`, {
        method: 'POST',
        body: validation.data,
      });
      toast.success(t('welcome.test.sent', { channel: result.channel.name }));
      void welcome.reload();
    } catch (error) {
      const code = (error as { code?: string }).code ?? '';
      const reason = code in welcomeErrorKeys ? t(welcomeErrorKeys[code as keyof typeof welcomeErrorKeys]) : errorText(t, error);
      toast.error(t('welcome.test.failed', { error: reason }));
      void welcome.reload();
    } finally {
      setTesting(false);
    }
  };

  const { status, maxPerMinute } = welcome.data;
  const writable = (channels.data?.channels ?? []).filter((channel) => channel.canSend || channel.id === draft.channelId);
  const groups = writable.reduce<Map<string, ChannelOption[]>>((map, channel) => {
    const key = channel.parentName ?? '';
    map.set(key, [...(map.get(key) ?? []), channel]);
    return map;
  }, new Map());
  const savedChannelSelected = draft.channelId !== null && draft.channelId === saved?.channelId;

  const warnings: { tone: 'warning' | 'danger' | 'info'; text: string }[] = [];
  if (!draft.channelId) warnings.push({ tone: 'warning', text: t('welcome.status.noChannel') });
  else if (savedChannelSelected && !status.channelExists) warnings.push({ tone: 'danger', text: t('welcome.status.channelMissing') });
  else if (savedChannelSelected && status.missingPermissions.length)
    warnings.push({
      tone: 'danger',
      text: t('welcome.status.missingPermissions', { permissions: status.missingPermissions.join(', ') }),
    });
  if (status.lastError) {
    warnings.push({
      tone: 'warning',
      text: t('welcome.status.lastError', { error: t(welcomeErrorKeys[status.lastError.code]) }),
    });
  }

  const placeholderHint = (field: TextField) => {
    const unknown = findUnknownPlaceholders(draft[field], WELCOME_PLACEHOLDERS);
    return unknown.length ? t('welcome.form.unknownPlaceholder', { names: unknown.map((n) => `{${n}}`).join(', ') }) : undefined;
  };

  // Default texts follow the selected (maybe not yet saved) server language.
  const defaults = welcomeManifest.messages[draftLocale].defaults;

  const timeLabel = t('welcome.preview.today', {
    time: new Intl.DateTimeFormat(uiLocale, { hour: '2-digit', minute: '2-digit' }).format(now),
  });

  const preview = payload && (
    <Card className="space-y-4">
      <CardHeader icon={<Eye className="size-5 text-primary" />} title={t('welcome.preview.title')} description={t('welcome.preview.hint')} />
      <DiscordMessagePreview
        payload={payload}
        bot={guild.bot}
        mentions={me ? { [me.user.id]: memberName } : {}}
        botTag={t('welcome.preview.botTag')}
        timestampLabel={timeLabel}
      />
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Button variant="secondary" onClick={sendTest} loading={testing} icon={<Send className="size-4" aria-hidden />}>
          {testing ? t('welcome.test.sending') : t('welcome.test.button')}
        </Button>
        <p className="text-xs text-muted">{t('welcome.test.help')}</p>
      </div>
    </Card>
  );

  return (
    <div className="animate-fade-up">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
          <span aria-hidden>{emoji.welcome} </span>
          {t('welcome.name')}
        </h1>
        <p className="mt-2 max-w-2xl text-muted">{t('welcome.description')}</p>
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
            <CardHeader icon={emoji.sparkle} title={t('welcome.form.general')} />
            <div className="space-y-5">
              <Switch checked={draft.enabled} onChange={(value) => update('enabled', value)} label={t('welcome.form.enabled')} description={t('welcome.form.enabledHelp')} />
              <Field label={t('welcome.form.language')} help={t('welcome.form.languageHelp')} htmlFor="welcome-language">
                <LanguageSwitcher id="welcome-language" value={draftLocale} onChange={setDraftLocale} />
              </Field>
              <Field label={t('welcome.form.channel')} help={t('welcome.form.channelHelp')} htmlFor="welcome-channel" error={fieldError('channelId')}>
                {channels.loading ? (
                  <Skeleton className="h-11 w-full" />
                ) : writable.length === 0 ? (
                  <Alert tone="warning">{t('welcome.form.noChannels')}</Alert>
                ) : (
                  <Select
                    id="welcome-channel"
                    value={draft.channelId ?? ''}
                    onChange={(value) => update('channelId', value || null)}
                    aria-describedby="welcome-channel-help"
                  >
                    <option value="">{t('welcome.form.channelPlaceholder')}</option>
                    {[...groups].map(([parent, list]) => {
                      const options = list.map((channel) => (
                        <option key={channel.id} value={channel.id}>
                          # {channel.name}
                          {channel.canSend ? '' : ` ${emoji.warning}`}
                        </option>
                      ));
                      return parent ? (
                        <optgroup key={parent} label={parent}>
                          {options}
                        </optgroup>
                      ) : (
                        options
                      );
                    })}
                  </Select>
                )}
              </Field>
              <Alert tone="info">{t('welcome.status.rateLimited', { count: maxPerMinute })}</Alert>
            </div>
          </Card>

          <Card>
            <CardHeader icon={emoji.welcome} title={t('welcome.form.content')} description={t('welcome.form.defaultHint')} />
            <div className="space-y-5">
              <Field label={t('welcome.form.title')} htmlFor="welcome-title" error={fieldError('title')} warning={placeholderHint('title')}>
                <Input
                  id="welcome-title"
                  ref={fieldRefs.title}
                  value={draft.title}
                  maxLength={200}
                  placeholder={defaults.title}
                  onFocus={() => (lastFocused.current = 'title')}
                  onChange={(event) => update('title', event.target.value)}
                  aria-invalid={Boolean(fieldError('title'))}
                />
              </Field>
              <Field label={t('welcome.form.description')} htmlFor="welcome-description" error={fieldError('description')} warning={placeholderHint('description')}>
                <Textarea
                  id="welcome-description"
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
                <p className="mb-2 text-sm font-medium">{t('welcome.form.placeholders')}</p>
                <ul className="flex flex-wrap gap-2">
                  {WELCOME_PLACEHOLDERS.map((name) => (
                    <li key={name}>
                      <button
                        type="button"
                        onClick={() => insertPlaceholder(name)}
                        aria-label={t('welcome.form.insertPlaceholder', { name: `{${name}}` })}
                        title={t(`welcome.placeholder.${name}`)}
                        className="glow-hover inline-flex min-h-10 items-center gap-2 rounded-full border border-line bg-raised/60 px-3 text-sm"
                      >
                        <code className="font-mono text-aqua">{`{${name}}`}</code>
                        <span className="hidden text-muted sm:inline">{t(`welcome.placeholder.${name}`)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader icon={emoji.sparkle} title={t('welcome.form.style')} />
            <div className="space-y-5">
              <Field label={t('welcome.form.color')} htmlFor="welcome-color" error={fieldError('color')}>
                <ColorField id="welcome-color" value={draft.color} fallback={colors.primary} onChange={(value) => update('color', value)} />
              </Field>
              <Switch checked={draft.showAvatar} onChange={(value) => update('showAvatar', value)} label={t('welcome.form.showAvatar')} description={t('welcome.form.showAvatarHelp')} />
              <Switch checked={draft.mentionUser} onChange={(value) => update('mentionUser', value)} label={t('welcome.form.mention')} description={t('welcome.form.mentionHelp')} />
              <Field
                label={t('welcome.form.banner')}
                help={t('welcome.form.bannerHelp')}
                htmlFor="welcome-banner"
                error={draft.bannerUrl ? fieldError('bannerUrl') : undefined}
                optional
                optionalLabel={t('common.optional')}
              >
                <Input
                  id="welcome-banner"
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
                label={t('welcome.form.footer')}
                help={t('welcome.form.footerHelp')}
                warning={placeholderHint('footer')}
                htmlFor="welcome-footer"
                error={fieldError('footer')}
                optional
                optionalLabel={t('common.optional')}
              >
                <Input
                  id="welcome-footer"
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

const welcomeErrorKeys = {
  no_channel: 'welcome.errors.no_channel',
  channel_missing: 'welcome.errors.channel_missing',
  missing_permissions: 'welcome.errors.missing_permissions',
  send_failed: 'welcome.errors.send_failed',
} as const;

function WelcomeSkeleton() {
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
