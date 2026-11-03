import type { Database } from 'bun:sqlite';
import type { FeatureManifest, Locale } from '@shifubot/shared';
import type { Awaitable, Client, ClientEvents, Guild, GuildMember } from 'discord.js';
import type { Hono } from 'hono';
import type { Config } from '../config';
import type { Migration } from '../db/database';
import type { Session } from '../http/session';
import type { Logger } from '../logger';
import type { GuildSettingsStore } from './guild-settings';
import type { SendQueue } from './send-queue';

/** Everything a feature can use at runtime. */
export interface AppContext {
  config: Config;
  logger: Logger;
  db: Database;
  client: Client;
  guildSettings: GuildSettingsStore;
  queue: SendQueue;
}

/** Variables available to routes under /api/guilds/:guildId. Permission checks already ran. */
export interface GuildRouteEnv {
  Variables: {
    requestId: string;
    session: Session;
    guild: Guild;
    member: GuildMember;
    locale: Locale;
  };
}

export type FeatureEvents = {
  [E in keyof ClientEvents]?: (...args: ClientEvents[E]) => Awaitable<void>;
};

export interface FeatureInstance {
  /** Discord gateway events, wired up once for the whole client. */
  events?: FeatureEvents;
  /** Routes mounted at /api/guilds/:guildId/features/<id>. */
  routes?: (router: Hono<GuildRouteEnv>) => void;
  /** Shown on the guild overview page. */
  isEnabled?: (guildId: string) => boolean;
  /** Called when the bot joins a server, after core defaults exist. */
  onGuildCreate?: (guild: Guild) => Awaitable<void>;
}

export interface ServerFeature {
  manifest: FeatureManifest;
  /** SQL migrations. Ids must start with the feature id. */
  migrations: Migration[];
  /** Tables with a guild_id column. Rows are deleted when the bot left a server long ago. */
  tables: string[];
  setup(ctx: AppContext): FeatureInstance;
}

export function defineServerFeature(feature: ServerFeature): ServerFeature {
  for (const migration of feature.migrations) {
    if (!migration.id.startsWith(`${feature.manifest.id}_`)) {
      throw new Error(`Migration "${migration.id}" must start with "${feature.manifest.id}_"`);
    }
  }
  return feature;
}
