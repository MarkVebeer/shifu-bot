/**
 * Leveling feature: bot side. Message and voice XP, level up announcements,
 * the leaderboard panel and its refresh scheduler, database and API routes.
 */
import type { Database } from 'bun:sqlite';
import type { BotPermission, PermissionIssue } from '@shifubot/shared';
import {
  Events,
  MessageFlags,
  type Guild,
  type GuildMember,
  type GuildTextBasedChannel,
  type Interaction,
  type Message,
  type PartialGuildMember,
} from 'discord.js';
import { defineServerFeature, type AppContext } from '../../apps/bot/src/core/feature';
import { LruCache } from '../../apps/bot/src/core/lru-cache';
import { syncPanelMessage, type PanelErrorCode, type PanelRef } from '../../apps/bot/src/core/panel';
import { isPostableChannel, missingSendPermissions } from '../../apps/bot/src/core/permissions';
import { WindowLimiter } from '../../apps/bot/src/core/send-queue';
import { ApiError, parseJsonBody } from '../../apps/bot/src/http/errors';
import {
  buildLeaderboardPanel,
  buildLevelUpMessage,
  buildRankMessage,
  defaultLevelingSettings,
  levelFromXp,
  levelingManifest,
  levelingSettingsSchema,
  RANK_BUTTON_ID,
  XP_RULES,
  type LeaderboardEntry,
  type LevelingSettings,
} from './manifest';
import { isIgnoredChannel, isVoiceEligible, messageXp } from './xp';

export type LevelingErrorCode = PanelErrorCode;

export interface ChannelStatus {
  exists: boolean;
  name: string | null;
  missingPermissions: string[];
}

export interface LevelingStatus {
  announceChannel: ChannelStatus | null;
  leaderboardChannel: ChannelStatus | null;
  panel: { channelId: string; channelName: string; url: string } | null;
  lastError: { code: LevelingErrorCode; at: number } | null;
}

export interface LevelingResponse {
  settings: LevelingSettings;
  status: LevelingStatus;
  /** Set by PUT when the settings were saved but the leaderboard could not be updated. */
  panelError?: LevelingErrorCode;
}

export interface TopMember {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  xp: number;
  level: number;
  messages: number;
  voiceMinutes: number;
}

export interface TopResponse {
  members: TopMember[];
}

interface SettingsRow {
  guild_id: string;
  enabled: number;
  ignored_channel_ids: string;
  announce_mode: string;
  announce_channel_id: string | null;
  title: string;
  description: string;
  color: string | null;
  mention_user: number;
  leaderboard_channel_id: string | null;
  leaderboard_interval: number;
  leaderboard_size: number;
  panel_channel_id: string | null;
  panel_message_id: string | null;
  last_error: string | null;
  last_error_at: number | null;
}

interface MemberRow {
  user_id: string;
  xp: number;
  messages: number;
  voice_minutes: number;
  display_name: string;
  avatar_url: string | null;
}

interface MemberSnapshot {
  id: string;
  displayName: string;
  avatarUrl: string;
}

/** Old and new total XP after an award, to spot level ups. */
interface Award {
  member: MemberSnapshot;
  before: number;
  after: number;
}

class LevelingStore {
  private readonly cache = new LruCache<string, LevelingSettings>(10_000);

  constructor(private readonly db: Database) {}

  get(guildId: string): LevelingSettings {
    const cached = this.cache.get(guildId);
    if (cached) return cached;
    const row = this.row(guildId);
    const parsed = row
      ? levelingSettingsSchema.safeParse({
          enabled: row.enabled === 1,
          ignoredChannelIds: JSON.parse(row.ignored_channel_ids) as unknown,
          announceMode: row.announce_mode,
          announceChannelId: row.announce_channel_id,
          title: row.title,
          description: row.description,
          color: row.color,
          mentionUser: row.mention_user === 1,
          leaderboardChannelId: row.leaderboard_channel_id,
          leaderboardInterval: row.leaderboard_interval,
          leaderboardSize: row.leaderboard_size,
        })
      : null;
    const settings = parsed?.success ? parsed.data : defaultLevelingSettings;
    this.cache.set(guildId, settings);
    return settings;
  }

  save(guildId: string, s: LevelingSettings): void {
    this.db
      .query(
        `INSERT INTO leveling_settings
           (guild_id, enabled, ignored_channel_ids, announce_mode, announce_channel_id, title, description, color,
            mention_user, leaderboard_channel_id, leaderboard_interval, leaderboard_size, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (guild_id) DO UPDATE SET
           enabled = excluded.enabled, ignored_channel_ids = excluded.ignored_channel_ids,
           announce_mode = excluded.announce_mode, announce_channel_id = excluded.announce_channel_id,
           title = excluded.title, description = excluded.description, color = excluded.color,
           mention_user = excluded.mention_user, leaderboard_channel_id = excluded.leaderboard_channel_id,
           leaderboard_interval = excluded.leaderboard_interval, leaderboard_size = excluded.leaderboard_size,
           updated_at = excluded.updated_at, last_error = NULL, last_error_at = NULL`,
      )
      .run(
        guildId,
        Number(s.enabled),
        JSON.stringify(s.ignoredChannelIds),
        s.announceMode,
        s.announceChannelId,
        s.title,
        s.description,
        s.color,
        Number(s.mentionUser),
        s.leaderboardChannelId,
        s.leaderboardInterval,
        s.leaderboardSize,
        Date.now(),
      );
    this.cache.delete(guildId);
  }

  ensureDefaults(guildId: string): void {
    this.db.query('INSERT OR IGNORE INTO leveling_settings (guild_id, updated_at) VALUES (?, ?)').run(guildId, Date.now());
    this.cache.delete(guildId);
  }

  enabledGuildIds(): string[] {
    return this.db
      .query<{ guild_id: string }, []>('SELECT guild_id FROM leveling_settings WHERE enabled = 1')
      .all()
      .map((row) => row.guild_id);
  }

  panel(guildId: string): PanelRef | null {
    const row = this.row(guildId);
    return row?.panel_channel_id && row.panel_message_id ? { channelId: row.panel_channel_id, messageId: row.panel_message_id } : null;
  }

  setPanel(guildId: string, panel: PanelRef | null): void {
    this.ensureDefaults(guildId);
    this.db
      .query('UPDATE leveling_settings SET panel_channel_id = ?, panel_message_id = ? WHERE guild_id = ?')
      .run(panel?.channelId ?? null, panel?.messageId ?? null, guildId);
  }

  setError(guildId: string, code: LevelingErrorCode | null): void {
    this.db
      .query('UPDATE leveling_settings SET last_error = ?, last_error_at = ? WHERE guild_id = ?')
      .run(code, code ? Date.now() : null, guildId);
  }

  lastError(guildId: string): LevelingStatus['lastError'] {
    const row = this.row(guildId);
    return row?.last_error && row.last_error_at ? { code: row.last_error as LevelingErrorCode, at: row.last_error_at } : null;
  }

  /** Adds XP and returns the totals before and after. Also refreshes the name and avatar snapshot. */
  addXp(guildId: string, member: MemberSnapshot, xp: number, source: 'message' | 'voice'): Award {
    const after = this.db
      .query<{ xp: number }, [string, string, number, number, number, string, string, number]>(
        `INSERT INTO leveling_members (guild_id, user_id, xp, messages, voice_minutes, display_name, avatar_url, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (guild_id, user_id) DO UPDATE SET
           xp = xp + excluded.xp, messages = messages + excluded.messages, voice_minutes = voice_minutes + excluded.voice_minutes,
           display_name = excluded.display_name, avatar_url = excluded.avatar_url, left_at = NULL, updated_at = excluded.updated_at
         RETURNING xp`,
      )
      .get(
        guildId,
        member.id,
        xp,
        source === 'message' ? 1 : 0,
        source === 'voice' ? 1 : 0,
        member.displayName,
        member.avatarUrl,
        Date.now(),
      )!.xp;
    return { member, before: after - xp, after };
  }

  /** Voice XP for many members in one transaction. */
  addVoiceXp(guildId: string, members: MemberSnapshot[]): Award[] {
    return this.db.transaction(() => members.map((member) => this.addXp(guildId, member, XP_RULES.voicePerMinute, 'voice')))();
  }

  top(guildId: string, limit: number): MemberRow[] {
    return this.db
      .query<MemberRow, [string, number]>(
        `SELECT user_id, xp, messages, voice_minutes, display_name, avatar_url FROM leveling_members
         WHERE guild_id = ? AND left_at IS NULL AND xp > 0 ORDER BY xp DESC, user_id LIMIT ?`,
      )
      .all(guildId, limit);
  }

  stats(guildId: string, userId: string) {
    const row = this.db
      .query<MemberRow, [string, string]>(
        'SELECT user_id, xp, messages, voice_minutes, display_name, avatar_url FROM leveling_members WHERE guild_id = ? AND user_id = ?',
      )
      .get(guildId, userId);
    if (!row || row.xp <= 0) return { position: null, xp: 0, messages: row?.messages ?? 0, voiceMinutes: row?.voice_minutes ?? 0 };
    const ahead = this.db
      .query<{ count: number }, [string, number]>(
        'SELECT COUNT(*) AS count FROM leveling_members WHERE guild_id = ? AND left_at IS NULL AND xp > ?',
      )
      .get(guildId, row.xp)!.count;
    return { position: ahead + 1, xp: row.xp, messages: row.messages, voiceMinutes: row.voice_minutes };
  }

  setLeft(guildId: string, userId: string, left: boolean): boolean {
    return (
      this.db
        .query('UPDATE leveling_members SET left_at = ? WHERE guild_id = ? AND user_id = ?')
        .run(left ? Date.now() : null, guildId, userId).changes > 0
    );
  }

  reset(guildId: string): void {
    this.db.query('DELETE FROM leveling_members WHERE guild_id = ?').run(guildId);
  }

  private row(guildId: string) {
    return this.db.query<SettingsRow, [string]>('SELECT * FROM leveling_settings WHERE guild_id = ?').get(guildId);
  }
}

function snapshot(member: GuildMember | PartialGuildMember): MemberSnapshot {
  return {
    id: member.id,
    displayName: member.nickname ?? member.user.displayName,
    avatarUrl: member.displayAvatarURL({ size: 128, extension: 'png' }),
  };
}

/** The channel, its parent (channel of a thread, or category) and the category of a thread's channel. */
function channelChain(channel: { id: string; parentId: string | null; isThread(): boolean; parent?: { parentId: string | null } | null }) {
  return [channel.id, channel.parentId, channel.isThread() ? channel.parent?.parentId : null];
}

function channelStatus(guild: Guild, channelId: string | null): ChannelStatus | null {
  if (!channelId) return null;
  const channel = guild.channels.cache.get(channelId);
  if (!isPostableChannel(channel)) return { exists: false, name: null, missingPermissions: [] };
  return { exists: true, name: channel.name, missingPermissions: missingSendPermissions(guild, channel) };
}

export default defineServerFeature({
  manifest: levelingManifest,
  permissions: ['ViewChannel', 'SendMessages', 'EmbedLinks'],
  tables: ['leveling_settings', 'leveling_members'],
  migrations: [
    {
      id: 'leveling_001_init',
      sql: `
        CREATE TABLE leveling_settings (
          guild_id TEXT PRIMARY KEY,
          enabled INTEGER NOT NULL DEFAULT 0,
          ignored_channel_ids TEXT NOT NULL DEFAULT '[]',
          announce_mode TEXT NOT NULL DEFAULT 'current',
          announce_channel_id TEXT,
          title TEXT NOT NULL DEFAULT '',
          description TEXT NOT NULL DEFAULT '',
          color TEXT,
          mention_user INTEGER NOT NULL DEFAULT 0,
          leaderboard_channel_id TEXT,
          leaderboard_interval INTEGER NOT NULL DEFAULT 5,
          leaderboard_size INTEGER NOT NULL DEFAULT 10,
          panel_channel_id TEXT,
          panel_message_id TEXT,
          last_error TEXT,
          last_error_at INTEGER,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE leveling_members (
          guild_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          xp INTEGER NOT NULL DEFAULT 0,
          messages INTEGER NOT NULL DEFAULT 0,
          voice_minutes INTEGER NOT NULL DEFAULT 0,
          display_name TEXT NOT NULL DEFAULT '',
          avatar_url TEXT,
          left_at INTEGER,
          updated_at INTEGER NOT NULL,
          PRIMARY KEY (guild_id, user_id)
        );
        CREATE INDEX idx_leveling_members_rank ON leveling_members (guild_id, xp DESC) WHERE left_at IS NULL;
      `,
    },
  ],

  setup(ctx: AppContext) {
    const { db, logger, queue, guildSettings, client } = ctx;
    const store = new LevelingStore(db);
    /** Members who got message XP within the cooldown. */
    const cooldown = new LruCache<string, true>(100_000, XP_RULES.messageCooldownSeconds * 1000);
    /** Servers whose XP changed since their leaderboard was last drawn. */
    const dirty = new Set<string>();
    const lastRefresh = new Map<string, number>();
    /** What the leaderboard showed last time, to skip edits that change nothing. */
    const lastDrawn = new Map<string, string>();
    /** Asking Discord for members in voice we have not seen yet: at most once per 10 minutes per server. */
    const memberFetchLimiter = new WindowLimiter(1, 10 * 60_000);
    const rankLimiter = new WindowLimiter(5);
    const texts = (guildId: string) => levelingManifest.messages[guildSettings.locale(guildId)];

    const entriesFor = (guildId: string, size: number): LeaderboardEntry[] =>
      store.top(guildId, size).map((row) => ({ userId: row.user_id, xp: row.xp }));

    /** Post, update or remove the leaderboard so it matches the settings and the current XP. */
    async function refreshPanel(guild: Guild, options: { forceNew?: boolean; scheduled?: boolean } = {}) {
      const settings = store.get(guild.id);
      const entries = entriesFor(guild.id, settings.leaderboardSize);
      const show = settings.enabled && settings.leaderboardChannelId !== null;
      const result = await syncPanelMessage({
        guild,
        queue,
        queueKey: `leveling:${guild.id}`,
        existing: store.panel(guild.id),
        target: show
          ? {
              channelId: settings.leaderboardChannelId,
              payload: buildLeaderboardPanel(settings, {
                locale: guildSettings.locale(guild.id),
                server: { name: guild.name },
                entries,
                updatedAt: new Date(),
              }),
            }
          : null,
        forceNew: options.forceNew,
        // A scheduled refresh never brings back a panel someone deleted on purpose.
        repostIfDeleted: !options.scheduled,
      });
      lastRefresh.set(guild.id, Date.now());
      if (!result.ok) {
        logger.warn('Leaderboard update failed', { guildId: guild.id, code: result.error });
        if (result.error === 'panel_deleted') store.setPanel(guild.id, null);
        store.setError(guild.id, result.error);
        return result;
      }
      store.setPanel(guild.id, result.panel);
      lastDrawn.set(guild.id, JSON.stringify(entries));
      return result;
    }

    /** Runs every minute: redraws leaderboards that are due and actually changed. */
    async function refreshDueLeaderboards() {
      const now = Date.now();
      for (const guildId of [...dirty]) {
        const guild = client.guilds.cache.get(guildId);
        const settings = store.get(guildId);
        if (!guild || !settings.enabled || !store.panel(guildId)) {
          dirty.delete(guildId);
          continue;
        }
        if (now - (lastRefresh.get(guildId) ?? 0) < settings.leaderboardInterval * 60_000 - 5_000) continue;
        dirty.delete(guildId);
        // XP below the top N moved: nothing visible changed.
        if (JSON.stringify(entriesFor(guildId, settings.leaderboardSize)) === lastDrawn.get(guildId)) continue;
        await refreshPanel(guild, { scheduled: true }).catch((error) => logger.error('Leaderboard refresh crashed', { guildId, error }));
      }
    }

    async function announce(guild: Guild, award: Award, source: GuildTextBasedChannel | null) {
      const settings = store.get(guild.id);
      const before = levelFromXp(award.before).level;
      const after = levelFromXp(award.after).level;
      if (after <= before || settings.announceMode === 'off') return;

      let channel: GuildTextBasedChannel | null = null;
      if (settings.announceMode === 'current' && source) channel = source;
      else if (settings.announceChannelId) {
        const target = guild.channels.cache.get(settings.announceChannelId);
        channel = isPostableChannel(target) ? target : null;
      }
      if (!channel) return;

      const payload = buildLevelUpMessage(settings, {
        locale: guildSettings.locale(guild.id),
        member: award.member,
        level: after,
        server: { name: guild.name },
      });
      try {
        await queue.run(`leveling:${guild.id}`, () => channel.send(payload));
      } catch (error) {
        logger.warn('Level up message failed', { guildId: guild.id, channelId: channel.id, error });
        store.setError(guild.id, 'send_failed');
      }
    }

    function onMessage(message: Message) {
      if (!message.inGuild() || message.author.bot || message.webhookId || message.system) return;
      const settings = store.get(message.guildId);
      if (!settings.enabled) return;
      if (isIgnoredChannel(channelChain(message.channel), settings.ignoredChannelIds)) return;
      const key = `${message.guildId}:${message.author.id}`;
      if (cooldown.get(key)) return;
      cooldown.set(key, true);

      const member = message.member;
      const award = store.addXp(
        message.guildId,
        member
          ? snapshot(member)
          : { id: message.author.id, displayName: message.author.displayName, avatarUrl: message.author.displayAvatarURL({ size: 128, extension: 'png' }) },
        messageXp(),
        'message',
      );
      dirty.add(message.guildId);
      void announce(message.guild, award, message.channel);
    }

    /** Runs every minute: one voice XP tick for every eligible member. */
    function voiceTick() {
      for (const guildId of store.enabledGuildIds()) {
        const guild = client.guilds.cache.get(guildId);
        if (!guild) continue;
        const states = [...guild.voiceStates.cache.values()].filter((state) => state.channelId);
        if (!states.length) continue;

        // Members in voice are kept in the cache (see discord/client.ts). Fetch the ones we missed, e.g. after a restart.
        const unknown = states.filter((state) => !state.member).map((state) => state.id);
        if (unknown.length && memberFetchLimiter.tryTake(guildId)) {
          guild.members.fetch({ user: unknown.slice(0, 100) }).catch((error) => logger.warn('Could not load voice members', { guildId, error }));
        }

        const settings = store.get(guildId);
        const humans = new Map<string, number>();
        for (const state of states) {
          if (state.member && !state.member.user.bot) humans.set(state.channelId!, (humans.get(state.channelId!) ?? 0) + 1);
        }
        const eligible = states.flatMap((state) => {
          const member = state.member;
          if (!member) return [];
          const ok = isVoiceEligible({
            bot: member.user.bot,
            deaf: Boolean(state.deaf),
            channelId: state.channelId,
            afkChannelId: guild.afkChannelId,
            humansInChannel: humans.get(state.channelId!) ?? 0,
            ignored: isIgnoredChannel([state.channelId, state.channel?.parentId], settings.ignoredChannelIds),
          });
          return ok ? [snapshot(member)] : [];
        });
        if (!eligible.length) continue;

        for (const award of store.addVoiceXp(guildId, eligible)) void announce(guild, award, null);
        dirty.add(guildId);
      }
    }

    const timers: ReturnType<typeof setInterval>[] = [];
    client.once(Events.ClientReady, () => {
      timers.push(
        setInterval(() => {
          try {
            voiceTick();
          } catch (error) {
            logger.error('Voice XP tick failed', { error });
          }
        }, 60_000),
        setInterval(() => void refreshDueLeaderboards(), 60_000),
      );
      for (const timer of timers) timer.unref();
    });

    function status(guild: Guild, settings: LevelingSettings): LevelingStatus {
      const panel = store.panel(guild.id);
      const panelChannel = panel ? guild.channels.cache.get(panel.channelId) : undefined;
      return {
        announceChannel: settings.announceMode === 'off' ? null : channelStatus(guild, settings.announceChannelId),
        leaderboardChannel: channelStatus(guild, settings.leaderboardChannelId),
        panel:
          panel && panelChannel
            ? { channelId: panel.channelId, channelName: panelChannel.name, url: `https://discord.com/channels/${guild.id}/${panel.channelId}/${panel.messageId}` }
            : null,
        lastError: store.lastError(guild.id),
      };
    }

    const response = (guild: Guild, panelError?: LevelingErrorCode): LevelingResponse => {
      const settings = store.get(guild.id);
      return { settings, status: status(guild, settings), ...(panelError ? { panelError } : {}) };
    };

    return {
      isEnabled: (guildId) => store.get(guildId).enabled,

      onGuildCreate: (guild) => store.ensureDefaults(guild.id),

      health: (guild) => {
        const settings = store.get(guild.id);
        const issues: Omit<PermissionIssue, 'feature'>[] = [];
        const check = (channelId: string | null) => {
          const state = channelStatus(guild, channelId);
          if (!state) return;
          if (!state.exists) issues.push({ code: 'channel_missing' });
          else if (state.missingPermissions.length) {
            issues.push({
              code: 'missing_permissions',
              channel: { id: channelId!, name: state.name! },
              permissions: state.missingPermissions as BotPermission[],
            });
          }
        };
        if (settings.announceMode !== 'off') check(settings.announceChannelId);
        if (settings.leaderboardChannelId !== settings.announceChannelId) check(settings.leaderboardChannelId);
        return issues;
      },

      events: {
        [Events.MessageCreate]: onMessage,

        [Events.InteractionCreate]: async (interaction: Interaction) => {
          if (!interaction.inCachedGuild() || !interaction.isButton() || interaction.customId !== RANK_BUTTON_ID) return;
          const { guild, member } = interaction;
          if (!store.get(guild.id).enabled) {
            await interaction.reply({ content: texts(guild.id).rank.disabled, flags: MessageFlags.Ephemeral });
            return;
          }
          if (!rankLimiter.tryTake(`${guild.id}:${member.id}`)) {
            await interaction.deferUpdate();
            return;
          }
          const payload = buildRankMessage(store.get(guild.id), {
            locale: guildSettings.locale(guild.id),
            member: snapshot(member),
            stats: store.stats(guild.id, member.id),
          });
          await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
        },

        /** Members who left drop off the leaderboard; their XP comes back if they return. */
        [Events.GuildMemberRemove]: (member: GuildMember | PartialGuildMember) => {
          if (store.setLeft(member.guild.id, member.id, true)) dirty.add(member.guild.id);
        },
        [Events.GuildMemberAdd]: (member: GuildMember) => {
          if (store.setLeft(member.guild.id, member.id, false)) dirty.add(member.guild.id);
        },
      },

      routes(router) {
        router.get('/', (c) => c.json(response(c.get('guild'))));

        router.put('/', async (c) => {
          const guild = c.get('guild');
          const settings = await parseJsonBody(c.req.raw, levelingSettingsSchema);
          store.save(guild.id, settings);
          logger.info('Leveling settings saved', { guildId: guild.id, userId: c.get('session').userId });
          const result = await refreshPanel(guild);
          return c.json(response(guild, result.ok ? undefined : result.error));
        });

        const repostLimiter = new WindowLimiter(5);
        router.post('/panel', async (c) => {
          const guild = c.get('guild');
          if (!repostLimiter.tryTake(guild.id)) throw new ApiError(429, 'rate_limited', 'You can post the leaderboard at most 5 times per minute');
          const result = await refreshPanel(guild, { forceNew: true });
          if (!result.ok) throw new ApiError(409, result.error, `Cannot post the leaderboard: ${result.error.replaceAll('_', ' ')}`);
          store.setError(guild.id, null);
          return c.json({ ...response(guild), channel: result.channel && { id: result.channel.id, name: result.channel.name } });
        });

        router.get('/top', (c) => {
          const guild = c.get('guild');
          const body: TopResponse = {
            members: store.top(guild.id, 25).map((row) => ({
              userId: row.user_id,
              displayName: row.display_name,
              avatarUrl: row.avatar_url,
              xp: row.xp,
              level: levelFromXp(row.xp).level,
              messages: row.messages,
              voiceMinutes: row.voice_minutes,
            })),
          };
          return c.json(body);
        });

        router.post('/reset', async (c) => {
          const guild = c.get('guild');
          store.reset(guild.id);
          logger.info('Leveling XP reset', { guildId: guild.id, userId: c.get('session').userId });
          await refreshPanel(guild);
          return c.json({ members: [] } satisfies TopResponse);
        });
      },
    };
  },
});
