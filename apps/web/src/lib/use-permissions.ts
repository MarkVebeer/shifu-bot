import type { PermissionReport } from '@shifubot/shared';
import { useEffect } from 'react';
import { useApi } from './use-api';

/**
 * The bot's permission report for a server. Checks again whenever the tab gets
 * focus, so after granting permissions in Discord the dashboard updates by itself.
 */
export function usePermissionReport(guildId: string) {
  const state = useApi<PermissionReport>(`/guilds/${guildId}/permissions`);
  const { reload } = state;

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') void reload();
    };
    window.addEventListener('focus', onVisible);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('focus', onVisible);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [reload]);

  return state;
}
