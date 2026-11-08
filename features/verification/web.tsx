/**
 * Verification feature: dashboard page with the verified members and the settings as two tabs.
 */
import { useSearchParams } from 'react-router';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useGuild } from '../../apps/web/src/lib/guild';
import { errorText, useI18n } from '../../apps/web/src/lib/i18n';
import { useApi } from '../../apps/web/src/lib/use-api';
import { Alert, Badge, PageHeader, Skeleton } from '../../apps/web/src/ui/primitives';
import type { VerificationResponse } from './server';
import { SettingsView } from './settings-view';
import { VerifiedMembers } from './verified-members';

const TABS = ['members', 'settings'] as const;
type Tab = (typeof TABS)[number];

export default function VerificationPage() {
  const { t } = useI18n();
  const { guild } = useGuild();
  const verification = useApi<VerificationResponse>(`/guilds/${guild.id}/features/verification`);
  const [params, setParams] = useSearchParams();
  // A server that has not turned verification on opens on the settings tab.
  const requested = params.get('tab');
  const tab: Tab = requested === 'members' || requested === 'settings' ? requested : verification.data && !verification.data.settings.enabled ? 'settings' : 'members';

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
        title={t('verification.name')}
        description={t('verification.description')}
        badge={verification.data && <Badge tone={verification.data.settings.enabled ? 'success' : 'muted'}>{verification.data.settings.enabled ? t('overview.active') : t('overview.inactive')}</Badge>}
        actions={
          <TabsList aria-label={t('verification.name')} className="h-11">
            {TABS.map((item) => (
              <TabsTrigger key={item} value={item} className="px-5">
                {t(`verification.tabs.${item}`)}
              </TabsTrigger>
            ))}
          </TabsList>
        }
      />

      {verification.error ? (
        <Alert tone="danger">{errorText(t, verification.error)}</Alert>
      ) : !verification.data ? (
        <div className="space-y-3" aria-busy="true">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : (
        <TabsContent value={tab}>
          {tab === 'members' ? <VerifiedMembers roleProblem={verification.data.status.roleProblem} onChanged={() => void verification.reload()} /> : <SettingsView verification={verification} />}
        </TabsContent>
      )}
    </Tabs>
  );
}
