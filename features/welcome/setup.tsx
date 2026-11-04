/**
 * Welcome feature: its part of the first run setup and the Settings tab.
 * Only the essentials are asked here; texts and style stay on the Welcome page.
 */
import { api } from '../../apps/web/src/lib/api';
import { useT } from '../../apps/web/src/lib/i18n';
import { defineSetupSection, type SetupSectionProps } from '../../apps/web/src/lib/setup';
import { Switch } from '../../apps/web/src/ui/primitives';
import { ChannelPicker } from '../../apps/web/src/ui/channel-picker';
import { welcomeManifest, type WelcomeSettings } from './manifest';
import type { WelcomeResponse } from './server';

function WelcomeSetup({ value, onChange }: SetupSectionProps<WelcomeSettings>) {
  const t = useT();
  return (
    <div className="space-y-5">
      <Switch
        checked={value.enabled}
        onChange={(enabled) => onChange({ ...value, enabled })}
        label={t('welcome.form.enabled')}
        description={t('welcome.form.enabledHelp')}
      />
      {value.enabled && (
        <div className="animate-fade-in">
          <ChannelPicker
            id="setup-welcome-channel"
            value={value.channelId}
            onChange={(channelId) => onChange({ ...value, channelId })}
          />
        </div>
      )}
    </div>
  );
}

export default defineSetupSection<WelcomeSettings>({
  id: welcomeManifest.id,
  emoji: welcomeManifest.emoji,
  title: 'welcome.setup.title',
  description: 'welcome.setup.description',
  load: async (guild) => (await api<WelcomeResponse>(`/guilds/${guild.id}/features/welcome`)).settings,
  save: async (guild, value) => {
    await api(`/guilds/${guild.id}/features/welcome`, { method: 'PUT', body: value });
  },
  validate: (value) => (value.enabled && !value.channelId ? 'welcome.setup.channelRequired' : null),
  summary: (value, t) => (value.enabled ? t('welcome.setup.summaryOn') : t('welcome.setup.summaryOff')),
  Component: WelcomeSetup,
});
