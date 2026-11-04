/**
 * Goodbye feature: its part of the first run setup and the Settings tab.
 * Only the essentials are asked here; texts and style stay on the Goodbye page.
 */
import { api } from '../../apps/web/src/lib/api';
import { useT } from '../../apps/web/src/lib/i18n';
import { defineSetupSection, type SetupSectionProps } from '../../apps/web/src/lib/setup';
import { Switch } from '../../apps/web/src/ui/primitives';
import { ChannelPicker } from '../../apps/web/src/ui/channel-picker';
import { goodbyeManifest, type GoodbyeSettings } from './manifest';
import type { GoodbyeResponse } from './server';

function GoodbyeSetup({ value, onChange }: SetupSectionProps<GoodbyeSettings>) {
  const t = useT();
  return (
    <div className="space-y-5">
      <Switch
        checked={value.enabled}
        onChange={(enabled) => onChange({ ...value, enabled })}
        label={t('goodbye.form.enabled')}
        description={t('goodbye.form.enabledHelp')}
      />
      {value.enabled && (
        <div className="animate-fade-in">
          <ChannelPicker
            id="setup-goodbye-channel"
            value={value.channelId}
            onChange={(channelId) => onChange({ ...value, channelId })}
          />
        </div>
      )}
    </div>
  );
}

export default defineSetupSection<GoodbyeSettings>({
  id: goodbyeManifest.id,
  emoji: goodbyeManifest.emoji,
  title: 'goodbye.setup.title',
  description: 'goodbye.setup.description',
  load: async (guild) => (await api<GoodbyeResponse>(`/guilds/${guild.id}/features/goodbye`)).settings,
  save: async (guild, value) => {
    await api(`/guilds/${guild.id}/features/goodbye`, { method: 'PUT', body: value });
  },
  validate: (value) => (value.enabled && !value.channelId ? 'goodbye.setup.channelRequired' : null),
  summary: (value, t) => (value.enabled ? t('goodbye.setup.summaryOn') : t('goodbye.setup.summaryOff')),
  Component: GoodbyeSetup,
});
