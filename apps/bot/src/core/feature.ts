import type { Database } from 'bun:sqlite';
import type { BotPermission, FeatureManifest, Locale, PermissionIssue } from '@shifubot/shared';
import type { Awaitable, Client, ClientEvents, Guild, GuildMember } from 'discord.js';
import type { Hono } from 'hono';
import type { Config } from '../config';
import type { Migration } from '../db/database';
import type { Session } from '../http/session';
import type { Logger } from '../logger';
import type { AuditSink } from './audit-sink';
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
  /** Report ShifuBot's own events to the audit log (a no-op until that feature attaches). */
  audit: AuditSink;
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

/**
 * Variables available to member routes under /api/servers/:guildId/<id>. The
 * user is signed in and a member of the server, and the feature is enabled.
 * There is no Manage Server check: these are pages for every member.
 */
export interface MemberRouteEnv {
  Variables: {
    requestId: string;
    session: Session;
    guild: Guild;
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
  /**
   * Read-only routes for every member of the server, mounted at /api/servers/:guildId/<id>.
   * The dashboard shows them on the member page features/<id>/public.tsx.
   */
  memberRoutes?: (router: Hono<MemberRouteEnv>) => void;
  /** Shown on the guild overview page. */
  isEnabled?: (guildId: string) => boolean;
  /** Called when the bot joins a server, after core defaults exist. */
  onGuildCreate?: (guild: Guild) => Awaitable<void>;
  /**
   * Channel and role problems that stop the feature from working, for the
   * dashboard permission check. Only called while the feature is enabled.
   */
  health?: (guild: Guild) => Omit<PermissionIssue, 'feature'>[];
  /** Permissions needed with the server's current settings. Defaults to ServerFeature.permissions. */
  requiredPermissions?: (guildId: string) => BotPermission[];
}

export interface ServerFeature {
  manifest: FeatureManifest;
  /**
   * Server wide permissions the feature always needs while enabled. Must be part of INVITE_PERMISSIONS.
   * Optional ones that depend on settings (e.g. Ban Members) come from FeatureInstance.requiredPermissions.
   */
  permissions: BotPermission[];
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
