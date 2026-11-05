/**
 * Audit log feature: dashboard page with the log and its settings as two tabs.
 */
import { useSearchParams } from 'react-router';
import { useGuild } from '../../apps/web/src/lib/guild';
import { errorText, useI18n } from '../../apps/web/src/lib/i18n';
import { useApi } from '../../apps/web/src/lib/use-api';
import { Icon } from '../../apps/web/src/ui/icon';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, Badge, Skeleton, PageHeader } from '../../apps/web/src/ui/primitives';
import { LogView } from './log-view';
import type { AuditResponse } from './manifest';
import { SettingsView } from './settings-view';

const TABS = ['log', 'settings'] as const;
type Tab = (typeof TABS)[number];

export default function AuditPage() {
  const { t } = useI18n();
  const { guild } = useGuild();
  const audit = useApi<AuditResponse>(`/guilds/${guild.id}/features/audit`);
  const [params, setParams] = useSearchParams();
  // A server that never turned the log on opens on the settings tab.
  const requested = params.get('tab');
  const tab: Tab = requested === 'log' || requested === 'settings' ? requested : audit.data && !audit.data.settings.enabled && audit.data.stats.events === 0 ? 'settings' : 'log';

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
        title={t('audit.name')}
        description={t('audit.description')}
        badge={audit.data && <Badge tone={audit.data.settings.enabled ? 'success' : 'muted'}>{audit.data.settings.enabled ? t('overview.active') : t('overview.inactive')}</Badge>}
        actions={
          <TabsList aria-label={t('audit.name')} className="h-11">
            {TABS.map((item) => (
              <TabsTrigger key={item} value={item} className="px-5">
                {t(`audit.tabs.${item}`)}
              </TabsTrigger>
            ))}
          </TabsList>
        }
      />

      {audit.error ? (
        <Alert tone="danger">{errorText(t, audit.error)}</Alert>
      ) : !audit.data ? (
        <div className="space-y-3" aria-busy="true">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : (
        <TabsContent value={tab}>{tab === 'log' ? <LogView enabled={audit.data.settings.enabled} /> : <SettingsView audit={audit} />}</TabsContent>
      )}
    </Tabs>
  );
}
