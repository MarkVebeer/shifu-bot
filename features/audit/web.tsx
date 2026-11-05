/**
 * Audit log feature: dashboard page with the log and its settings as two tabs.
 */
import { useSearchParams } from 'react-router';
import { useGuild } from '../../apps/web/src/lib/guild';
import { errorText, useI18n } from '../../apps/web/src/lib/i18n';
import { useApi } from '../../apps/web/src/lib/use-api';
import { Icon } from '../../apps/web/src/ui/icon';
import { Alert, Badge, Skeleton, cx } from '../../apps/web/src/ui/primitives';
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
    <div className="animate-fade-up space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-3 text-2xl font-bold tracking-tight sm:text-3xl">
            <Icon name="log" size={26} className="mr-2 inline-block align-[-3px]" />
            {t('audit.name')}
            {audit.data && <Badge tone={audit.data.settings.enabled ? 'success' : 'muted'}>{audit.data.settings.enabled ? t('overview.active') : t('overview.inactive')}</Badge>}
          </h1>
          <p className="mt-2 max-w-2xl text-muted">{t('audit.description')}</p>
        </div>
        <div role="tablist" aria-label={t('audit.name')} className="inline-flex rounded-full border border-line bg-raised/50 p-1">
          {TABS.map((item) => (
            <button
              key={item}
              type="button"
              role="tab"
              id={`audit-tab-${item}`}
              aria-selected={tab === item}
              aria-controls={`audit-panel-${item}`}
              onClick={() => selectTab(item)}
              className={cx(
                'min-h-10 rounded-full px-5 text-sm font-semibold transition',
                tab === item ? 'bg-brand text-bg shadow-glow' : 'text-muted hover:text-ink',
              )}
            >
              {t(`audit.tabs.${item}`)}
            </button>
          ))}
        </div>
      </header>

      {audit.error ? (
        <Alert tone="danger">{errorText(t, audit.error)}</Alert>
      ) : !audit.data ? (
        <div className="space-y-3" aria-busy="true">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : (
        <div role="tabpanel" id={`audit-panel-${tab}`} aria-labelledby={`audit-tab-${tab}`}>
          {tab === 'log' ? <LogView enabled={audit.data.settings.enabled} /> : <SettingsView audit={audit} />}
        </div>
      )}
    </div>
  );
}
