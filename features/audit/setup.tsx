/**
 * Audit log feature: its part of the first run setup and the Settings tab. Only the main switch;
 * what is recorded is tuned on the Audit log page.
 */
import { api } from '../../apps/web/src/lib/api';
import { useT } from '../../apps/web/src/lib/i18n';
import { defineSetupSection, type SetupSectionProps } from '../../apps/web/src/lib/setup';
import { Switch } from '../../apps/web/src/ui/primitives';
import { auditManifest, type AuditResponse, type AuditSettings } from './manifest';

function AuditSetup({ value, onChange }: SetupSectionProps<AuditSettings>) {
  const t = useT();
  return (
    <Switch
      checked={value.enabled}
      onChange={(enabled) => onChange({ ...value, enabled })}
      label={t('audit.form.enabled')}
      description={t('audit.form.enabledHelp')}
    />
  );
}

export default defineSetupSection<AuditSettings>({
  id: auditManifest.id,
  emoji: auditManifest.emoji,
  title: 'audit.setup.title',
  description: 'audit.setup.description',
  load: async (guild) => (await api<AuditResponse>(`/guilds/${guild.id}/features/audit`)).settings,
  save: async (guild, value) => {
    await api(`/guilds/${guild.id}/features/audit`, { method: 'PUT', body: value });
  },
  summary: (value, t) => (value.enabled ? t('audit.setup.summaryOn') : t('audit.setup.summaryOff')),
  Component: AuditSetup,
});
