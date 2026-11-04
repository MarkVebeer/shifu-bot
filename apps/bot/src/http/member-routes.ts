/**
 * Member pages: read-only routes every member of a server can use, such as the
 * full goon counter list. Mounted at /api/servers/:guildId/<featureId>.
 * The user must be signed in and a member of the server, and the feature must
 * be enabled there. Unknown servers and disabled features answer 404, so the
 * routes cannot be used to find out which servers use ShifuBot.
 */
import { snowflake } from '@shifubot/shared';
import { DiscordAPIError } from 'discord.js';
import { Hono } from 'hono';
import type { AppContext, FeatureInstance, MemberRouteEnv, ServerFeature } from '../core/feature';
import { LruCache } from '../core/lru-cache';
import { ApiError, parseInput } from './errors';
import { csrfProtection, requireSession } from './middleware';
import type { SessionStore } from './session';

/** How long a membership check (yes or no) is trusted. */
const MEMBERSHIP_TTL_MS = 5 * 60_000;

export function memberRoutes(
  ctx: AppContext,
  sessions: SessionStore,
  features: { feature: ServerFeature; instance: FeatureInstance }[],
) {
  const { client, config } = ctx;
  const membership = new LruCache<string, boolean>(20_000, MEMBERSHIP_TTL_MS);
  const app = new Hono<MemberRouteEnv>();

  async function isMember(guildId: string, userId: string): Promise<boolean> {
    const key = `${guildId}:${userId}`;
    const cached = membership.get(key);
    if (cached !== undefined) return cached;
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return false;
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

  for (const { feature, instance } of features) {
    if (!instance.memberRoutes) continue;
    const id = feature.manifest.id;
    const router = new Hono<MemberRouteEnv>();
    router.use('*', requireSession(sessions), csrfProtection(config), async (c, next) => {
      const guildId = parseInput(snowflake, c.req.param('guildId'), 'Server id');
      if (!client.isReady()) throw new ApiError(503, 'bot_offline', 'The bot is not connected to Discord right now');
      const guild = client.guilds.cache.get(guildId);
      if (!guild || !(instance.isEnabled?.(guildId) ?? true)) throw new ApiError(404, 'not_found', 'This page does not exist');
      if (!(await isMember(guildId, c.get('session').userId))) {
        throw new ApiError(403, 'not_member', 'Only members of this server can see this page');
      }
      c.set('guild', guild);
      c.header('Cache-Control', 'no-store');
      await next();
    });
    instance.memberRoutes(router);
    app.route(`/:guildId/${id}`, router);
  }

  return app;
}
