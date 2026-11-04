/**
 * Goon counter: its part of the first run setup and the Settings tab.
 * Only the switch and the channel are asked here; the rest stays on the Goon counter page.
 */
import { api } from '../../apps/web/src/lib/api';
import { useT } from '../../apps/web/src/lib/i18n';
import { defineSetupSection, type SetupSectionProps } from '../../apps/web/src/lib/setup';
import { ChannelPicker } from '../../apps/web/src/ui/channel-picker';
import { Switch } from '../../apps/web/src/ui/primitives';
import { goonManifest, type GoonSettings } from './manifest';
import type { GoonResponse } from './server';

function GoonSetup({ value, onChange }: SetupSectionProps<GoonSettings>) {
  const t = useT();
  return (
    <div className="space-y-5">
      <Switch
        checked={value.enabled}
        onChange={(enabled) => onChange({ ...value, enabled })}
        label={t('goon.form.enabled')}
        description={t('goon.form.enabledHelp')}
      />
      {value.enabled && (
        <div className="animate-fade-in">
          <ChannelPicker
            id="setup-goon-channel"
            label={t('goon.form.channel')}
            value={value.channelId}
            onChange={(channelId) => onChange({ ...value, channelId })}
          />
        </div>
      )}
    </div>
  );
}

export default defineSetupSection<GoonSettings>({
  id: goonManifest.id,
  emoji: goonManifest.emoji,
  title: 'goon.setup.title',
  description: 'goon.setup.description',
  load: async (guild) => (await api<GoonResponse>(`/guilds/${guild.id}/features/goon`)).settings,
  save: async (guild, value) => {
    await api(`/guilds/${guild.id}/features/goon`, { method: 'PUT', body: value });
  },
  validate: (value) => (value.enabled && !value.channelId ? 'goon.setup.channelRequired' : null),
  summary: (value, t) => (value.enabled ? t('goon.setup.summaryOn') : t('goon.setup.summaryOff')),
  Component: GoonSetup,
});
