import type { Locale } from './i18n';

/** Shapes returned by the HTTP API, shared by server and dashboard. */

export type ApiErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'validation'
  | 'csrf'
  | 'rate_limited'
  | 'bot_not_in_guild'
  | 'bot_offline'
  | 'internal';

export interface ApiErrorBody {
  error: { code: ApiErrorCode | (string & {}); message: string; details?: unknown };
}

export interface MeResponse {
  user: { id: string; username: string; globalName: string | null; avatarUrl: string };
  csrfToken: string;
}

export interface GuildListItem {
  id: string;
  name: string;
  iconUrl: string | null;
  botPresent: boolean;
  inviteUrl: string;
  memberCount: number | null;
}

export interface GuildOverview {
  id: string;
  name: string;
  iconUrl: string | null;
  memberCount: number;
  locale: Locale;
  /** False until an admin finished the first run setup wizard. */
  setupCompleted: boolean;
  bot:{ id: string; username: string; avatarUrl: string };
  features: { id: string; enabled: boolean }[];
}

export type ChannelKind = 'text' | 'voice' | 'category';

export interface ChannelOption {
  id: string;
  name: string;
  parentName: string | null;
  canSend: boolean;
  /** Only in the ?kind=all listing; the default listing has text channels only. */
  kind?: ChannelKind;
}

export interface RoleOption {
  id: string;
  name: string;
  /** Hex color, null for the default (no color). */
  color: string | null;
  /** True when ShifuBot can give this role: below its highest role, not managed, not @everyone. */
  assignable: boolean;
}

/** Server permissions a ShifuBot feature can need, named like discord.js PermissionsString. */
export const BOT_PERMISSIONS = [
  'ViewChannel',
  'SendMessages',
  'EmbedLinks',
  'ManageRoles',
  'ModerateMembers',
  'KickMembers',
  'BanMembers',
  'ViewAuditLog',
  'ManageGuild',
] as const;
export type BotPermission = (typeof BOT_PERMISSIONS)[number];

/** A problem a feature found that blocks it, beyond the server wide permissions. */
export interface PermissionIssue {
  feature: string;
  /** Feature error code, shown as t(`<feature>.errors.<code>`). */
  code: string;
  channel?: { id: string; name: string };
  /** Permissions denied in that channel by a channel override. */
  permissions?: BotPermission[];
}

export interface PermissionReport {
  ok: boolean;
  /** Server wide permissions ShifuBot lacks, with the enabled features that need them. */
  missing: { permission: BotPermission; features: string[] }[];
  issues: PermissionIssue[];
  /** Re-authorize link for this server. Approving it gives ShifuBot's role the missing permissions. */
  grantUrl: string;
}

export interface ConfigResponse {
  clientId: string;
  defaultLocale: Locale;
  botReady: boolean;
}
