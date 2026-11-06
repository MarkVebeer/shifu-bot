/**
 * Leveling feature: dashboard page with the member manager and the settings as two tabs.
 */
import { useSearchParams } from 'react-router';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useGuild } from '../../apps/web/src/lib/guild';
import { errorText, useI18n } from '../../apps/web/src/lib/i18n';
import { useApi } from '../../apps/web/src/lib/use-api';
import { Alert, Badge, PageHeader, Skeleton } from '../../apps/web/src/ui/primitives';
import { MemberManager } from './member-manager';
import type { LevelingResponse } from './server';
import { SettingsView } from './settings-view';

const TABS = ['members', 'settings'] as const;
type Tab = (typeof TABS)[number];

export default function LevelingPage() {
  const { t } = useI18n();
  const { guild } = useGuild();
  const leveling = useApi<LevelingResponse>(`/guilds/${guild.id}/features/leveling`);
  const [params, setParams] = useSearchParams();
  // A server that has not turned leveling on opens on the settings tab.
  const requested = params.get('tab');
  const tab: Tab = requested === 'members' || requested === 'settings' ? requested : leveling.data && !leveling.data.settings.enabled ? 'settings' : 'members';

  const selectTab = (next: Tab) =>
    setParams(
      (current) => {
        const copy = new URLSearchParams(current);
        copy.set('tab', next);
        return copy;
      },
      { replace: true },
    );

  return (
    <Tabs value={tab} onValueChange={(next) => selectTab(next as Tab)} className="animate-fade-up gap-0">
      <PageHeader
        title={t('leveling.name')}
        description={t('leveling.description')}
        badge={leveling.data && <Badge tone={leveling.data.settings.enabled ? 'success' : 'muted'}>{leveling.data.settings.enabled ? t('overview.active') : t('overview.inactive')}</Badge>}
        actions={
          <TabsList aria-label={t('leveling.name')} className="h-11">
            {TABS.map((item) => (
              <TabsTrigger key={item} value={item} className="px-5">
                {t(`leveling.tabs.${item}`)}
              </TabsTrigger>
            ))}
          </TabsList>
        }
      />

      {leveling.error ? (
        <Alert tone="danger">{errorText(t, leveling.error)}</Alert>
      ) : !leveling.data ? (
        <div className="space-y-3" aria-busy="true">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : (
        <TabsContent value={tab}>{tab === 'members' ? <MemberManager enabled={leveling.data.settings.enabled} /> : <SettingsView leveling={leveling} />}</TabsContent>
      )}
    </Tabs>
  );
}
