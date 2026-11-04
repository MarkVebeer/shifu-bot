import {
  guildSettingsSchema,
  type BotPermission,
  snowflake,
  type ChannelOption,
  type GuildListItem,
  type GuildOverview,
  type PermissionReport,
  type RoleOption,
} from '@shifubot/shared';
import { DiscordAPIError, PermissionFlagsBits, type GuildMember } from 'discord.js';
import { Hono } from 'hono';
import type { AppContext, FeatureInstance, GuildRouteEnv, ServerFeature } from '../core/feature';
import { LruCache } from '../core/lru-cache';
import { INVITE_PERMISSIONS, isPostableChannel, missingSendPermissions, roleProblem } from '../core/permissions';
import { fetchUserGuilds, guildIconUrl, type OAuthGuild } from './discord-oauth';
import { ApiError, parseInput, parseJsonBody } from './errors';
import { csrfProtection, requireSession } from './middleware';
import type { Session, SessionStore } from './session';

const MANAGE_GUILD = PermissionFlagsBits.ManageGuild;
const ADMINISTRATOR = PermissionFlagsBits.Administrator;

export function inviteUrl(clientId: string, guildId?: string, permissions = INVITE_PERMISSIONS): string {
  const params = new URLSearchParams({
    client_id: clientId,
    scope: 'bot applications.commands',
    permissions: permissions.toString(),
  });
  if (guildId) {
    params.set('guild_id', guildId);
    params.set('disable_guild_select', 'true');
  }
  return `https://discord.com/oauth2/authorize?${params}`;
}

function canManage(guild: OAuthGuild): boolean {
  const permissions = BigInt(guild.permissions);
  return guild.owner === true || (permissions & MANAGE_GUILD) === MANAGE_GUILD || (permissions & ADMINISTRATOR) === ADMINISTRATOR;
}

export function guildRoutes(
  ctx: AppContext,
  sessions: SessionStore,
  features: { feature: ServerFeature; instance: FeatureInstance }[],
) {
  const { client, guildSettings, logger, config } = ctx;
  const userGuildsCache = new LruCache<string, OAuthGuild[]>(2_000, 30_000);
  const memberCache = new LruCache<string, GuildMember>(2_000, 15_000);

  const app = new Hono<GuildRouteEnv>();
  app.use('*', requireSession(sessions), csrfProtection(config));

  const ensureBotReady = () => {
    if (!client.isReady()) throw new ApiError(503, 'bot_offline', 'The bot is not connected to Discord right now');
  };

  /** Servers the signed in user can manage, using their own OAuth token. */
  app.get('/', async (c) => {
    const session = c.get('session');
    const refresh = c.req.query('refresh') === '1';
    let guilds = refresh ? undefined : userGuildsCache.get(session.id);
    if (!guilds) {
      guilds = (await fetchUserGuilds(session.accessToken)).filter(canManage);
      userGuildsCache.set(session.id, guilds);
    }
    const items: GuildListItem[] = guilds
      .map((guild) => {
        const cached = client.guilds.cache.get(guild.id);
        return {
          id: guild.id,
          name: guild.name,
          iconUrl: guildIconUrl(guild),
          botPresent: Boolean(cached),
          inviteUrl: inviteUrl(config.discord.clientId, guild.id),
          memberCount: cached?.memberCount ?? null,
        };
      })
      .sort((a, b) => Number(b.botPresent) - Number(a.botPresent) || a.name.localeCompare(b.name));
    c.header('Cache-Control', 'no-store');
    return c.json({ guilds: items });
  });

  /**
   * Guard for every route below /:guildId. Re-checks Manage Server on each call
   * with a live lookup of the member (a single member, never the full list).
   */
  app.use('/:guildId/*', async (c, next) => {
    const guildId = parseInput(snowflake, c.req.param('guildId'), 'Server id');
    const session: Session = c.get('session');
    ensureBotReady();
    const guild = client.guilds.cache.get(guildId);
    if (!guild) throw new ApiError(404, 'bot_not_in_guild', 'ShifuBot is not in this server');

    const cacheKey = `${guildId}:${session.userId}`;
    let member = memberCache.get(cacheKey);
    if (!member) {
      try {
        member = await guild.members.fetch({ user: session.userId, cache: false });
      } catch (error) {
        if (error instanceof DiscordAPIError && error.code === 10007) {
          throw new ApiError(403, 'forbidden', 'You are not a member of this server');
        }
        throw error;
      }
      memberCache.set(cacheKey, member);
    }
    if (guild.ownerId !== member.id && !member.permissions.has(MANAGE_GUILD)) {
      throw new ApiError(403, 'forbidden', 'You need the Manage Server permission in this server');
    }
    c.set('guild', guild);
    c.set('member', member);
    c.set('locale', guildSettings.locale(guildId));
    await next();
  });

  app.get('/:guildId/overview', (c) => {
    const guild = c.get('guild');
    const me = client.user!;
    const body: GuildOverview = {
      id: guild.id,
      name: guild.name,
      iconUrl: guild.iconURL({ size: 128, extension: 'png' }),
      memberCount: guild.memberCount,
      locale: c.get('locale'),
      setupCompleted: guildSettings.isSetupCompleted(guild.id),
      bot: { id: me.id, username: me.username, avatarUrl: me.displayAvatarURL({ size: 128, extension: 'png' }) },
      features: features.map(({ feature, instance }) => ({
        id: feature.manifest.id,
        enabled: instance.isEnabled?.(guild.id) ?? false,
      })),
    };
    return c.json(body);
  });

  app.put('/:guildId/settings', async (c) => {
    const guild = c.get('guild');
    const input = await parseJsonBody(c.req.raw, guildSettingsSchema);
    const saved = guildSettings.save(guild.id, input);
    logger.info('Server settings saved', { guildId: guild.id, userId: c.get('session').userId, locale: saved.locale });
    return c.json({ settings: saved });
  });

  /** Called by the dashboard when the first run setup wizard finishes. */
  app.post('/:guildId/setup/complete', (c) => {
    const guild = c.get('guild');
    guildSettings.completeSetup(guild.id);
    logger.info('Server setup completed', { guildId: guild.id, userId: c.get('session').userId });
    return c.json({ setupCompleted: true });
  });

  app.get('/:guildId/channels', (c) => {
    const guild = c.get('guild');
    const channels: ChannelOption[] = guild.channels.cache
      .filter(isPostableChannel)
      .sort((a, b) => a.rawPosition - b.rawPosition)
      .map((channel) => ({
        id: channel.id,
        name: channel.name,
        parentName: channel.parent?.name ?? null,
        canSend: missingSendPermissions(guild, channel).length === 0,
      }));
    return c.json({ channels });
  });

  /**
   * What ShifuBot is missing for the features that are turned on: server wide
   * permissions (fixable with the re-authorize link) and channel or role problems
   * reported by the features (fixable only in Discord's settings).
   */
  app.get('/:guildId/permissions', (c) => {
    const guild = c.get('guild');
    const me = guild.members.me;
    const enabled = features.filter(({ instance }) => instance.isEnabled?.(guild.id));

    const neededBy = new Map<BotPermission, string[]>();
    for (const { feature, instance } of enabled) {
      for (const permission of instance.requiredPermissions?.(guild.id) ?? feature.permissions) {
        neededBy.set(permission, [...(neededBy.get(permission) ?? []), feature.manifest.id]);
      }
    }
    const missing = [...neededBy]
      .filter(([permission]) => !me?.permissions.has(PermissionFlagsBits[permission]))
      .map(([permission, ids]) => ({ permission, features: ids }));
    const missingSet = new Set(missing.map((item) => item.permission));

    const issues = enabled
      .flatMap(({ feature, instance }) => (instance.health?.(guild) ?? []).map((issue) => ({ feature: feature.manifest.id, ...issue })))
      // A server wide gap already explains these; listing them twice would only confuse.
      .map((issue) => (issue.permissions ? { ...issue, permissions: issue.permissions.filter((p) => !missingSet.has(p)) } : issue))
      .filter((issue) => !(issue.code === 'missing_permissions' && issue.permissions?.length === 0))
      .filter((issue) => !(issue.code === 'no_manage_roles' && missingSet.has('ManageRoles')));

    const body: PermissionReport = {
      ok: missing.length === 0 && issues.length === 0,
      missing,
      issues,
      // The usual invite permissions plus optional ones the current settings need (e.g. Ban Members).
      grantUrl: inviteUrl(
        config.discord.clientId,
        guild.id,
        [...neededBy.keys()].reduce((bits, permission) => bits | PermissionFlagsBits[permission], INVITE_PERMISSIONS),
      ),
    };
    c.header('Cache-Control', 'no-store');
    return c.json(body);
  });

  /** Roles from highest to lowest, without @everyone. */
  app.get('/:guildId/roles', (c) => {
    const guild = c.get('guild');
    const roles: RoleOption[] = guild.roles.cache
      .filter((role) => role.id !== guild.id)
      .sort((a, b) => b.comparePositionTo(a))
      .map((role) => ({
        id: role.id,
        name: role.name,
        color: role.color ? role.hexColor.toUpperCase() : null,
        assignable: roleProblem(guild, role) === null,
      }));
    return c.json({ roles });
  });

  for (const { feature, instance } of features) {
    if (!instance.routes) continue;
    const router = new Hono<GuildRouteEnv>();
    instance.routes(router);
    app.route(`/:guildId/features/${feature.manifest.id}`, router);
  }

  return app;
}
