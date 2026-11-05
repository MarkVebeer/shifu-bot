/**
 * Member pages: read-only routes every member of a server can use, such as the
 * full counter lists and the leveling leaderboard. Mounted at /api/servers.
 *
 * - GET /:guildId: the server and the member pages enabled there (the tabs on the page).
 * - /:guildId/<featureId>/...: the feature's memberRoutes.
 *
 * The user must be signed in and a member of the server, and the feature must
 * be enabled there. Unknown servers and disabled features answer 404, so the
 * routes cannot be used to find out which servers use ShifuBot.
 */
import { snowflake, type MemberPagesResponse } from '@shifubot/shared';
import { DiscordAPIError, type Guild } from 'discord.js';
import { Hono, type Context } from 'hono';
import type { AppContext, FeatureInstance, MemberRouteEnv, ServerFeature } from '../core/feature';
import { LruCache } from '../core/lru-cache';
import { ApiError, parseInput } from './errors';
import { csrfProtection, requireSession } from './middleware';
import type { SessionStore } from './session';

/** How long a membership check (yes or no) is trusted. */
const MEMBERSHIP_TTL_MS = 5 * 60_000;

const notFound = () => new ApiError(404, 'not_found', 'This page does not exist');

export function memberRoutes(
  ctx: AppContext,
  sessions: SessionStore,
  features: { feature: ServerFeature; instance: FeatureInstance }[],
) {
  const { client, config } = ctx;
  const membership = new LruCache<string, boolean>(20_000, MEMBERSHIP_TTL_MS);
  const withPages = features.filter(({ instance }) => instance.memberRoutes);
  const app = new Hono<MemberRouteEnv>();

  async function isMember(guild: Guild, userId: string): Promise<boolean> {
    const key = `${guild.id}:${userId}`;
    const cached = membership.get(key);
    if (cached !== undefined) return cached;
    let member = true;
    try {
      await guild.members.fetch({ user: userId, cache: false });
    } catch (error) {
      if (!(error instanceof DiscordAPIError && error.code === 10007)) throw error;
      member = false;
    }
    membership.set(key, member);
    return member;
  }

  /** Member page ids enabled on a server, in registry order. */
  const enabledPages = (guildId: string) =>
    withPages.filter(({ instance }) => instance.isEnabled?.(guildId) ?? true).map(({ feature }) => feature.manifest.id);

  /** The checks every member route shares. Returns the guild, or throws. */
  async function guard(c: Context<MemberRouteEnv>, featureId: string | null): Promise<Guild> {
    const guildId = parseInput(snowflake, c.req.param('guildId'), 'Server id');
    if (!client.isReady()) throw new ApiError(503, 'bot_offline', 'The bot is not connected to Discord right now');
    const guild = client.guilds.cache.get(guildId);
    const pages = guild ? enabledPages(guild.id) : [];
    if (!guild || (featureId ? !pages.includes(featureId) : pages.length === 0)) throw notFound();
    if (!(await isMember(guild, c.get('session').userId))) {
      throw new ApiError(403, 'not_member', 'Only members of this server can see this page');
    }
    c.set('guild', guild);
    c.header('Cache-Control', 'no-store');
    return guild;
  }

  app.use('*', requireSession(sessions), csrfProtection(config));

  app.get('/:guildId', async (c) => {
    const guild = await guard(c, null);
    const body: MemberPagesResponse = {
      server: { id: guild.id, name: guild.name, iconUrl: guild.iconURL({ size: 128 }) },
      pages: enabledPages(guild.id),
    };
    return c.json(body);
  });

  for (const { feature, instance } of withPages) {
    const id = feature.manifest.id;
    const router = new Hono<MemberRouteEnv>();
    router.use('*', async (c, next) => {
      await guard(c, id);
      await next();
    });
    instance.memberRoutes!(router);
    app.route(`/:guildId/${id}`, router);
  }

  return app;
}
