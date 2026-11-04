/**
 * Leveling feature: its part of the first run setup and the Settings tab.
 * Only the essentials are asked here; messages and the ignore list stay on the Leveling page.
 */
import { api } from '../../apps/web/src/lib/api';
import { useT } from '../../apps/web/src/lib/i18n';
import { defineSetupSection, type SetupSectionProps } from '../../apps/web/src/lib/setup';
import { ChannelPicker } from '../../apps/web/src/ui/channel-picker';
import { Switch } from '../../apps/web/src/ui/primitives';
import { levelingManifest, type LevelingSettings } from './manifest';
import type { LevelingResponse } from './server';
import { XpSourcePicker } from './xp-source-picker';

function LevelingSetup({ value, onChange }: SetupSectionProps<LevelingSettings>) {
  const t = useT();
  return (
    <div className="space-y-5">
      <Switch
        checked={value.enabled}
        onChange={(enabled) => onChange({ ...value, enabled })}
        label={t('leveling.form.enabled')}
        description={t('leveling.form.enabledHelp')}
      />
      {value.enabled && (
        <div className="animate-fade-in space-y-5">
          <XpSourcePicker value={value.xpSources} onChange={(xpSources) => onChange({ ...value, xpSources })} />
          <div className="space-y-2">
            <ChannelPicker
              id="setup-leveling-leaderboard"
              label={t('leveling.form.leaderboardChannel')}
              value={value.leaderboardChannelId}
              onChange={(leaderboardChannelId) => onChange({ ...value, leaderboardChannelId })}
            />
            <p className="text-sm text-muted">{t('leveling.form.leaderboardHelp')}</p>
          </div>
        </div>
      )}
    </div>
  );
}

export default defineSetupSection<LevelingSettings>({
  id: levelingManifest.id,
  emoji: levelingManifest.emoji,
  title: 'leveling.setup.title',
  description: 'leveling.setup.description',
  load: async (guild) => (await api<LevelingResponse>(`/guilds/${guild.id}/features/leveling`)).settings,
  save: async (guild, value) => {
    await api(`/guilds/${guild.id}/features/leveling`, { method: 'PUT', body: value });
  },
  summary: (value, t) =>
    value.enabled ? `${t('leveling.setup.summaryOn')} · ${t(`leveling.form.sourceOptions.${value.xpSources}`)}` : t('leveling.setup.summaryOff'),
  Component: LevelingSetup,
});
