/**
 * Leveling feature: bot side. Chat XP (messages) and voice XP are separate
 * tracks with their own levels; `xp` holds their sum for the overall level and
 * the leaderboard. Level up announcements, the leaderboard panel and its
 * refresh scheduler, database and API routes.
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
import { foldName, namePattern } from '../../apps/bot/src/core/search';
import { ApiError, parseInput, parseJsonBody } from '../../apps/bot/src/http/errors';
import { sessionName } from '../../apps/bot/src/http/session';
import { z } from 'zod';
import { snowflake } from '@shifubot/shared';
import {
  activeTracks,
  buildLeaderboardPanel,
  leaderboardPath,
  MEMBER_STATUSES,
  shownLevels,
  xpAdjustSchema,
  type MemberStatus,
  type XpOp,
  type LeaderboardKind,
  buildLevelUpMessage,
  buildRankMessage,
  defaultLevelingSettings,
  levelFromXp,
  levelingManifest,
  levelingSettingsSchema,
  levelsFor,
  RANK_BUTTON_ID,
  rankingXp,
  XP_RULES,
  type LeaderboardEntry,
  type LevelingSettings,
  type LevelTrack,
  type RankStats,
  type XpSources,
} from './manifest';
import { adjustedXp, isIgnoredChannel, isVoiceEligible, messageXp, voiceDay, voiceXpGrant } from './xp';

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
  /** Chat XP from messages. */
  textXp: number;
  /** Voice XP from time in voice channels. */
  voiceXp: number;
  /** XP the member is ranked by: chat + voice, or only the one source that counts on the server. */
  xp: number;
  textLevel: number;
  voiceLevel: number;
  /** Level of the total XP. */
  overallLevel: number;
  messages: number;
  voiceMinutes: number;
}

export interface TopResponse {
  members: TopMember[];
}

interface SettingsRow {
  guild_id: string;
  enabled: number;
  xp_sources: string;
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
  text_xp: number;
  voice_xp: number;
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

/** Old and new XP of the awarded track, to spot chat or voice level ups. */
interface Award {
  member: MemberSnapshot;
  track: LevelTrack;
  before: number;
  after: number;
}

const MEMBER_COLUMNS = 'user_id, xp, text_xp, voice_xp, messages, voice_minutes, display_name, avatar_url';

/** Column members are ranked by, per XP source setting. Fixed values, safe to put in SQL. */
const RANK_COLUMN = { both: 'xp', text: 'text_xp', voice: 'voice_xp' } as const satisfies Record<XpSources, keyof MemberRow>;

/** Column for each level kind on the web leaderboard. Fixed values, safe to put in SQL. */
const KIND_COLUMN = { overall: 'xp', text: 'text_xp', voice: 'voice_xp' } as const satisfies Record<LeaderboardKind, keyof MemberRow>;

export const LIST_PAGE_MAX = 100;

const listQuerySchema = z.object({
  by: z.enum(['overall', 'text', 'voice']).optional(),
  q: z.string().max(100).optional(),
  offset: z.coerce.number().int().min(0).max(1_000_000).optional(),
  limit: z.coerce.number().int().min(1).max(LIST_PAGE_MAX).optional(),
});

/** One row of the web leaderboard. Levels are computed on the page with levelsFor(). */
export interface LeaderboardListEntry {
  rank: number;
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  textXp: number;
  voiceXp: number;
  messages: number;
  voiceMinutes: number;
}

/** The web leaderboard (member route). */
export interface LeaderboardListResponse {
  /** What earns XP on this server: decides which level kinds can be shown. */
  xpSources: XpSources;
  by: LeaderboardKind;
  /** Members on this list (with XP of this kind). */
  members: number;
  /** Members matching the search (equal to members without a search). */
  matches: number;
  entries: LeaderboardListEntry[];
  me: LeaderboardListEntry | null;
}

const manageQuerySchema = listQuerySchema.extend({ status: z.enum(MEMBER_STATUSES).optional() });
const memberSearchSchema = z.object({ q: z.string().trim().min(2).max(100) });
const byQuerySchema = z.object({ by: z.enum(['overall', 'text', 'voice']).optional() });

/** One row of the dashboard manager. */
export interface ManagedMember extends LeaderboardListEntry {
  left: boolean;
}

export interface ManagedMembersResponse {
  xpSources: XpSources;
  by: LeaderboardKind;
  /** Members on this list (with this status and any XP). */
  members: number;
  matches: number;
  entries: ManagedMember[];
}

/** Members of the server without XP, found through Discord's member search. */
export interface MemberSearchResponse {
  members: { userId: string; displayName: string; avatarUrl: string }[];
}

/** Result of a manual correction. `member` is null when the member no longer has any XP. */
export interface XpChangeResponse {
  before: number;
  after: number;
  member: ManagedMember | null;
}

const listEntry = (row: MemberRow & { rank: number }): LeaderboardListEntry => ({
  rank: row.rank,
  userId: row.user_id,
  displayName: row.display_name,
  avatarUrl: row.avatar_url,
  textXp: row.text_xp,
  voiceXp: row.voice_xp,
  messages: row.messages,
  voiceMinutes: row.voice_minutes,
});

export class LevelingStore {
  private readonly cache = new LruCache<string, LevelingSettings>(10_000);

  constructor(private readonly db: Database) {}

  get(guildId: string): LevelingSettings {
    const cached = this.cache.get(guildId);
    if (cached) return cached;
    const row = this.row(guildId);
    const parsed = row
      ? levelingSettingsSchema.safeParse({
          enabled: row.enabled === 1,
          xpSources: row.xp_sources,
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
           (guild_id, enabled, xp_sources, ignored_channel_ids, announce_mode, announce_channel_id, title, description, color,
            mention_user, leaderboard_channel_id, leaderboard_interval, leaderboard_size, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (guild_id) DO UPDATE SET
           enabled = excluded.enabled, xp_sources = excluded.xp_sources, ignored_channel_ids = excluded.ignored_channel_ids,
           announce_mode = excluded.announce_mode, announce_channel_id = excluded.announce_channel_id,
           title = excluded.title, description = excluded.description, color = excluded.color,
           mention_user = excluded.mention_user, leaderboard_channel_id = excluded.leaderboard_channel_id,
           leaderboard_interval = excluded.leaderboard_interval, leaderboard_size = excluded.leaderboard_size,
           updated_at = excluded.updated_at, last_error = NULL, last_error_at = NULL`,
      )
      .run(
        guildId,
        Number(s.enabled),
        s.xpSources,
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

  /**
   * Adds XP to one track (chat or voice) and to the total, and returns that track's XP before and
   * after. Also refreshes the name and avatar snapshot.
   */
  addXp(guildId: string, member: MemberSnapshot, xp: number, track: LevelTrack): Award {
    const text = track === 'text' ? xp : 0;
    const voice = track === 'voice' ? xp : 0;
    const row = this.db
      .query<
        { text_xp: number; voice_xp: number },
        [string, string, number, number, number, number, number, string, string, string, number]
      >(
        `INSERT INTO leveling_members
           (guild_id, user_id, xp, text_xp, voice_xp, messages, voice_minutes, display_name, search_name, avatar_url, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (guild_id, user_id) DO UPDATE SET
           xp = xp + excluded.xp, text_xp = text_xp + excluded.text_xp, voice_xp = voice_xp + excluded.voice_xp,
           messages = messages + excluded.messages, voice_minutes = voice_minutes + excluded.voice_minutes,
           display_name = excluded.display_name, search_name = excluded.search_name, avatar_url = excluded.avatar_url,
           left_at = NULL, updated_at = excluded.updated_at
         RETURNING text_xp, voice_xp`,
      )
      .get(
        guildId,
        member.id,
        xp,
        text,
        voice,
        track === 'text' ? 1 : 0,
        track === 'voice' ? 1 : 0,
        member.displayName,
        foldName(member.displayName),
        member.avatarUrl,
        Date.now(),
      )!;
    const after = track === 'text' ? row.text_xp : row.voice_xp;
    return { member, track, before: after - xp, after };
  }

  /** Voice XP for many members in one transaction. */
  /**
   * One minute of voice XP for many members in one transaction, spread so the daily cap is reached
   * after XP_RULES.voiceCapMinutes. Returns an award per member in the same order, or null for members
   * who already hit today's cap.
   */
  addVoiceXp(guildId: string, members: MemberSnapshot[], now = new Date()): (Award | null)[] {
    const day = voiceDay(now);
    return this.db.transaction(() =>
      members.map((member) => {
        const minutes =
          this.db
            .query<{ minutes: number }, [string, string, string]>(
              `SELECT CASE WHEN voice_day = ? THEN voice_day_minutes ELSE 0 END AS minutes
               FROM leveling_members WHERE guild_id = ? AND user_id = ?`,
            )
            .get(day, guildId, member.id)?.minutes ?? 0;
        const grant = voiceXpGrant(minutes);
        if (grant <= 0) return null;
        const award = this.addXp(guildId, member, grant, 'voice');
        this.db
          .query('UPDATE leveling_members SET voice_day = ?, voice_day_minutes = ? WHERE guild_id = ? AND user_id = ?')
          .run(day, minutes + 1, guildId, member.id);
        return award;
      }),
    )();
  }

  /** Top members by the XP that counts: total (chat + voice), or only chat or voice XP. */
  top(guildId: string, limit: number, sources: XpSources = 'both'): MemberRow[] {
    const column = RANK_COLUMN[sources];
    return this.db
      .query<MemberRow, [string, number]>(
        `SELECT ${MEMBER_COLUMNS} FROM leveling_members
         WHERE guild_id = ? AND left_at IS NULL AND ${column} > 0 ORDER BY ${column} DESC, user_id LIMIT ?`,
      )
      .all(guildId, limit);
  }

  stats(guildId: string, userId: string, sources: XpSources = 'both'): RankStats {
    const row = this.db
      .query<MemberRow, [string, string]>(`SELECT ${MEMBER_COLUMNS} FROM leveling_members WHERE guild_id = ? AND user_id = ?`)
      .get(guildId, userId);
    const base = {
      textXp: row?.text_xp ?? 0,
      voiceXp: row?.voice_xp ?? 0,
      messages: row?.messages ?? 0,
      voiceMinutes: row?.voice_minutes ?? 0,
    };
    const column = RANK_COLUMN[sources];
    const score = row ? row[column] : 0;
    if (!row || score <= 0) return { ...base, position: null };
    const ahead = this.db
      .query<{ count: number }, [string, number]>(
        `SELECT COUNT(*) AS count FROM leveling_members WHERE guild_id = ? AND left_at IS NULL AND ${column} > ?`,
      )
      .get(guildId, score)!.count;
    return { ...base, position: ahead + 1 };
  }

  /**
   * The full leaderboard for the member page, ranked by one level kind: overall (total XP), chat or voice.
   * Members who left are not listed. The search runs after ranking, so results keep their real place.
   */
  list(
    guildId: string,
    options: { by: LeaderboardKind; q?: string; offset?: number; limit?: number },
  ): { entries: LeaderboardListEntry[]; matches: number; members: number } {
    const column = KIND_COLUMN[options.by];
    const limit = Math.min(Math.max(options.limit ?? 50, 1), LIST_PAGE_MAX);
    const offset = Math.max(options.offset ?? 0, 0);
    const pattern = namePattern(options.q);
    const ranked = `
      WITH ranked AS (
        SELECT user_id, text_xp, voice_xp, messages, voice_minutes, display_name, search_name, avatar_url,
               ROW_NUMBER() OVER (ORDER BY ${column} DESC, user_id) AS rank
        FROM leveling_members WHERE guild_id = ? AND left_at IS NULL AND ${column} > 0
      )`;
    const where = pattern ? `WHERE search_name LIKE ? ESCAPE '\\'` : '';
    const params = pattern ? [guildId, pattern] : [guildId];
    const rows = this.db
      .query<MemberRow & { rank: number }, (string | number)[]>(`${ranked} SELECT * FROM ranked ${where} ORDER BY rank LIMIT ? OFFSET ?`)
      .all(...params, limit, offset);
    const count = (filter: string, values: string[]) =>
      this.db.query<{ n: number }, string[]>(`${ranked} SELECT COUNT(*) AS n FROM ranked ${filter}`).get(...values)?.n ?? 0;
    const members = count('', [guildId]);
    return {
      entries: rows.map(listEntry),
      matches: pattern ? count(where, params) : members,
      members,
    };
  }

  /** One member's row and place for a level kind, or null when they are not on that list. */
  rankOf(guildId: string, userId: string, by: LeaderboardKind): LeaderboardListEntry | null {
    const column = KIND_COLUMN[by];
    const row = this.db
      .query<MemberRow & { rank: number }, [string, string]>(
        `SELECT * FROM (
           SELECT user_id, text_xp, voice_xp, messages, voice_minutes, display_name, avatar_url,
                  ROW_NUMBER() OVER (ORDER BY ${column} DESC, user_id) AS rank
           FROM leveling_members WHERE guild_id = ? AND left_at IS NULL AND ${column} > 0
         ) WHERE user_id = ?`,
      )
      .get(guildId, userId);
    return row ? listEntry(row) : null;
  }

  /**
   * The list of the dashboard manager: every member with any XP, current or left, ranked by one level
   * kind. Ranks match the member page, because members with no XP of that kind sort after everyone else.
   */
  manageList(
    guildId: string,
    options: { by: LeaderboardKind; status: MemberStatus; q?: string; offset?: number; limit?: number },
  ): { entries: ManagedMember[]; matches: number; members: number } {
    const limit = Math.min(Math.max(options.limit ?? 50, 1), LIST_PAGE_MAX);
    const offset = Math.max(options.offset ?? 0, 0);
    const pattern = namePattern(options.q);
    const ranked = this.managedRanked(options.by, options.status === 'left');
    const where = pattern ? `WHERE search_name LIKE ? ESCAPE '\\'` : '';
    const params = pattern ? [guildId, pattern] : [guildId];
    const rows = this.db
      .query<MemberRow & { rank: number; left_at: number | null }, (string | number)[]>(`${ranked} SELECT * FROM ranked ${where} ORDER BY rank LIMIT ? OFFSET ?`)
      .all(...params, limit, offset);
    const count = (filter: string, values: string[]) =>
      this.db.query<{ n: number }, string[]>(`${ranked} SELECT COUNT(*) AS n FROM ranked ${filter}`).get(...values)?.n ?? 0;
    const members = count('', [guildId]);
    return {
      entries: rows.map((row) => ({ ...listEntry(row), left: row.left_at !== null })),
      matches: pattern ? count(where, params) : members,
      members,
    };
  }

  /** One row of the dashboard manager, or null when the member has no XP. */
  managedMember(guildId: string, userId: string, by: LeaderboardKind): ManagedMember | null {
    const left = this.db
      .query<{ left_at: number | null }, [string, string]>('SELECT left_at FROM leveling_members WHERE guild_id = ? AND user_id = ?')
      .get(guildId, userId);
    if (!left) return null;
    const row = this.db
      .query<MemberRow & { rank: number; left_at: number | null }, [string, string]>(`${this.managedRanked(by, left.left_at !== null)} SELECT * FROM ranked WHERE user_id = ?`)
      .get(guildId, userId);
    return row ? { ...listEntry(row), left: row.left_at !== null } : null;
  }

  private managedRanked(by: LeaderboardKind, left: boolean): string {
    return `
      WITH ranked AS (
        SELECT user_id, text_xp, voice_xp, messages, voice_minutes, display_name, search_name, avatar_url, left_at,
               ROW_NUMBER() OVER (ORDER BY ${KIND_COLUMN[by]} DESC, user_id) AS rank
        FROM leveling_members WHERE guild_id = ? AND left_at IS ${left ? 'NOT NULL' : 'NULL'} AND xp > 0
      )`;
  }

  /** The display name of a member we have a row for, or null. */
  memberName(guildId: string, userId: string): string | null {
    return (
      this.db
        .query<{ display_name: string }, [string, string]>('SELECT display_name FROM leveling_members WHERE guild_id = ? AND user_id = ?')
        .get(guildId, userId)?.display_name ?? null
    );
  }

  /** Which of these members already have XP. */
  idsWithXp(guildId: string, userIds: string[]): Set<string> {
    if (!userIds.length) return new Set();
    const rows = this.db
      .query<{ user_id: string }, string[]>(`SELECT user_id FROM leveling_members WHERE guild_id = ? AND xp > 0 AND user_id IN (${userIds.map(() => '?').join(', ')})`)
      .all(guildId, ...userIds);
    return new Set(rows.map((row) => row.user_id));
  }

  /**
   * A manual correction of one track. Keeps xp equal to chat + voice and leaves the message count,
   * the voice minutes and today's voice cap alone. `snapshot` creates the row for a member without one.
   */
  adjustXp(guildId: string, userId: string, track: LevelTrack, op: XpOp, amount: number, snapshot?: MemberSnapshot): { before: number; after: number } {
    const column = track === 'text' ? 'text_xp' : 'voice_xp';
    return this.db.transaction(() => {
      const row = this.db
        .query<{ value: number }, [string, string]>(`SELECT ${column} AS value FROM leveling_members WHERE guild_id = ? AND user_id = ?`)
        .get(guildId, userId);
      const before = row?.value ?? 0;
      const after = adjustedXp(before, op, amount);
      if (after === before) return { before, after };
      if (row) {
        this.db
          .query(`UPDATE leveling_members SET ${column} = ?, xp = xp + ?, updated_at = ? WHERE guild_id = ? AND user_id = ?`)
          .run(after, after - before, Date.now(), guildId, userId);
      } else {
        if (!snapshot) throw new Error('A member without a row needs a snapshot');
        this.db
          .query(
            `INSERT INTO leveling_members (guild_id, user_id, xp, ${column}, display_name, search_name, avatar_url, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(guildId, userId, after, after, snapshot.displayName, foldName(snapshot.displayName), snapshot.avatarUrl, Date.now());
      }
      return { before, after };
    })();
  }

  /**
   * Back to zero for one member, with the counters that go with the XP. Today's voice cap stays, so a
   * reset cannot be used to earn more voice XP today. Returns the XP they had, or null without a row.
   */
  resetMember(guildId: string, userId: string): number | null {
    const row = this.db
      .query<{ xp: number }, [string, string]>('SELECT xp FROM leveling_members WHERE guild_id = ? AND user_id = ?')
      .get(guildId, userId);
    if (!row) return null;
    this.db
      .query('UPDATE leveling_members SET xp = 0, text_xp = 0, voice_xp = 0, messages = 0, voice_minutes = 0, updated_at = ? WHERE guild_id = ? AND user_id = ?')
      .run(Date.now(), guildId, userId);
    return row.xp;
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

/** The moderator's name for the audit log, which may not know this user yet. */
/** The requested level kind if it counts on this server, otherwise the server's own ranking. */
function byOrDefault(by: LeaderboardKind | undefined, sources: XpSources): LeaderboardKind {
  const kinds = shownLevels(sources);
  return by && kinds.includes(by) ? by : kinds[0]!;
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
    {
      // Chat and voice become separate tracks. xp stays the total and keeps the rank index.
      // Old XP is reset on purpose: everyone starts both tracks from zero.
      id: 'leveling_002_split_tracks',
      sql: `
        ALTER TABLE leveling_members ADD COLUMN text_xp INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE leveling_members ADD COLUMN voice_xp INTEGER NOT NULL DEFAULT 0;
        DELETE FROM leveling_members;
      `,
    },
    {
      // What earns XP: both (default), messages only or voice only. Single source servers rank by that track.
      id: 'leveling_003_xp_sources',
      sql: `
        ALTER TABLE leveling_settings ADD COLUMN xp_sources TEXT NOT NULL DEFAULT 'both';
        CREATE INDEX idx_leveling_members_rank_text ON leveling_members (guild_id, text_xp DESC) WHERE left_at IS NULL;
        CREATE INDEX idx_leveling_members_rank_voice ON leveling_members (guild_id, voice_xp DESC) WHERE left_at IS NULL;
      `,
    },
    {
      // Daily voice XP cap: how many XP earning voice minutes a member had on which UTC day.
      id: 'leveling_004_voice_daily_cap',
      sql: `
        ALTER TABLE leveling_members ADD COLUMN voice_day TEXT;
        ALTER TABLE leveling_members ADD COLUMN voice_day_minutes INTEGER NOT NULL DEFAULT 0;
      `,
    },
    {
      // Name search on the web leaderboard. Old rows get an ASCII lowercase name now and the full
      // folded one (accents removed) the next time they earn XP.
      id: 'leveling_005_search_name',
      sql: `
        ALTER TABLE leveling_members ADD COLUMN search_name TEXT;
        UPDATE leveling_members SET search_name = LOWER(display_name);
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
      store
        .top(guildId, size, store.get(guildId).xpSources)
        .map((row) => ({ userId: row.user_id, textXp: row.text_xp, voiceXp: row.voice_xp }));

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
                listUrl: `${ctx.config.publicUrl.replace(/\/+$/, '')}${leaderboardPath(guild.id)}`,
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

    /**
     * `source` is where the XP was earned: the text channel of a message, or the voice channel
     * (whose built in text chat receives voice level ups in "current" mode).
     */
    async function announce(guild: Guild, award: Award, source: GuildTextBasedChannel | null) {
      const settings = store.get(guild.id);
      const before = levelFromXp(award.before).level;
      const after = levelFromXp(award.after).level;
      if (after <= before || settings.announceMode === 'off') return;

      let channel: GuildTextBasedChannel | null = null;
      if (settings.announceMode === 'current') {
        // Voice chats are often locked down: skip quietly when ShifuBot cannot write there.
        if (!source || missingSendPermissions(guild, source).length) {
          logger.debug('Level up not announced: cannot write where it happened', { guildId: guild.id, channelId: source?.id });
          return;
        }
        channel = source;
      } else if (settings.announceChannelId) {
        const target = guild.channels.cache.get(settings.announceChannelId);
        channel = isPostableChannel(target) ? target : null;
      }
      if (!channel) return;

      const payload = buildLevelUpMessage(settings, {
        locale: guildSettings.locale(guild.id),
        member: award.member,
        track: award.track,
        level: after,
        server: { name: guild.name },
      });
      try {
        await queue.run(`leveling:${guild.id}`, () => channel.send(payload));
      } catch (error) {
        logger.warn('Level up message failed', { guildId: guild.id, channelId: channel.id, error });
        store.setError(guild.id, 'send_failed');
        ctx.audit.record(guild.id, { type: 'shifubot.messageFailed', channelId: channel.id, data: { feature: 'leveling', error: String((error as Error).message ?? error) } });
      }
    }

    function onMessage(message: Message) {
      if (!message.inGuild() || message.author.bot || message.webhookId || message.system) return;
      const settings = store.get(message.guildId);
      if (!settings.enabled || settings.xpSources === 'voice') return;
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
        'text',
      );
      dirty.add(message.guildId);
      void announce(message.guild, award, message.channel);
    }

    /** Runs every minute: one voice XP tick for every eligible member. */
    function voiceTick() {
      for (const guildId of store.enabledGuildIds()) {
        const guild = client.guilds.cache.get(guildId);
        if (!guild || store.get(guildId).xpSources === 'text') continue;
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
          // Only people who can hear count as company: a deafened alt sitting next to you does not unlock XP.
          if (state.member && !state.member.user.bot && !state.deaf) humans.set(state.channelId!, (humans.get(state.channelId!) ?? 0) + 1);
        }
        const eligible = states.flatMap((state) => {
          const member = state.member;
          if (!member) return [];
          const ok = isVoiceEligible({
            bot: member.user.bot,
            deaf: Boolean(state.deaf),
            muted: Boolean(state.mute) || Boolean(state.suppress),
            channelId: state.channelId,
            afkChannelId: guild.afkChannelId,
            humansInChannel: humans.get(state.channelId!) ?? 0,
            ignored: isIgnoredChannel([state.channelId, state.channel?.parentId], settings.ignoredChannelIds),
          });
          return ok ? [{ member: snapshot(member), channel: state.channel }] : [];
        });
        if (!eligible.length) continue;

        const awards = store.addVoiceXp(
          guildId,
          eligible.map((entry) => entry.member),
        );
        awards.forEach((award, index) => {
          if (!award) return;
          const channel = eligible[index]!.channel;
          void announce(guild, award, channel?.isTextBased() ? channel : null);
        });
        if (awards.some(Boolean)) dirty.add(guildId);
      }
    }

    const timers: ReturnType<typeof setInterval>[] = [];
    client.once(Events.ClientReady, () => {
      // Redraw posted leaderboards once after start so they match the database (e.g. after the XP reset
      // of the chat/voice split). It goes through the normal scheduler and send queue.
      for (const guildId of store.enabledGuildIds()) dirty.add(guildId);
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
        announceChannel: settings.announceMode === 'channel' ? channelStatus(guild, settings.announceChannelId) : null,
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
        // "current" mode posts where it happened, so there is no announcement channel to check.
        const announceChannelId = settings.announceMode === 'channel' ? settings.announceChannelId : null;
        check(announceChannelId);
        if (settings.leaderboardChannelId !== announceChannelId) check(settings.leaderboardChannelId);
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
            stats: store.stats(guild.id, member.id, store.get(guild.id).xpSources),
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
            members: store.top(guild.id, 25, store.get(guild.id).xpSources).map((row) => {
              const xp = { textXp: row.text_xp, voiceXp: row.voice_xp };
              const levels = levelsFor(xp);
              return {
                userId: row.user_id,
                displayName: row.display_name,
                avatarUrl: row.avatar_url,
                textXp: row.text_xp,
                voiceXp: row.voice_xp,
                xp: rankingXp(xp, store.get(guild.id).xpSources),
                textLevel: levels.text.level,
                voiceLevel: levels.voice.level,
                overallLevel: levels.overall.level,
                messages: row.messages,
                voiceMinutes: row.voice_minutes,
              };
            }),
          };
          return c.json(body);
        });

        router.post('/reset', async (c) => {
          const guild = c.get('guild');
          store.reset(guild.id);
          logger.info('Leveling XP reset', { guildId: guild.id, userId: c.get('session').userId });
          ctx.audit.record(guild.id, { type: 'shifubot.xpReset', actorId: c.get('session').userId, data: { feature: 'leveling' } });
          await refreshPanel(guild);
          return c.json({ members: [] } satisfies TopResponse);
        });

        /** The manager's list: every member with XP, with search, paging and the members who left. */
        router.get('/members', (c) => {
          const guild = c.get('guild');
          const query = parseInput(manageQuerySchema, c.req.query(), 'List query');
          const { xpSources } = store.get(guild.id);
          const by = byOrDefault(query.by, xpSources);
          const list = store.manageList(guild.id, { by, status: query.status ?? 'current', q: query.q, offset: query.offset, limit: query.limit });
          return c.json({ xpSources, by, ...list } satisfies ManagedMembersResponse);
        });

        const searchLimiter = new WindowLimiter(30);
        /** Members without XP do not have a row: find them through Discord, so they can be given XP too. */
        router.get('/members/search', async (c) => {
          const guild = c.get('guild');
          const { q } = parseInput(memberSearchSchema, c.req.query(), 'Search');
          if (!searchLimiter.tryTake(guild.id)) throw new ApiError(429, 'rate_limited', 'Too many member searches');
          const found = [...(await guild.members.search({ query: q, limit: 10, cache: false })).values()].filter((member) => !member.user.bot);
          const withXp = store.idsWithXp(guild.id, found.map((member) => member.id));
          const members = found.filter((member) => !withXp.has(member.id)).map((member) => {
            const { id, displayName, avatarUrl } = snapshot(member);
            return { userId: id, displayName, avatarUrl };
          });
          return c.json({ members } satisfies MemberSearchResponse);
        });

        /** A manual correction. No level up message: this is a fix, not an achievement. */
        router.post('/members/:userId/xp', async (c) => {
          const guild = c.get('guild');
          const userId = parseInput(snowflake, c.req.param('userId'), 'User id');
          const { by } = parseInput(byQuerySchema, c.req.query(), 'Query');
          const body = await parseJsonBody(c.req.raw, xpAdjustSchema);
          const { xpSources } = store.get(guild.id);
          if (!activeTracks(xpSources).includes(body.track)) throw new ApiError(400, 'validation', 'This kind of XP is turned off on this server');

          let name = store.memberName(guild.id, userId);
          let newMember: MemberSnapshot | undefined;
          if (name === null) {
            const member = await guild.members.fetch({ user: userId, cache: false }).catch(() => null);
            if (!member || member.user.bot) throw new ApiError(404, 'not_found', 'This member is not on the server');
            newMember = snapshot(member);
            name = newMember.displayName;
          }

          const { before, after } = store.adjustXp(guild.id, userId, body.track, body.op, body.amount, newMember);
          if (before !== after) {
            dirty.add(guild.id);
            logger.info('Member XP corrected', { guildId: guild.id, targetId: userId, track: body.track, before, after, userId: c.get('session').userId });
            ctx.audit.record(guild.id, {
              type: 'shifubot.xpChanged',
              actorId: c.get('session').userId,
              targetId: userId,
              targetKind: 'user',
              data: { actorName: sessionName(c.get('session')), targetName: name, track: body.track, before, after, ...(body.reason ? { reason: body.reason } : {}) },
            });
          }
          return c.json({ before, after, member: store.managedMember(guild.id, userId, byOrDefault(by, xpSources)) } satisfies XpChangeResponse);
        });

        router.post('/members/:userId/reset', (c) => {
          const guild = c.get('guild');
          const userId = parseInput(snowflake, c.req.param('userId'), 'User id');
          const name = store.memberName(guild.id, userId);
          const before = store.resetMember(guild.id, userId);
          if (before === null) throw new ApiError(404, 'not_found', 'This member has no XP');
          if (before > 0) {
            dirty.add(guild.id);
            logger.info('Member XP reset', { guildId: guild.id, targetId: userId, userId: c.get('session').userId });
            ctx.audit.record(guild.id, {
              type: 'shifubot.xpChanged',
              actorId: c.get('session').userId,
              targetId: userId,
              targetKind: 'user',
              data: { actorName: sessionName(c.get('session')), targetName: name, track: 'overall', before, after: 0 },
            });
          }
          return c.json({ before, after: 0, member: null } satisfies XpChangeResponse);
        });
      },

      memberRoutes(router) {
        /** The web leaderboard: every member, ranked by one level kind, with search and paging. */
        router.get('/', (c) => {
          const guild = c.get('guild');
          const query = parseInput(listQuerySchema, c.req.query(), 'List query');
          const { xpSources } = store.get(guild.id);
          const kinds = shownLevels(xpSources);
          // Only kinds that count on this server; the first one is the server's own ranking.
          const by: LeaderboardKind = query.by && kinds.includes(query.by) ? query.by : kinds[0]!;
          const list = store.list(guild.id, { by, q: query.q, offset: query.offset, limit: query.limit });
          const body: LeaderboardListResponse = {
            xpSources,
            by,
            members: list.members,
            matches: list.matches,
            entries: list.entries,
            me: store.rankOf(guild.id, c.get('session').userId, by),
          };
          return c.json(body);
        });
      },
    };
  },
});
