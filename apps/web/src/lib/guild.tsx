import type { GuildOverview } from '@shifubot/shared';
import { createContext, useContext } from 'react';

export interface GuildContextValue {
  guild: GuildOverview;
  /** Reload the overview, e.g. after the server language changed. */
  reload: () => Promise<void>;
  /** Mark the current page as having unsaved changes (drives the leave warning). */
  setDirty: (dirty: boolean) => void;
}

export const GuildContext = createContext<GuildContextValue | null>(null);

/** Access the current server inside a dashboard page. */
export function useGuild(): GuildContextValue {
  const value = useContext(GuildContext);
  if (!value) throw new Error('useGuild must be used inside a server page');
  return value;
}
