/**
 * Verification feature: its part of the first run setup and the Settings tab.
 * Only the essentials are asked here; texts and protection stay on the Verification page.
 */
import { api } from '../../apps/web/src/lib/api';
import { useT } from '../../apps/web/src/lib/i18n';
import { defineSetupSection, type SetupSectionProps } from '../../apps/web/src/lib/setup';
import { ChannelPicker } from '../../apps/web/src/ui/channel-picker';
import { Switch } from '../../apps/web/src/ui/primitives';
import { RolePicker } from '../../apps/web/src/ui/role-picker';
import { verificationManifest, type VerificationSettings } from './manifest';
import type { VerificationResponse } from './server';

function VerificationSetup({ value, onChange }: SetupSectionProps<VerificationSettings>) {
  const t = useT();
  return (
    <div className="space-y-5">
      <Switch
        checked={value.enabled}
        onChange={(enabled) => onChange({ ...value, enabled })}
        label={t('verification.form.enabled')}
        description={t('verification.form.enabledHelp')}
      />
      {value.enabled && (
        <div className="animate-fade-in space-y-5">
          <ChannelPicker
            id="setup-verification-channel"
            label={t('verification.form.channel')}
            value={value.channelId}
            onChange={(channelId) => onChange({ ...value, channelId })}
          />
          <RolePicker id="setup-verification-role" value={value.roleId} onChange={(roleId) => onChange({ ...value, roleId })} />
        </div>
      )}
    </div>
  );
}

export default defineSetupSection<VerificationSettings>({
  id: verificationManifest.id,
  emoji: verificationManifest.emoji,
  title: 'verification.setup.title',
  description: 'verification.setup.description',
  load: async (guild) => (await api<VerificationResponse>(`/guilds/${guild.id}/features/verification`)).settings,
  save: async (guild, value) => {
    await api(`/guilds/${guild.id}/features/verification`, { method: 'PUT', body: value });
  },
  validate: (value) => {
    if (!value.enabled) return null;
    if (!value.channelId) return 'verification.setup.channelRequired';
    if (!value.roleId) return 'verification.setup.roleRequired';
    return null;
  },
  summary: (value, t) => (value.enabled ? t('verification.setup.summaryOn') : t('verification.setup.summaryOff')),
  Component: VerificationSetup,
});
