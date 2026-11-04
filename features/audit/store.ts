/**
 * Audit log storage: settings, events, a name snapshot of every member seen, and invite uses.
 * Plain bun:sqlite, no Discord objects, so it is easy to test.
 */
import type { Database, SQLQueryBindings } from 'bun:sqlite';
import { LruCache } from '../../apps/bot/src/core/lru-cache';
import type { AuditRecord } from '../../apps/bot/src/core/audit-sink';
import type { Migration } from '../../apps/bot/src/db/database';
import { auditSettingsSchema, categoryOf, defaultAuditSettings, REMOVED_TYPES, type AuditEvent, type AuditFilter, type AuditSettings, type AuditUser } from './manifest';

export const AUDIT_TABLES = ['audit_settings', 'audit_events', 'audit_users', 'audit_invites'];

export const auditMigrations: Migration[] = [
  {
    id: 'audit_001_init',
    sql: `
      CREATE TABLE audit_settings (
        guild_id TEXT PRIMARY KEY,
        enabled INTEGER NOT NULL DEFAULT 0,
        disabled_categories TEXT NOT NULL DEFAULT '[]',
        disabled_types TEXT NOT NULL DEFAULT '[]',
        retention_days INTEGER NOT NULL DEFAULT 30,
        ignored_channel_ids TEXT NOT NULL DEFAULT '[]',
        ignore_bots INTEGER NOT NULL DEFAULT 1,
        track_invites INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE audit_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        category TEXT NOT NULL,
        type TEXT NOT NULL,
        actor_id TEXT,
        target_id TEXT,
        target_kind TEXT,
        channel_id TEXT,
        data TEXT NOT NULL DEFAULT '{}',
        search TEXT NOT NULL DEFAULT ''
      );
      CREATE INDEX idx_audit_events_guild ON audit_events (guild_id, id);
      CREATE INDEX idx_audit_events_type ON audit_events (guild_id, type, id);
      CREATE INDEX idx_audit_events_category ON audit_events (guild_id, category, id);
      CREATE INDEX idx_audit_events_actor ON audit_events (guild_id, actor_id, id) WHERE actor_id IS NOT NULL;
      CREATE INDEX idx_audit_events_target ON audit_events (guild_id, target_id, id) WHERE target_id IS NOT NULL;
      CREATE INDEX idx_audit_events_channel ON audit_events (guild_id, channel_id, id) WHERE channel_id IS NOT NULL;
      CREATE TABLE audit_users (
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        username TEXT NOT NULL DEFAULT '',
        global_name TEXT,
        nick TEXT,
        avatar TEXT,
        guild_avatar TEXT,
        avatar_url TEXT,
        bot INTEGER NOT NULL DEFAULT 0,
        joined_at INTEGER,
        pending INTEGER,
        premium_since INTEGER,
        full INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (guild_id, user_id)
      );
      CREATE TABLE audit_invites (
        guild_id TEXT NOT NULL,
        code TEXT NOT NULL,
        uses INTEGER NOT NULL DEFAULT 0,
        inviter_id TEXT,
        max_uses INTEGER,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (guild_id, code)
      );
    `,
  },
  {
    // Noise is no longer logged (sent messages, typing, reactions, poll votes, self mute, presence…).
    // Old rows of those types go, including stored message text; the old defaults that switched
    // some of them off are cleared.
    id: 'audit_002_drop_noise',
    sql: `
      DELETE FROM audit_events WHERE type IN (${REMOVED_TYPES.map((type) => `'${type}'`).join(', ')});
      UPDATE audit_settings SET disabled_categories = '[]' WHERE disabled_categories = '["presence"]';
      UPDATE audit_settings SET disabled_types = '[]' WHERE disabled_types = '["message.typing"]';
    `,
  },
];

interface SettingsRow {
  guild_id: string;
  enabled: number;
  disabled_categories: string;
  disabled_types: string;
  retention_days: number;
  ignored_channel_ids: string;
  ignore_bots: number;
  track_invites: number;
}

interface EventRow {
  id: number;
  created_at: number;
  category: string;
  type: string;
  actor_id: string | null;
  target_id: string | null;
  target_kind: string | null;
  channel_id: string | null;
  data: string;
}

/** What we know about a member, to show names and to spot profile changes. */
export interface UserSnapshot {
  id: string;
  username: string;
  globalName: string | null;
  nick: string | null;
  avatar: string | null;
  guildAvatar: string | null;
  avatarUrl: string | null;
  bot: boolean;
  joinedAt: number | null;
  /** Still has to accept the rules (membership screening). Null when unknown. */
  pending: boolean | null;
  premiumSince: number | null;
  /** True when it came from a member event, so the server only fields are known. */
  full: boolean;
}

interface UserRow {
  user_id: string;
  username: string;
  global_name: string | null;
  nick: string | null;
  avatar: string | null;
  guild_avatar: string | null;
  avatar_url: string | null;
  bot: number;
  joined_at: number | null;
  pending: number | null;
  premium_since: number | null;
  full: number;
}

export interface InviteRow {
  code: string;
  uses: number;
  inviterId: string | null;
  maxUses: number | null;
}

/** An event ready to be written. */
export interface PendingEvent extends AuditRecord {
  guildId: string;
  /** Extra words for the text search, e.g. member names. */
  searchText?: string;
}

/** Largest details object we keep, in characters of JSON. Message text is the usual big part. */
const MAX_DATA_LENGTH = 16_000;

export function displayName(user: Pick<UserSnapshot, 'username' | 'globalName' | 'nick'>): string {
  return user.nick || user.globalName || user.username || '';
}

function fromUserRow(row: UserRow): UserSnapshot {
  return {
    id: row.user_id,
    username: row.username,
    globalName: row.global_name,
    nick: row.nick,
    avatar: row.avatar,
    guildAvatar: row.guild_avatar,
    avatarUrl: row.avatar_url,
    bot: row.bot === 1,
    joinedAt: row.joined_at,
    pending: row.pending === null ? null : row.pending === 1,
    premiumSince: row.premium_since,
    full: row.full === 1,
  };
}

const USER_COLUMNS = 'guild_id, user_id, username, global_name, nick, avatar, guild_avatar, avatar_url, bot, joined_at, pending, premium_since, full, updated_at';

function userParams(guildId: string, user: UserSnapshot): SQLQueryBindings[] {
  return [
    guildId,
    user.id,
    user.username,
    user.globalName,
    user.nick,
    user.avatar,
    user.guildAvatar,
    user.avatarUrl,
    Number(user.bot),
    user.joinedAt,
    user.pending === null ? null : Number(user.pending),
    user.premiumSince,
    Number(user.full),
    Date.now(),
  ];
}

/** Every string inside a details object, lowercased, for the text search. */
export function searchTextOf(data: unknown, extra = ''): string {
  const parts: string[] = [];
  const walk = (value: unknown, depth: number) => {
    if (depth > 5 || parts.length > 200) return;
    if (typeof value === 'string') parts.push(value);
    else if (Array.isArray(value)) value.forEach((item) => walk(item, depth + 1));
    else if (value && typeof value === 'object') Object.values(value).forEach((item) => walk(item, depth + 1));
  };
  walk(data, 0);
  if (extra) parts.push(extra);
  return parts.join(' ').toLowerCase().slice(0, 8_000);
}

function serialiseData(data: Record<string, unknown> | undefined): string {
  const json = JSON.stringify(data ?? {});
  if (json.length <= MAX_DATA_LENGTH) return json;
  // Shorten the longest strings (message text) until it fits.
  const copy: Record<string, unknown> = { ...data, truncated: true };
  for (const key of ['content', 'before', 'after', 'matchedContent']) {
    if (typeof copy[key] === 'string') copy[key] = (copy[key] as string).slice(0, 2_000);
  }
  const shorter = JSON.stringify(copy);
  return shorter.length <= MAX_DATA_LENGTH ? shorter : JSON.stringify({ truncated: true });
}

const escapeLike = (value: string) => value.replace(/[\\%_]/g, (char) => `\\${char}`);

export class AuditStore {
  private readonly cache = new LruCache<string, AuditSettings>(10_000);

  constructor(private readonly db: Database) {}

  get(guildId: string): AuditSettings {
    const cached = this.cache.get(guildId);
    if (cached) return cached;
    const row = this.db.query<SettingsRow, [string]>('SELECT * FROM audit_settings WHERE guild_id = ?').get(guildId);
    const parsed = row
      ? auditSettingsSchema.safeParse({
          enabled: row.enabled === 1,
          disabledCategories: JSON.parse(row.disabled_categories) as unknown,
          disabledTypes: JSON.parse(row.disabled_types) as unknown,
          retentionDays: row.retention_days,
          ignoredChannelIds: JSON.parse(row.ignored_channel_ids) as unknown,
          ignoreBots: row.ignore_bots === 1,
          trackInvites: row.track_invites === 1,
        })
      : null;
    const settings = parsed?.success ? parsed.data : defaultAuditSettings;
    this.cache.set(guildId, settings);
    return settings;
  }

  save(guildId: string, s: AuditSettings): void {
    this.db
      .query(
        `INSERT INTO audit_settings
           (guild_id, enabled, disabled_categories, disabled_types, retention_days, ignored_channel_ids, ignore_bots, track_invites, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (guild_id) DO UPDATE SET
           enabled = excluded.enabled, disabled_categories = excluded.disabled_categories, disabled_types = excluded.disabled_types,
           retention_days = excluded.retention_days, ignored_channel_ids = excluded.ignored_channel_ids,
           ignore_bots = excluded.ignore_bots, track_invites = excluded.track_invites, updated_at = excluded.updated_at`,
      )
      .run(
        guildId,
        Number(s.enabled),
        JSON.stringify(s.disabledCategories),
        JSON.stringify(s.disabledTypes),
        s.retentionDays,
        JSON.stringify(s.ignoredChannelIds),
        Number(s.ignoreBots),
        Number(s.trackInvites),
        Date.now(),
      );
    this.cache.delete(guildId);
  }

  enabledGuildIds(): string[] {
    return this.db
      .query<{ guild_id: string }, []>('SELECT guild_id FROM audit_settings WHERE enabled = 1')
      .all()
      .map((row) => row.guild_id);
  }

  /** Every server with settings and its retention, for the cleanup job. */
  retentions(): { guildId: string; days: number }[] {
    return this.db
      .query<{ guild_id: string; retention_days: number }, []>('SELECT guild_id, retention_days FROM audit_settings')
      .all()
      .map((row) => ({ guildId: row.guild_id, days: row.retention_days }));
  }

  /** Writes many events in one transaction. */
  insert(events: PendingEvent[]): void {
    if (!events.length) return;
    const statement = this.db.query(
      `INSERT INTO audit_events (guild_id, created_at, category, type, actor_id, target_id, target_kind, channel_id, data, search)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    this.db.transaction(() => {
      for (const event of events) {
        statement.run(
          event.guildId,
          event.at ?? Date.now(),
          categoryOf(event.type),
          event.type,
          event.actorId ?? null,
          event.targetId ?? null,
          event.targetKind ?? null,
          event.channelId ?? null,
          serialiseData(event.data),
          searchTextOf(event.data, event.searchText),
        );
      }
    })();
  }

  /**
   * Events matching the filter, newest first. `visibleChannelIds` limits events that happened in a
   * channel to those the viewer can see; null means no limit (administrators).
   */
  query(guildId: string, filter: Partial<AuditFilter> & { limit: number }, visibleChannelIds: string[] | null = null): AuditEvent[] {
    const where = ['guild_id = ?'];
    const params: SQLQueryBindings[] = [guildId];
    if (filter.before) {
      where.push('id < ?');
      params.push(filter.before);
    }
    if (filter.after !== undefined) {
      where.push('id > ?');
      params.push(filter.after);
    }
    if (filter.from) {
      where.push('created_at >= ?');
      params.push(filter.from);
    }
    if (filter.to) {
      where.push('created_at <= ?');
      params.push(filter.to);
    }
    if (filter.categories?.length) {
      where.push(`category IN (${filter.categories.map(() => '?').join(', ')})`);
      params.push(...filter.categories);
    }
    if (filter.types?.length) {
      where.push(`type IN (${filter.types.map(() => '?').join(', ')})`);
      params.push(...filter.types);
    }
    if (filter.user) {
      const role = filter.userRole ?? 'any';
      if (role === 'actor') where.push('actor_id = ?');
      else if (role === 'target') where.push('target_id = ?');
      else {
        where.push('(actor_id = ? OR target_id = ?)');
        params.push(filter.user);
      }
      params.push(filter.user);
    }
    if (filter.channel) {
      where.push('channel_id = ?');
      params.push(filter.channel);
    }
    if (filter.q) {
      where.push("search LIKE ? ESCAPE '\\'");
      params.push(`%${escapeLike(filter.q.toLowerCase())}%`);
    }
    if (visibleChannelIds) {
      where.push('(channel_id IS NULL OR channel_id IN (SELECT value FROM json_each(?)))');
      params.push(JSON.stringify(visibleChannelIds));
    }
    params.push(filter.limit);
    return this.db
      .query<EventRow, SQLQueryBindings[]>(
        `SELECT id, created_at, category, type, actor_id, target_id, target_kind, channel_id, data
         FROM audit_events WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT ?`,
      )
      .all(...params)
      .map((row) => ({
        id: row.id,
        at: row.created_at,
        category: row.category as AuditEvent['category'],
        type: row.type,
        actorId: row.actor_id,
        targetId: row.target_id,
        targetKind: row.target_kind,
        channelId: row.channel_id,
        data: JSON.parse(row.data) as Record<string, unknown>,
      }));
  }

  stats(guildId: string): { events: number; oldest: number | null } {
    const row = this.db
      .query<{ events: number; oldest: number | null }, [string]>(
        'SELECT COUNT(*) AS events, MIN(created_at) AS oldest FROM audit_events WHERE guild_id = ?',
      )
      .get(guildId)!;
    return { events: row.events, oldest: row.oldest };
  }

  /** Deletes events older than `cutoff` in batches. Returns how many were deleted. */
  pruneOlderThan(guildId: string, cutoff: number, batch = 5_000, maxTotal = 200_000): number {
    let total = 0;
    for (;;) {
      const { changes } = this.db
        .query(
          `DELETE FROM audit_events WHERE id IN (
             SELECT id FROM audit_events WHERE guild_id = ? AND created_at < ? ORDER BY id LIMIT ?)`,
        )
        .run(guildId, cutoff, batch);
      total += changes;
      if (changes < batch || total >= maxTotal) return total;
    }
  }

  /** Keeps only the newest `max` events of a server. Returns how many were deleted. */
  capRows(guildId: string, max: number, batch = 5_000, maxTotal = 200_000): number {
    const boundary = this.db
      .query<{ id: number }, [string, number]>('SELECT id FROM audit_events WHERE guild_id = ? ORDER BY id DESC LIMIT 1 OFFSET ?')
      .get(guildId, max);
    if (!boundary) return 0;
    let total = 0;
    for (;;) {
      const { changes } = this.db
        .query(
          `DELETE FROM audit_events WHERE id IN (
             SELECT id FROM audit_events WHERE guild_id = ? AND id <= ? ORDER BY id LIMIT ?)`,
        )
        .run(guildId, boundary.id, batch);
      total += changes;
      if (changes < batch || total >= maxTotal) return total;
    }
  }

  /** Deletes every event of a server. */
  purge(guildId: string): number {
    let total = 0;
    for (;;) {
      const { changes } = this.db
        .query('DELETE FROM audit_events WHERE id IN (SELECT id FROM audit_events WHERE guild_id = ? LIMIT 5000)')
        .run(guildId);
      total += changes;
      if (changes < 5_000) return total;
    }
  }

  user(guildId: string, userId: string): UserSnapshot | null {
    const row = this.db.query<UserRow, [string, string]>('SELECT * FROM audit_users WHERE guild_id = ? AND user_id = ?').get(guildId, userId);
    return row ? fromUserRow(row) : null;
  }

  /** Saves the full profile of a member (from member events). Returns what was stored before. */
  upsertUser(guildId: string, user: UserSnapshot): UserSnapshot | null {
    const previous = this.user(guildId, user.id);
    this.db
      .query<never, SQLQueryBindings[]>(
        `INSERT INTO audit_users (${USER_COLUMNS})
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (guild_id, user_id) DO UPDATE SET
           username = excluded.username, global_name = excluded.global_name, nick = excluded.nick, avatar = excluded.avatar,
           guild_avatar = excluded.guild_avatar, avatar_url = excluded.avatar_url, bot = excluded.bot,
           joined_at = COALESCE(excluded.joined_at, audit_users.joined_at), pending = excluded.pending,
           premium_since = excluded.premium_since, full = excluded.full, updated_at = excluded.updated_at`,
      )
      .run(...userParams(guildId, user));
    return previous;
  }

  /**
   * Remembers a name we saw in passing (message author, reaction user) without touching an existing
   * row, so profile change detection only ever compares member updates.
   */
  rememberUser(guildId: string, user: UserSnapshot): void {
    this.db
      .query<never, SQLQueryBindings[]>(`INSERT OR IGNORE INTO audit_users (${USER_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(...userParams(guildId, user));
  }

  usersByIds(guildId: string, ids: string[]): Record<string, AuditUser> {
    if (!ids.length) return {};
    const rows = this.db
      .query<UserRow, [string, string]>('SELECT * FROM audit_users WHERE guild_id = ? AND user_id IN (SELECT value FROM json_each(?))')
      .all(guildId, JSON.stringify(ids));
    return Object.fromEntries(
      rows.map((row) => {
        const user = fromUserRow(row);
        return [user.id, { id: user.id, name: displayName(user), username: user.username, avatarUrl: user.avatarUrl }];
      }),
    );
  }

  searchUsers(guildId: string, query: string, limit = 10): AuditUser[] {
    const like = `%${escapeLike(query.toLowerCase())}%`;
    return this.db
      .query<UserRow, [string, string, string, string, string, string, number]>(
        `SELECT * FROM audit_users WHERE guild_id = ? AND (
           user_id = ? OR lower(username) LIKE ? ESCAPE '\\' OR lower(COALESCE(global_name, '')) LIKE ? ESCAPE '\\'
           OR lower(COALESCE(nick, '')) LIKE ? ESCAPE '\\' OR ? = '')
         ORDER BY updated_at DESC LIMIT ?`,
      )
      .all(guildId, query, like, like, like, query, limit)
      .map((row) => {
        const user = fromUserRow(row);
        return { id: user.id, name: displayName(user), username: user.username, avatarUrl: user.avatarUrl };
      });
  }

  invites(guildId: string): InviteRow[] {
    return this.db
      .query<{ code: string; uses: number; inviter_id: string | null; max_uses: number | null }, [string]>(
        'SELECT code, uses, inviter_id, max_uses FROM audit_invites WHERE guild_id = ?',
      )
      .all(guildId)
      .map((row) => ({ code: row.code, uses: row.uses, inviterId: row.inviter_id, maxUses: row.max_uses }));
  }

  /** Replaces the invite snapshot of a server with what Discord returned. */
  replaceInvites(guildId: string, invites: InviteRow[]): void {
    this.db.transaction(() => {
      this.db.query('DELETE FROM audit_invites WHERE guild_id = ?').run(guildId);
      const statement = this.db.query('INSERT INTO audit_invites (guild_id, code, uses, inviter_id, max_uses, updated_at) VALUES (?, ?, ?, ?, ?, ?)');
      for (const invite of invites) statement.run(guildId, invite.code, invite.uses, invite.inviterId, invite.maxUses, Date.now());
    })();
  }

  upsertInvite(guildId: string, invite: InviteRow): void {
    this.db
      .query(
        `INSERT INTO audit_invites (guild_id, code, uses, inviter_id, max_uses, updated_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (guild_id, code) DO UPDATE SET uses = excluded.uses, inviter_id = excluded.inviter_id,
           max_uses = excluded.max_uses, updated_at = excluded.updated_at`,
      )
      .run(guildId, invite.code, invite.uses, invite.inviterId, invite.maxUses, Date.now());
  }

  deleteInvite(guildId: string, code: string): void {
    this.db.query('DELETE FROM audit_invites WHERE guild_id = ? AND code = ?').run(guildId, code);
  }
}

/** The invite whose use count went up between two snapshots, when exactly one did. */
export function usedInvite(before: InviteRow[], after: InviteRow[]): InviteRow | null {
  const old = new Map(before.map((invite) => [invite.code, invite.uses]));
  const grown = after.filter((invite) => invite.uses > (old.get(invite.code) ?? 0));
  if (grown.length === 1) return grown[0]!;
  // A one-use invite disappears once used: if exactly one invite vanished and nothing grew, that was it.
  if (grown.length === 0) {
    const codes = new Set(after.map((invite) => invite.code));
    const gone = before.filter((invite) => !codes.has(invite.code) && invite.maxUses !== null && invite.maxUses > 0 && invite.uses + 1 >= invite.maxUses);
    if (gone.length === 1) return { ...gone[0]!, uses: gone[0]!.uses + 1 };
  }
  return null;
}

/**
 * Accepts events, applies the per server minute limit and writes them in batches. Events over the
 * limit are counted and written as one "events skipped" row when the minute ends.
 */
export class AuditWriter {
  private buffer: PendingEvent[] = [];
  private readonly windows = new Map<string, { start: number; count: number; skipped: number }>();

  constructor(
    private readonly store: AuditStore,
    private readonly maxPerMinute: number,
    private readonly onError: (error: unknown) => void = () => undefined,
    private readonly maxBuffer = 500,
  ) {}

  push(event: PendingEvent, now = Date.now()): boolean {
    const window = this.windows.get(event.guildId);
    if (!window || now - window.start >= 60_000) {
      if (window?.skipped) this.buffer.push(skippedEvent(event.guildId, window.skipped, now));
      this.windows.set(event.guildId, { start: now, count: 1, skipped: 0 });
    } else if (window.count >= this.maxPerMinute) {
      window.skipped++;
      return false;
    } else {
      window.count++;
    }
    this.buffer.push({ ...event, at: event.at ?? now });
    if (this.buffer.length >= this.maxBuffer) this.flush(now);
    return true;
  }

  /** Writes what is buffered, plus skip counts of minutes that ended. */
  flush(now = Date.now()): void {
    for (const [guildId, window] of this.windows) {
      if (now - window.start < 60_000) continue;
      if (window.skipped) this.buffer.push(skippedEvent(guildId, window.skipped, now));
      this.windows.delete(guildId);
    }
    if (!this.buffer.length) return;
    const batch = this.buffer;
    this.buffer = [];
    try {
      this.store.insert(batch);
    } catch (error) {
      this.onError(error);
    }
  }

  get pending(): number {
    return this.buffer.length;
  }
}

function skippedEvent(guildId: string, count: number, at: number): PendingEvent {
  return { guildId, type: 'shifubot.eventsSkipped', data: { count }, at };
}
