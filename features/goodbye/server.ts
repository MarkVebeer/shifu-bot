/**
 * Goodbye feature: bot side. Event handler, database table and API routes.
 */
import type { Database } from 'bun:sqlite';
import { DiscordAPIError, Events, type Guild, type GuildMember, type PartialGuildMember } from 'discord.js';
import { defineServerFeature, type AppContext } from '../../apps/bot/src/core/feature';
import { LruCache } from '../../apps/bot/src/core/lru-cache';
import { isPostableChannel, missingSendPermissions } from '../../apps/bot/src/core/permissions';
import { WindowLimiter } from '../../apps/bot/src/core/send-queue';
import { ApiError, parseJsonBody } from '../../apps/bot/src/http/errors';
import {
  buildGoodbyeMessage,
  defaultGoodbyeSettings,
  goodbyeManifest,
  goodbyeSettingsSchema,
  type GoodbyeSettings,
} from './manifest';

export type GoodbyeErrorCode = 'no_channel' | 'channel_missing' | 'missing_permissions' | 'send_failed';

export interface GoodbyeStatus {
  channelExists: boolean;
  missingPermissions: string[];
  lastError: { code: GoodbyeErrorCode; at: number } | null;
}

export interface GoodbyeResponse {
  settings: GoodbyeSettings;
  status: GoodbyeStatus;
  maxPerMinute: number;
}

interface GoodbyeRow {
  guild_id: string;
  enabled: number;
  channel_id: string | null;
  title: string;
  description: string;
  color: string | null;
  show_avatar: number;
  banner_url: string | null;
  footer: string;
  last_error: string | null;
  last_error_at: number | null;
}

class GoodbyeStore {
  private readonly cache = new LruCache<string, GoodbyeSettings>(10_000);

  constructor(private readonly db: Database) {}

  get(guildId: string): GoodbyeSettings {
    const cached = this.cache.get(guildId);
    if (cached) return cached;
    const row = this.row(guildId);
    const settings: GoodbyeSettings = row
      ? {
          enabled: row.enabled === 1,
          channelId: row.channel_id,
          title: row.title,
          description: row.description,
          color: row.color,
          showAvatar: row.show_avatar === 1,
          bannerUrl: row.banner_url,
          footer: row.footer,
        }
      : defaultGoodbyeSettings;
    this.cache.set(guildId, settings);
    return settings;
  }

  save(guildId: string, s: GoodbyeSettings): void {
    this.db
      .query(
        `INSERT INTO goodbye_settings
           (guild_id, enabled, channel_id, title, description, color, show_avatar, banner_url, footer, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (guild_id) DO UPDATE SET
           enabled = excluded.enabled, channel_id = excluded.channel_id, title = excluded.title,
           description = excluded.description, color = excluded.color, show_avatar = excluded.show_avatar,
           banner_url = excluded.banner_url, footer = excluded.footer,
           updated_at = excluded.updated_at, last_error = NULL, last_error_at = NULL`,
      )
      .run(
        guildId,
        Number(s.enabled),
        s.channelId,
        s.title,
        s.description,
        s.color,
        Number(s.showAvatar),
        s.bannerUrl,
        s.footer,
        Date.now(),
      );
    this.cache.delete(guildId);
  }

  ensureDefaults(guildId: string): void {
    this.db
      .query('INSERT OR IGNORE INTO goodbye_settings (guild_id, updated_at) VALUES (?, ?)')
      .run(guildId, Date.now());
    this.cache.delete(guildId);
  }

  setError(guildId: string, code: GoodbyeErrorCode | null): void {
    this.db
      .query('UPDATE goodbye_settings SET last_error = ?, last_error_at = ? WHERE guild_id = ?')
      .run(code, code ? Date.now() : null, guildId);
  }

  lastError(guildId: string): GoodbyeStatus['lastError'] {
    const row = this.row(guildId);
    return row?.last_error && row.last_error_at
      ? { code: row.last_error as GoodbyeErrorCode, at: row.last_error_at }
      : null;
  }

  private row(guildId: string) {
    return this.db.query<GoodbyeRow, [string]>('SELECT * FROM goodbye_settings WHERE guild_id = ?').get(guildId);
  }
}

/** Works for partial members too: the leave event carries the user, which is all we need. */
function memberContext(member: GuildMember | PartialGuildMember) {
  return {
    id: member.id,
    username: member.user.username,
    displayName: member.nickname ?? member.user.displayName,
    avatarUrl: member.displayAvatarURL({ size: 256, extension: 'png' }),
  };
}

export default defineServerFeature({
  manifest: goodbyeManifest,
  tables: ['goodbye_settings'],
  migrations: [
    {
      id: 'goodbye_001_settings',
      sql: `
        CREATE TABLE goodbye_settings (
          guild_id TEXT PRIMARY KEY,
          enabled INTEGER NOT NULL DEFAULT 0,
          channel_id TEXT,
          title TEXT NOT NULL DEFAULT '',
          description TEXT NOT NULL DEFAULT '',
          color TEXT,
          show_avatar INTEGER NOT NULL DEFAULT 1,
          banner_url TEXT,
          footer TEXT NOT NULL DEFAULT '',
          last_error TEXT,
          last_error_at INTEGER,
          updated_at INTEGER NOT NULL
        );
        CREATE INDEX idx_goodbye_settings_enabled ON goodbye_settings (guild_id) WHERE enabled = 1;
      `,
    },
  ],

  setup(ctx: AppContext) {
    const { db, logger, queue, guildSettings, config } = ctx;
    const store = new GoodbyeStore(db);
    const limiter = new WindowLimiter(config.goodbyeMaxPerMinute);

    /** Check the target channel. Returns an error code or the channel when the bot can post. */
    function resolveChannel(guild: Guild, channelId: string | null) {
      if (!channelId) return { ok: false as const, error: 'no_channel' as const, missing: [] };
      const channel = guild.channels.cache.get(channelId);
      if (!isPostableChannel(channel)) return { ok: false as const, error: 'channel_missing' as const, missing: [] };
      const missing = missingSendPermissions(guild, channel);
      if (missing.length) return { ok: false as const, error: 'missing_permissions' as const, missing };
      return { ok: true as const, channel };
    }

    async function deliver(guild: Guild, member: GuildMember | PartialGuildMember, settings: GoodbyeSettings) {
      const target = resolveChannel(guild, settings.channelId);
      if (!target.ok) {
        logger.warn('Cannot send goodbye message', {
          guildId: guild.id,
          channelId: settings.channelId,
          reason: target.error,
          missing: target.missing,
        });
        store.setError(guild.id, target.error);
        throw new ApiError(409, target.error, `Cannot send: ${target.error.replace('_', ' ')}`);
      }
      const payload = buildGoodbyeMessage(settings, {
        locale: guildSettings.locale(guild.id),
        member: memberContext(member),
        server: { name: guild.name, memberCount: guild.memberCount },
      });
      try {
        await queue.run(`goodbye:${guild.id}`, () => target.channel.send(payload));
        return target.channel;
      } catch (error) {
        const code: GoodbyeErrorCode =
          error instanceof DiscordAPIError && (error.code === 50013 || error.code === 50001)
            ? 'missing_permissions'
            : error instanceof DiscordAPIError && error.code === 10003
              ? 'channel_missing'
              : 'send_failed';
        logger.warn('Goodbye message failed', { guildId: guild.id, channelId: target.channel.id, code, error });
        store.setError(guild.id, code);
        throw new ApiError(409, code, error instanceof Error ? error.message : 'Discord rejected the message');
      }
    }

    function status(guild: Guild, settings: GoodbyeSettings): GoodbyeStatus {
      const channel = settings.channelId ? guild.channels.cache.get(settings.channelId) : undefined;
      const postable = isPostableChannel(channel) ? channel : null;
      return {
        channelExists: Boolean(postable),
        missingPermissions: postable ? missingSendPermissions(guild, postable) : [],
        lastError: store.lastError(guild.id),
      };
    }

    const response = (guild: Guild, settings: GoodbyeSettings): GoodbyeResponse => ({
      settings,
      status: status(guild, settings),
      maxPerMinute: config.goodbyeMaxPerMinute,
    });

    return {
      isEnabled: (guildId) => store.get(guildId).enabled,

      onGuildCreate: (guild) => store.ensureDefaults(guild.id),

      events: {
        [Events.GuildMemberRemove]: (member: GuildMember | PartialGuildMember) => {
          // The bot itself leaving (kick, ban) also fires this; the server is gone for us then.
          if (member.user.bot || !member.guild.available) return;
          const settings = store.get(member.guild.id);
          if (!settings.enabled) return;
          if (!limiter.tryTake(member.guild.id)) {
            logger.warn('Goodbye cap reached, skipping message', {
              guildId: member.guild.id,
              maxPerMinute: config.goodbyeMaxPerMinute,
            });
            return;
          }
          deliver(member.guild, member, settings).catch(() => {
            // Already logged and stored for the dashboard warning.
          });
        },
      },

      routes(router) {
        router.get('/', (c) => {
          const guild = c.get('guild');
          return c.json(response(guild, store.get(guild.id)));
        });

        router.put('/', async (c) => {
          const guild = c.get('guild');
          const settings = await parseJsonBody(c.req.raw, goodbyeSettingsSchema);
          store.save(guild.id, settings);
          logger.info('Goodbye settings saved', { guildId: guild.id, userId: c.get('session').userId });
          return c.json(response(guild, store.get(guild.id)));
        });

        const testLimiter = new WindowLimiter(5, 60_000);
        router.post('/test', async (c) => {
          const guild = c.get('guild');
          if (!testLimiter.tryTake(guild.id)) {
            throw new ApiError(429, 'rate_limited', 'You can send at most 5 test messages per minute');
          }
          const settings = await parseJsonBody(c.req.raw, goodbyeSettingsSchema);
          const channel = await deliver(guild, c.get('member'), settings);
          store.setError(guild.id, null);
          return c.json({ ok: true, channel: { id: channel.id, name: channel.name } });
        });
      },
    };
  },
});
