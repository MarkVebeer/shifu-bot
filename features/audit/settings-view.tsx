/**
 * Audit log settings: on/off, what to record, retention, ignore list, invite tracking, purge.
 */
import { Check, ChevronDown, FolderTree, Minus, Search, Trash2 } from 'lucide-react';
import { Icon } from '../../apps/web/src/ui/icon';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../../apps/web/src/lib/api';
import { useGuild } from '../../apps/web/src/lib/guild';
import { errorText, useI18n } from '../../apps/web/src/lib/i18n';
import type { ApiState } from '../../apps/web/src/lib/use-api';
import { ChannelMultiPicker } from '../../apps/web/src/ui/channel-multi-picker';
import { Alert, Button, Card, CardHeader, Field, Select, Switch, cx } from '../../apps/web/src/ui/primitives';
import { useToast } from '../../apps/web/src/ui/toast';
import { ConfirmDialog, SaveBar } from '../../apps/web/src/ui/widgets';
import { CategoryIcon, categoryLabel, typeLabel } from './labels';
import { AUDIT_CATEGORIES, auditSettingsSchema, RETENTION_DAYS, typesByCategory, type AuditCategory, type AuditResponse, type AuditSettings } from './manifest';

export function SettingsView({ audit }: { audit: ApiState<AuditResponse> }) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const { guild, setDirty, permissions } = useGuild();
  const base = `/guilds/${guild.id}/features/audit`;
  const saved = audit.data!.settings;
  const [draft, setDraft] = useState<AuditSettings>(saved);
  const [saving, setSaving] = useState(false);
  const [openCategory, setOpenCategory] = useState<AuditCategory | null>(null);
  const [confirmPurge, setConfirmPurge] = useState(false);
  const grouped = useMemo(() => typesByCategory(), []);

  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  useEffect(() => setDirty(dirty), [dirty, setDirty]);
  useEffect(() => () => setDirty(false), [setDirty]);

  const update = <K extends keyof AuditSettings>(key: K, value: AuditSettings[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const { capabilities, stats } = audit.data!;

  const save = async () => {
    const validation = auditSettingsSchema.safeParse(draft);
    if (!validation.success) {
      toast.error(t('errors.validation'));
      return;
    }
    setSaving(true);
    try {
      const response = await api<AuditResponse>(base, { method: 'PUT', body: validation.data });
      audit.setData(response);
      setDraft(response.settings);
      void permissions.reload();
      toast.success(t('toast.saved'));
    } catch (error) {
      toast.error(`${t('toast.saveFailed')}: ${errorText(t, error)}`);
    } finally {
      setSaving(false);
    }
  };

  const purge = async () => {
    setConfirmPurge(false);
    try {
      audit.setData(await api<AuditResponse>(`${base}/purge`, { method: 'POST' }));
      toast.success(t('audit.form.purgeDone'));
    } catch (error) {
      toast.error(errorText(t, error));
    }
  };

  const toggleCategory = (category: AuditCategory, on: boolean) =>
    update('disabledCategories', on ? draft.disabledCategories.filter((item) => item !== category) : [...draft.disabledCategories, category]);
  const toggleType = (type: string, on: boolean) =>
    update('disabledTypes', on ? draft.disabledTypes.filter((item) => item !== type) : [...draft.disabledTypes, type]);

  const warnings: { tone: 'info' | 'warning'; text: string }[] = [];
  if (draft.enabled && !capabilities.viewAuditLog) warnings.push({ tone: 'warning', text: t('audit.capabilities.viewAuditLogOff') });
  if (draft.enabled && draft.trackInvites && !capabilities.manageGuild) warnings.push({ tone: 'warning', text: t('audit.capabilities.manageGuildOff') });

  return (
    <form
      className="mx-auto max-w-3xl space-y-6"
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
        <CardHeader icon={<Icon name="log" />} title={t('audit.form.general')} />
        <div className="space-y-4">
          <Switch checked={draft.enabled} onChange={(enabled) => update('enabled', enabled)} label={t('audit.form.enabled')} description={t('audit.form.enabledHelp')} />
          <p className="text-sm text-muted">
            {stats.events > 0 && stats.oldest
              ? t('audit.form.stats', {
                  count: stats.events.toLocaleString(locale),
                  date: new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(stats.oldest),
                })
              : t('audit.form.statsEmpty')}
          </p>
        </div>
      </Card>

      <Card>
        <CardHeader icon={<Search className="size-[18px]" strokeWidth={1.75} />} title={t('audit.capabilities.title')} />
        <ul className="space-y-2 text-sm">
          <li className={cx('flex items-start gap-2', capabilities.messageContent ? 'text-ink' : 'text-muted')}>
            {capabilities.messageContent ? <Check className="mt-0.5 size-4 shrink-0" aria-hidden /> : <Minus className="mt-0.5 size-4 shrink-0" aria-hidden />}
            {capabilities.messageContent ? t('audit.capabilities.messageContentOn') : t('audit.capabilities.messageContentOff')}
          </li>
        </ul>
      </Card>

      <Card>
        <CardHeader icon={<FolderTree className="size-[18px]" strokeWidth={1.75} />} title={t('audit.form.what')} description={t('audit.form.whatHelp')} />
        <ul className="divide-y divide-line/60">
          {AUDIT_CATEGORIES.map((category) => {
            const on = !draft.disabledCategories.includes(category);
            const types = grouped[category];
            const enabledTypes = types.filter((type) => !draft.disabledTypes.includes(type)).length;
            const expanded = openCategory === category;
            return (
              <li key={category} className="py-2">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setOpenCategory(expanded ? null : category)}
                    aria-expanded={expanded}
                    aria-controls={`audit-types-${category}`}
                    className="grid size-9 shrink-0 place-items-center rounded-full text-muted hover:bg-raised hover:text-ink"
                  >
                    <ChevronDown className={cx('size-4 transition', expanded && 'rotate-180')} aria-hidden />
                  </button>
                  <div className="min-w-0 flex-1">
                    <Switch
                      checked={on}
                      onChange={(value) => toggleCategory(category, value)}
                      label={
                        <span className="inline-flex items-center gap-2">
                          <CategoryIcon category={category} className="size-4 text-muted" />
                          {categoryLabel(t, category)}
                        </span>
                      }
                      description={t('audit.form.typeCount', { on: String(on ? enabledTypes : 0), total: String(types.length) })}
                    />
                  </div>
                </div>
                {expanded && (
                  <ul id={`audit-types-${category}`} className="ml-11 mt-2 grid animate-fade-in gap-1 sm:grid-cols-2">
                    {types.map((type) => {
                      const typeOn = !draft.disabledTypes.includes(type);
                      return (
                        <li key={type}>
                          <label className={cx('flex min-h-10 cursor-pointer items-center gap-2 rounded-token px-2 text-sm hover:bg-raised/60', !on && 'opacity-50')}>
                            <input
                              type="checkbox"
                              checked={typeOn}
                              disabled={!on}
                              onChange={(event) => toggleType(type, event.target.checked)}
                              className="size-4 accent-primary"
                            />
                            {typeLabel(t, type)}
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </Card>

      <Card className="space-y-5">
        <Field label={t('audit.form.retention')} help={t('audit.form.retentionHelp')} htmlFor="audit-retention">
          <Select id="audit-retention" value={String(draft.retentionDays)} onChange={(value) => update('retentionDays', Number(value) as AuditSettings['retentionDays'])}>
            {RETENTION_DAYS.map((days) => (
              <option key={days} value={days}>
                {t('audit.form.retentionDays', { days: String(days) })}
              </option>
            ))}
          </Select>
        </Field>
        <ChannelMultiPicker
          id="audit-ignored"
          label={t('audit.form.ignored')}
          help={t('audit.form.ignoredHelp')}
          placeholder={t('audit.form.ignoredPlaceholder')}
          emptyText={t('audit.form.ignoredEmpty')}
          removeLabel={(name) => t('audit.form.remove', { name })}
          value={draft.ignoredChannelIds}
          onChange={(ids) => update('ignoredChannelIds', ids)}
        />
        <Switch checked={draft.ignoreBots} onChange={(value) => update('ignoreBots', value)} label={t('audit.form.ignoreBots')} description={t('audit.form.ignoreBotsHelp')} />
        <Switch checked={draft.trackInvites} onChange={(value) => update('trackInvites', value)} label={t('audit.form.trackInvites')} description={t('audit.form.trackInvitesHelp')} />
      </Card>

      <Card className="border-danger/30">
        <CardHeader icon={<Icon name="warning" />} title={t('audit.form.danger')} description={t('audit.form.purgeHelp')} />
        <Button variant="danger" onClick={() => setConfirmPurge(true)} icon={<Trash2 className="size-4" aria-hidden />} disabled={stats.events === 0}>
          {t('audit.form.purge')}
        </Button>
      </Card>

      <SaveBar visible={dirty} saving={saving} onSave={() => void save()} onDiscard={() => setDraft(saved)} />
      <ConfirmDialog
        open={confirmPurge}
        title={t('audit.form.purgeTitle')}
        body={t('audit.form.purgeBody')}
        confirmLabel={t('audit.form.purgeConfirm')}
        cancelLabel={t('setup.cancel')}
        onConfirm={() => void purge()}
        onCancel={() => setConfirmPurge(false)}
      />
    </form>
  );
}
