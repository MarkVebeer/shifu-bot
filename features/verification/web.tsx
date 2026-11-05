/**
 * Verification feature: dashboard page.
 */
import { Button as UiButton } from '@/components/ui/button';
import { colors, findUnknownPlaceholders } from '@shifubot/shared';
import { ArrowsClockwise, ArrowSquareOut, Eye, PaperPlaneTilt, ShieldCheck } from '@phosphor-icons/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../apps/web/src/lib/api';
import { useGuild } from '../../apps/web/src/lib/guild';
import { errorText, useI18n } from '../../apps/web/src/lib/i18n';
import { useApi } from '../../apps/web/src/lib/use-api';
import { ChannelPicker } from '../../apps/web/src/ui/channel-picker';
import { DiscordMessagePreview } from '../../apps/web/src/ui/discord-preview';
import { Icon } from '../../apps/web/src/ui/icon';
import { Alert, Button, Card, CardHeader, Field, Input, Select, Skeleton, Switch, Textarea, cx, PageHeader, Badge } from '../../apps/web/src/ui/primitives';
import { RolePicker } from '../../apps/web/src/ui/role-picker';
import { useToast } from '../../apps/web/src/ui/toast';
import { ChoiceCards, ColorField, SaveBar } from '../../apps/web/src/ui/widgets';
import {
  buildVerificationPanel,
  CAPTCHA_RULES,
  FAIL_ACTIONS,
  MAX_TIMEOUT_MINUTES,
  VERIFICATION_MODES,
  VERIFICATION_PLACEHOLDERS,
  verificationSettingsSchema,
  type FailAction,
  type VerificationMode,
  type VerificationSettings,
} from './manifest';
import type { VerificationErrorCode, VerificationResponse } from './server';

type TextField = 'title' | 'description';

export default function VerificationPage() {
  const { t, locale: uiLocale } = useI18n();
  const toast = useToast();
  const { guild, setDirty, permissions } = useGuild();
  const base = `/guilds/${guild.id}/features/verification`;
  const verification = useApi<VerificationResponse>(base);

  const [draft, setDraft] = useState<VerificationSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [reposting, setReposting] = useState(false);
  const [sampleNonce, setSampleNonce] = useState(0);
  const saved = verification.data?.settings;

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

  const validation = useMemo(() => (draft ? verificationSettingsSchema.safeParse(draft) : null), [draft]);
  const fieldError = (field: keyof VerificationSettings) =>
    validation && !validation.success
      ? validation.error.issues.find((issue) => issue.path[0] === field)?.message
      : undefined;

  const now = useMemo(() => new Date(), []);
  const payload = useMemo(() => {
    if (!draft) return null;
    return buildVerificationPanel(
      { ...draft, color: fieldError('color') ? null : draft.color },
      { locale: guild.locale, server: { name: guild.name } },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, guild, validation]);

  if (verification.error) return <Alert tone="danger">{errorText(t, verification.error)}</Alert>;
  if (!draft || !verification.data) return <VerificationSkeleton />;

  const errorLabel = (code: VerificationErrorCode) => t(`verification.errors.${code}`);

  const update = <K extends keyof VerificationSettings>(key: K, value: VerificationSettings[K]) =>
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
      const response = await api<VerificationResponse>(base, { method: 'PUT', body: validation.data });
      verification.setData(response);
      setDraft(response.settings);
      void permissions.reload();
      if (response.panelError) toast.error(t('verification.panel.failed', { error: errorLabel(response.panelError) }));
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
      const result = await api<VerificationResponse & { channel: { name: string } | null }>(`${base}/panel`, { method: 'POST' });
      verification.setData(result);
      if (result.channel) toast.success(t('verification.panel.reposted', { channel: result.channel.name }));
    } catch (error) {
      const code = (error as { code?: string }).code ?? '';
      toast.error(code in verificationErrorCodes ? errorLabel(code as VerificationErrorCode) : errorText(t, error));
      void verification.reload();
    } finally {
      setReposting(false);
    }
  };

  const { status } = verification.data;
  const savedChannelSelected = draft.channelId !== null && draft.channelId === saved?.channelId;
  const savedRoleSelected = draft.roleId !== null && draft.roleId === saved?.roleId;

  const warnings: { tone: 'warning' | 'danger' | 'info'; text: string }[] = [];
  if (draft.enabled) {
    if (!draft.channelId) warnings.push({ tone: 'warning', text: t('verification.status.noChannel') });
    else if (savedChannelSelected && !status.channelExists) warnings.push({ tone: 'danger', text: t('verification.status.channelMissing') });
    else if (savedChannelSelected && status.missingPermissions.length)
      warnings.push({
        tone: 'danger',
        text: t('verification.status.missingPermissions', { permissions: status.missingPermissions.join(', ') }),
      });
    if (!draft.roleId) warnings.push({ tone: 'warning', text: t('verification.status.noRole') });
    else if (savedRoleSelected && status.roleProblem && status.roleProblem !== 'no_role')
      warnings.push({ tone: 'danger', text: errorLabel(status.roleProblem) });
  }
  if (status.lastError && saved?.enabled) {
    warnings.push({ tone: 'warning', text: t('verification.status.lastError', { error: errorLabel(status.lastError.code) }) });
  }

  const placeholderHint = (field: TextField) => {
    const unknown = findUnknownPlaceholders(draft[field], VERIFICATION_PLACEHOLDERS);
    return unknown.length ? t('verification.form.unknownPlaceholder', { names: unknown.map((n) => `{${n}}`).join(', ') }) : undefined;
  };

  const timeLabel = t('verification.preview.today', {
    time: new Intl.DateTimeFormat(uiLocale, { hour: '2-digit', minute: '2-digit' }).format(now),
  });

  const panelLive = saved?.enabled && status.panel;

  const preview = payload && (
    <div className="space-y-6">
      <Card className="space-y-4">
        <CardHeader icon={<Eye className="size-5 text-primary" />} title={t('verification.preview.title')} description={t('verification.preview.hint')} />
        <DiscordMessagePreview payload={payload} bot={guild.bot} mentions={{}} botTag={t('verification.preview.botTag')} timestampLabel={timeLabel} />
        {saved?.enabled && (
          <div className="space-y-3">
            {panelLive ? (
              <a
                href={status.panel!.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline"
              >
                <ArrowSquareOut className="size-4" aria-hidden />
                {t('verification.status.panelLive', { channel: status.panel!.channelName })}
              </a>
            ) : (
              <p className="text-sm text-warning">{t('verification.status.panelMissing')}</p>
            )}
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Button variant="secondary" onClick={repost} loading={reposting} disabled={dirty} icon={<PaperPlaneTilt className="size-4" aria-hidden />}>
                {reposting ? t('verification.panel.reposting') : t('verification.panel.repost')}
              </Button>
              <p className="text-xs text-muted-foreground">{t('verification.panel.help')}</p>
            </div>
          </div>
        )}
      </Card>

      {draft.mode === 'captcha' && (
        <Card className="space-y-4">
          <CardHeader icon={<Icon name="test" />} title={t('verification.preview.captchaTitle')} description={t('verification.preview.captchaHint')} />
          <div className="overflow-hidden rounded-lg bg-discord-embed p-3">
            <img
              src={`/api${base}/captcha.png?n=${sampleNonce}`}
              alt={t('verification.preview.captchaAlt')}
              width={360}
              height={120}
              className="h-auto w-full rounded-[4px]"
            />
          </div>
          <Button variant="ghost" onClick={() => setSampleNonce((n) => n + 1)} icon={<ArrowsClockwise className="size-4" aria-hidden />}>
            {t('verification.preview.newSample')}
          </Button>
        </Card>
      )}
    </div>
  );

  return (
    <div className="animate-fade-up">
      <PageHeader
        title={t('verification.name')}
        description={t('verification.description')}
        badge={<Badge tone={verification.data.settings.enabled ? 'success' : 'muted'}>{verification.data.settings.enabled ? t('overview.active') : t('overview.inactive')}</Badge>}
        actions={status.verifiedCount > 0 ? (
          <p className="inline-flex items-center gap-2 text-sm tabular-nums text-muted-foreground">
            <ShieldCheck className="size-4 text-success" aria-hidden />
            {t('verification.status.verifiedCount', { count: status.verifiedCount.toLocaleString(guild.locale) })}
          </p>
        ) : undefined}
      />

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
            <CardHeader icon={<Icon name="sparkle" />} title={t('verification.form.general')} />
            <div className="space-y-5">
              <Switch checked={draft.enabled} onChange={(value) => update('enabled', value)} label={t('verification.form.enabled')} description={t('verification.form.enabledHelp')} />
              <ChannelPicker
                id="verification-channel"
                label={t('verification.form.channel')}
                value={draft.channelId}
                onChange={(value) => update('channelId', value)}
                error={fieldError('channelId')}
              />
              <RolePicker id="verification-role" value={draft.roleId} onChange={(value) => update('roleId', value)} error={fieldError('roleId')} />
              <ModePicker value={draft.mode} onChange={(mode) => update('mode', mode)} />
              <Alert tone="info">{t('verification.form.lockHint')}</Alert>
            </div>
          </Card>

          <Card>
            <CardHeader
              icon={<Icon name="verification" />}
              title={t('verification.form.protection')}
              description={t('verification.form.rules', { minutes: CAPTCHA_RULES.expiresMinutes, window: CAPTCHA_RULES.attemptsWindowMinutes })}
            />
            <div className="space-y-5">
              {draft.mode === 'captcha' ? (
                <>
                  <Field label={t('verification.form.maxAttempts')} help={t('verification.form.maxAttemptsHelp')} htmlFor="verification-attempts" error={fieldError('maxAttempts')}>
                    <Input
                      id="verification-attempts"
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={10}
                      value={draft.maxAttempts}
                      onChange={(event) => update('maxAttempts', event.target.value === '' ? 0 : Math.trunc(Number(event.target.value)))}
                      aria-invalid={Boolean(fieldError('maxAttempts'))}
                      className="w-28 font-mono"
                    />
                  </Field>
                  <Field label={t('verification.form.failAction')} help={t(`verification.form.failActionHelp.${draft.failAction}`)} htmlFor="verification-fail-action">
                    <Select id="verification-fail-action" value={draft.failAction} onChange={(value) => update('failAction', value as FailAction)} aria-describedby="verification-fail-action-help">
                      {FAIL_ACTIONS.map((action) => (
                        <option key={action} value={action}>
                          {t(`verification.form.failActions.${action}`)}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  {draft.failAction === 'timeout' && (
                    <Field label={t('verification.form.timeoutMinutes')} help={t('verification.form.timeoutMinutesHelp')} htmlFor="verification-timeout" error={fieldError('timeoutMinutes')}>
                      <div className="flex items-center gap-3">
                        <Input
                          id="verification-timeout"
                          type="number"
                          inputMode="numeric"
                          min={1}
                          max={MAX_TIMEOUT_MINUTES}
                          value={draft.timeoutMinutes}
                          onChange={(event) => update('timeoutMinutes', event.target.value === '' ? 0 : Math.trunc(Number(event.target.value)))}
                          aria-invalid={Boolean(fieldError('timeoutMinutes'))}
                          className="w-32 font-mono"
                        />
                        <span className="text-sm text-muted-foreground">{t('verification.form.minutes')}</span>
                      </div>
                    </Field>
                  )}
                  {(draft.failAction === 'kick' || draft.failAction === 'ban') && <Alert tone="warning">{t('verification.form.failActionWarning')}</Alert>}
                </>
              ) : (
                <p className="text-sm text-muted-foreground">{t('verification.form.captchaOnly')}</p>
              )}
              <Field
                label={t('verification.form.minAccountAge')}
                help={t('verification.form.minAccountAgeHelp')}
                htmlFor="verification-age"
                error={fieldError('minAccountAgeDays')}
              >
                <div className="flex items-center gap-3">
                  <Input
                    id="verification-age"
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={365}
                    value={draft.minAccountAgeDays}
                    onChange={(event) => update('minAccountAgeDays', event.target.value === '' ? 0 : Math.trunc(Number(event.target.value)))}
                    aria-invalid={Boolean(fieldError('minAccountAgeDays'))}
                    className="w-28 font-mono"
                  />
                  <span className="text-sm text-muted-foreground">{t('verification.form.days')}</span>
                </div>
              </Field>
              <Switch
                checked={draft.restoreOnRejoin}
                onChange={(value) => update('restoreOnRejoin', value)}
                label={t('verification.form.restoreOnRejoin')}
                description={t('verification.form.restoreOnRejoinHelp')}
              />
            </div>
          </Card>

          <Card>
            <CardHeader icon={<Icon name="welcome" />} title={t('verification.form.panel')} description={t('verification.form.defaultHint')} />
            <div className="space-y-5">
              <Field label={t('verification.form.title')} htmlFor="verification-title" error={fieldError('title')} warning={placeholderHint('title')}>
                <Input
                  id="verification-title"
                  ref={fieldRefs.title}
                  value={draft.title}
                  maxLength={200}
                  placeholder={t('verification.defaults.title')}
                  onFocus={() => (lastFocused.current = 'title')}
                  onChange={(event) => update('title', event.target.value)}
                  aria-invalid={Boolean(fieldError('title'))}
                />
              </Field>
              <Field
                label={t('verification.form.description')}
                htmlFor="verification-description"
                error={fieldError('description')}
                warning={placeholderHint('description')}
              >
                <Textarea
                  id="verification-description"
                  ref={fieldRefs.description}
                  value={draft.description}
                  maxLength={2000}
                  rows={4}
                  placeholder={t(draft.mode === 'captcha' ? 'verification.defaults.descriptionCaptcha' : 'verification.defaults.descriptionButton')}
                  onFocus={() => (lastFocused.current = 'description')}
                  onChange={(event) => update('description', event.target.value)}
                  aria-invalid={Boolean(fieldError('description'))}
                />
              </Field>
              <div>
                <p className="mb-2 text-sm font-medium">{t('verification.form.placeholders')}</p>
                <ul className="flex flex-wrap gap-2">
                  {VERIFICATION_PLACEHOLDERS.map((name) => (
                    <li key={name}>
                      <UiButton
                        type="button"
                        onClick={() => insertPlaceholder(name)}
                        aria-label={t('verification.form.insertPlaceholder', { name: `{${name}}` })}
                        title={t(`verification.placeholder.${name}`)}
                        variant="outline"
                        className="h-10 rounded-full font-normal"
                      >
                        <code className="font-mono">{`{${name}}`}</code>
                        <span className="hidden text-muted-foreground sm:inline">{t(`verification.placeholder.${name}`)}</span>
                      </UiButton>
                    </li>
                  ))}
                </ul>
              </div>
              <Field label={t('verification.form.buttonLabel')} htmlFor="verification-button" error={fieldError('buttonLabel')}>
                <Input
                  id="verification-button"
                  value={draft.buttonLabel}
                  maxLength={80}
                  placeholder={t('verification.defaults.button')}
                  onChange={(event) => update('buttonLabel', event.target.value)}
                />
              </Field>
            </div>
          </Card>

          <Card>
            <CardHeader icon={<Icon name="sparkle" />} title={t('verification.form.style')} />
            <Field label={t('verification.form.color')} htmlFor="verification-color" error={fieldError('color')}>
              <ColorField id="verification-color" value={draft.color} fallback={colors.primary} onChange={(value) => update('color', value)} />
            </Field>
          </Card>

          <SaveBar visible={dirty} saving={saving} onSave={() => void save()} onDiscard={() => setDraft(verification.data!.settings)} />
        </form>
      </div>
    </div>
  );
}

const verificationErrorCodes: Record<VerificationErrorCode, true> = {
  no_channel: true,
  channel_missing: true,
  missing_permissions: true,
  send_failed: true,
  no_role: true,
  role_missing: true,
  role_managed: true,
  no_manage_roles: true,
  role_too_high: true,
  role_failed: true,
  fail_action_failed: true,
};

function ModePicker({ value, onChange }: { value: VerificationMode; onChange: (mode: VerificationMode) => void }) {
  const { t } = useI18n();
  const labels = {
    captcha: { title: t('verification.form.modeCaptcha'), help: t('verification.form.modeCaptchaHelp') },
    button: { title: t('verification.form.modeButton'), help: t('verification.form.modeButtonHelp') },
  } satisfies Record<VerificationMode, { title: string; help: string }>;
  return (
    <div className="flex flex-col gap-2">
      <p id="verification-mode-label" className="text-sm font-medium text-foreground">
        {t('verification.form.mode')}
      </p>
      <ChoiceCards
        aria-labelledby="verification-mode-label"
        value={value}
        onChange={onChange}
        choices={VERIFICATION_MODES.map((mode) => ({ value: mode, title: labels[mode].title, hint: labels[mode].help }))}
      />
    </div>
  );
}

function VerificationSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true">
      <Skeleton className="h-9 w-48" />
      <Skeleton className="h-4 w-96 max-w-full" />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,460px)]">
        <div className={cx('space-y-6')}>
          <Skeleton className="h-72 rounded-lg" />
          <Skeleton className="h-56 rounded-lg" />
        </div>
        <Skeleton className="h-80 rounded-lg" />
      </div>
    </div>
  );
}
