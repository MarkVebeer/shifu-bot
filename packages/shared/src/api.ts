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
  bot: { id: string; username: string; avatarUrl: string };
  features: { id: string; enabled: boolean }[];
}

export interface ChannelOption {
  id: string;
  name: string;
  parentName: string | null;
  canSend: boolean;
}

export interface ConfigResponse {
  clientId: string;
  defaultLocale: Locale;
  botReady: boolean;
}
