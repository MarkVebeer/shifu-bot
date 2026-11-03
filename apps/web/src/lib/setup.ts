/**
 * Setup sections: the settings a server is asked for in the first run wizard,
 * and that can be changed later in the Settings tab. The core ships the
 * language section; a feature adds its own by creating features/<id>/setup.tsx.
 */
import type { EmojiName, GuildOverview } from '@shifubot/shared';
import type { ComponentType } from 'react';
import type { AppMessageKey } from '../../../../features';

export interface SetupSectionProps<T> {
  value: T;
  onChange: (value: T) => void;
  guild: GuildOverview;
}

export interface SetupSection<T = unknown> {
  /** Unique id, the feature id for feature sections. */
  id: string;
  emoji: EmojiName;
  title: AppMessageKey;
  description: AppMessageKey;
  /** Load the current values from the API. */
  load: (guild: GuildOverview) => Promise<T>;
  /** Persist the values. Called only when they changed. */
  save: (guild: GuildOverview, value: T) => Promise<void>;
  /** Returns a translation key describing the problem, or null when the value can be saved. */
  validate?: (value: T) => AppMessageKey | null;
  /** One line summary for the last wizard step. */
  summary: (value: T, t: (key: AppMessageKey, values?: Record<string, string | number>) => string) => string;
  Component: ComponentType<SetupSectionProps<T>>;
}

/** A section of any value type, for lists that mix sections. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnySetupSection = SetupSection<any>;

export function defineSetupSection<T>(section: SetupSection<T>): SetupSection<T> {
  return section;
}
