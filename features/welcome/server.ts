/**
 * Welcome feature: bot side. Event handler, database table and API routes.
 */
import type { Database } from 'bun:sqlite';
import { DiscordAPIError, Events, type Guild, type GuildMember } from 'discord.js';
import { defineServerFeature, type AppContext } from '../../apps/bot/src/core/feature';
import { LruCache } from '../../apps/bot/src/core/lru-cache';
import { isPostableChannel, missingSendPermissions } from '../../apps/bot/src/core/permissions';
import { WindowLimiter } from '../../apps/bot/src/core/send-queue';
import { ApiError, parseJsonBody } from '../../apps/bot/src/http/errors';
import {
  buildWelcomeMessage,
  defaultWelcomeSettings,
  welcomeManifest,
  welcomeSettingsSchema,
  type WelcomeSettings,
} from './manifest';

export type WelcomeErrorCode = 'no_channel' | 'channel_missing' | 'missing_permissions' | 'send_failed';

export interface WelcomeStatus {
  channelExists: boolean;
  missingPermissions: string[];
  lastError: { code: WelcomeErrorCode; at: number } | null;
}

export interface WelcomeResponse {
  settings: WelcomeSettings;
  status: WelcomeStatus;
  maxPerMinute: number;
}

interface WelcomeRow {
  guild_id: string;
  enabled: number;
  channel_id: string | null;
  title: string;
  description: string;
  color: string | null;
  show_avatar: number;
  banner_url: string | null;
  footer: string;
  mention_user: number;
  last_error: string | null;
  last_error_at: number | null;
}

class WelcomeStore {
  private readonly cache = new LruCache<string, WelcomeSettings>(10_000);

  constructor(private readonly db: Database) {}

  get(guildId: string): WelcomeSettings {
    const cached = this.cache.get(guildId);
    if (cached) return cached;
    const row = this.row(guildId);
    const settings: WelcomeSettings = row
      ? {
          enabled: row.enabled === 1,
          channelId: row.channel_id,
          title: row.title,
          description: row.description,
          color: row.color,
          showAvatar: row.show_avatar === 1,
          bannerUrl: row.banner_url,
          footer: row.footer,
          mentionUser: row.mention_user === 1,
        }
      : defaultWelcomeSettings;
    this.cache.set(guildId, settings);
    return settings;
  }

  save(guildId: string, s: WelcomeSettings): void {
    this.db
      .query(
        `INSERT INTO welcome_settings
           (guild_id, enabled, channel_id, title, description, color, show_avatar, banner_url, footer, mention_user, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (guild_id) DO UPDATE SET
           enabled = excluded.enabled, channel_id = excluded.channel_id, title = excluded.title,
           description = excluded.description, color = excluded.color, show_avatar = excluded.show_avatar,
           banner_url = excluded.banner_url, footer = excluded.footer, mention_user = excluded.mention_user,
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
        Number(s.mentionUser),
        Date.now(),
      );
    this.cache.delete(guildId);
  }

  ensureDefaults(guildId: string): void {
    this.db
      .query('INSERT OR IGNORE INTO welcome_settings (guild_id, updated_at) VALUES (?, ?)')
      .run(guildId, Date.now());
    this.cache.delete(guildId);
  }

  setError(guildId: string, code: WelcomeErrorCode | null): void {
    this.db
      .query('UPDATE welcome_settings SET last_error = ?, last_error_at = ? WHERE guild_id = ?')
      .run(code, code ? Date.now() : null, guildId);
  }

  lastError(guildId: string): WelcomeStatus['lastError'] {
    const row = this.row(guildId);
    return row?.last_error && row.last_error_at
      ? { code: row.last_error as WelcomeErrorCode, at: row.last_error_at }
      : null;
  }

  private row(guildId: string) {
    return this.db.query<WelcomeRow, [string]>('SELECT * FROM welcome_settings WHERE guild_id = ?').get(guildId);
  }
}

function memberContext(member: GuildMember) {
  return {
    id: member.id,
    username: member.user.username,
    displayName: member.displayName,
    avatarUrl: member.displayAvatarURL({ size: 256, extension: 'png' }),
  };
}

export default defineServerFeature({
  manifest: welcomeManifest,
  tables: ['welcome_settings'],
  migrations: [
    {
      id: 'welcome_001_settings',
      sql: `
        CREATE TABLE welcome_settings (
          guild_id TEXT PRIMARY KEY,
          enabled INTEGER NOT NULL DEFAULT 0,
          channel_id TEXT,
          title TEXT NOT NULL DEFAULT '',
          description TEXT NOT NULL DEFAULT '',
          color TEXT,
          show_avatar INTEGER NOT NULL DEFAULT 1,
          banner_url TEXT,
          footer TEXT NOT NULL DEFAULT '',
          mention_user INTEGER NOT NULL DEFAULT 1,
          last_error TEXT,
          last_error_at INTEGER,
          updated_at INTEGER NOT NULL
        );
        CREATE INDEX idx_welcome_settings_enabled ON welcome_settings (guild_id) WHERE enabled = 1;
      `,
    },
  ],

  setup(ctx: AppContext) {
    const { db, logger, queue, guildSettings, config } = ctx;
    const store = new WelcomeStore(db);
    const limiter = new WindowLimiter(config.welcomeMaxPerMinute);

    /** Check the target channel. Returns an error code or the channel when the bot can post. */
    function resolveChannel(guild: Guild, channelId: string | null) {
      if (!channelId) return { ok: false as const, error: 'no_channel' as const, missing: [] };
      const channel = guild.channels.cache.get(channelId);
      if (!isPostableChannel(channel)) return { ok: false as const, error: 'channel_missing' as const, missing: [] };
      const missing = missingSendPermissions(guild, channel);
      if (missing.length) return { ok: false as const, error: 'missing_permissions' as const, missing };
      return { ok: true as const, channel };
    }

    async function deliver(guild: Guild, member: GuildMember, settings: WelcomeSettings) {
      const target = resolveChannel(guild, settings.channelId);
      if (!target.ok) {
        logger.warn('Cannot send welcome message', {
          guildId: guild.id,
          channelId: settings.channelId,
          reason: target.error,
          missing: target.missing,
        });
        store.setError(guild.id, target.error);
        throw new ApiError(409, target.error, `Cannot send: ${target.error.replace('_', ' ')}`);
      }
      const payload = buildWelcomeMessage(settings, {
        locale: guildSettings.locale(guild.id),
        member: memberContext(member),
        server: { name: guild.name, memberCount: guild.memberCount },
      });
      try {
        await queue.run(`welcome:${guild.id}`, () => target.channel.send(payload));
        return target.channel;
      } catch (error) {
        const code: WelcomeErrorCode =
          error instanceof DiscordAPIError && (error.code === 50013 || error.code === 50001)
            ? 'missing_permissions'
            : error instanceof DiscordAPIError && error.code === 10003
              ? 'channel_missing'
              : 'send_failed';
        logger.warn('Welcome message failed', { guildId: guild.id, channelId: target.channel.id, code, error });
        store.setError(guild.id, code);
        throw new ApiError(409, code, error instanceof Error ? error.message : 'Discord rejected the message');
      }
    }

    function status(guild: Guild, settings: WelcomeSettings): WelcomeStatus {
      const channel = settings.channelId ? guild.channels.cache.get(settings.channelId) : undefined;
      const postable = isPostableChannel(channel) ? channel : null;
      return {
        channelExists: Boolean(postable),
        missingPermissions: postable ? missingSendPermissions(guild, postable) : [],
        lastError: store.lastError(guild.id),
      };
    }

    return {
      isEnabled: (guildId) => store.get(guildId).enabled,

      onGuildCreate: (guild) => store.ensureDefaults(guild.id),

      events: {
        [Events.GuildMemberAdd]: (member: GuildMember) => {
          if (member.user.bot) return;
          const settings = store.get(member.guild.id);
          if (!settings.enabled) return;
          if (!limiter.tryTake(member.guild.id)) {
            logger.warn('Welcome cap reached, skipping message', {
              guildId: member.guild.id,
              maxPerMinute: config.welcomeMaxPerMinute,
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
          const settings = store.get(guild.id);
          const body: WelcomeResponse = {
            settings,
            status: status(guild, settings),
            maxPerMinute: config.welcomeMaxPerMinute,
          };
          return c.json(body);
        });

        router.put('/', async (c) => {
          const guild = c.get('guild');
          const settings = await parseJsonBody(c.req.raw, welcomeSettingsSchema);
          store.save(guild.id, settings);
          logger.info('Welcome settings saved', { guildId: guild.id, userId: c.get('session').userId });
          const saved = store.get(guild.id);
          const body: WelcomeResponse = {
            settings: saved,
            status: status(guild, saved),
            maxPerMinute: config.welcomeMaxPerMinute,
          };
          return c.json(body);
        });

        const testLimiter = new WindowLimiter(5, 60_000);
        router.post('/test', async (c) => {
          const guild = c.get('guild');
          if (!testLimiter.tryTake(guild.id)) {
            throw new ApiError(429, 'rate_limited', 'You can send at most 5 test messages per minute');
          }
          const settings = await parseJsonBody(c.req.raw, welcomeSettingsSchema);
          const channel = await deliver(guild, c.get('member'), settings);
          store.setError(guild.id, null);
          return c.json({ ok: true, channel: { id: channel.id, name: channel.name } });
        });
      },
    };
  },
});
