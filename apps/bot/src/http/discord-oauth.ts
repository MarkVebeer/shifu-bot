import { z } from 'zod';
import type { Config } from '../config';
import { ApiError } from './errors';

const API = 'https://discord.com/api/v10';

const tokenSchema = z.object({
  access_token: z.string(),
  token_type: z.string(),
  expires_in: z.number(),
  scope: z.string(),
});

const userSchema = z.object({
  id: z.string(),
  username: z.string(),
  global_name: z.string().nullable().optional(),
  avatar: z.string().nullable().optional(),
});

const guildSchema = z.object({
  id: z.string(),
  name: z.string(),
  icon: z.string().nullable(),
  owner: z.boolean().optional(),
  permissions: z.string(),
});

export type OAuthUser = z.infer<typeof userSchema>;
export type OAuthGuild = z.infer<typeof guildSchema>;

export const OAUTH_SCOPES = ['identify', 'guilds'] as const;

export function authorizeUrl(config: Config, state: string): string {
  const params = new URLSearchParams({
    client_id: config.discord.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    scope: OAUTH_SCOPES.join(' '),
    state,
    prompt: 'none',
  });
  return `https://discord.com/oauth2/authorize?${params}`;
}

async function discordFetch<T>(path: string, init: RequestInit, schema: z.ZodType<T>): Promise<T> {
  const response = await fetch(`${API}${path}`, { ...init, signal: AbortSignal.timeout(10_000) });
  if (response.status === 401) throw new ApiError(401, 'unauthorized', 'Discord rejected the login token');
  if (response.status === 429) throw new ApiError(429, 'rate_limited', 'Discord is rate limiting us, try again shortly');
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new ApiError(502, 'discord_error', `Discord returned ${response.status} for ${path}: ${text.slice(0, 200)}`);
  }
  return schema.parse(await response.json());
}

export function exchangeCode(config: Config, code: string) {
  return discordFetch(
    '/oauth2/token',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: config.discord.clientId,
        client_secret: config.discord.clientSecret,
        grant_type: 'authorization_code',
        code,
        redirect_uri: config.redirectUri,
      }),
    },
    tokenSchema,
  );
}

export function fetchUser(accessToken: string) {
  return discordFetch('/users/@me', { headers: { Authorization: `Bearer ${accessToken}` } }, userSchema);
}

export function fetchUserGuilds(accessToken: string) {
  return discordFetch('/users/@me/guilds', { headers: { Authorization: `Bearer ${accessToken}` } }, z.array(guildSchema));
}

export function revokeToken(config: Config, token: string) {
  return fetch(`${API}/oauth2/token/revoke`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.discord.clientId,
      client_secret: config.discord.clientSecret,
      token,
    }),
    signal: AbortSignal.timeout(5_000),
  }).catch(() => undefined);
}

export function userAvatarUrl(user: { id: string; avatar: string | null | undefined }): string {
  if (user.avatar) return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128`;
  const index = Number((BigInt(user.id) >> 22n) % 6n);
  return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
}

export function guildIconUrl(guild: { id: string; icon: string | null }): string | null {
  return guild.icon ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=128` : null;
}
