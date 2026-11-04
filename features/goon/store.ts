/**
 * Goon counter: database tables and queries.
 * Every press is a row, so an undo can only take back real, recent presses of
 * the same member. goon_members keeps the current count next to the name data.
 */
import type { Database } from 'bun:sqlite';
import { LruCache } from '../../apps/bot/src/core/lru-cache';
import type { PanelRef } from '../../apps/bot/src/core/panel';
import { defaultGoonSettings, goonSettingsSchema, type GoonEntry, type GoonSettings } from './manifest';

export const GOON_TABLES = ['goon_settings', 'goon_members', 'goon_presses'];

export const GOON_MIGRATIONS = [
  {
    id: 'goon_001_init',
    sql: `
      CREATE TABLE goon_settings (
        guild_id TEXT PRIMARY KEY,
        settings TEXT NOT NULL,
        panel_channel_id TEXT,
        panel_message_id TEXT,
        last_error TEXT,
        last_error_at INTEGER,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE goon_members (
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        count INTEGER NOT NULL DEFAULT 0,
        last_press_at INTEGER,
        display_name TEXT,
        avatar_url TEXT,
        base_name TEXT,
        last_nick TEXT,
        last_format TEXT,
        PRIMARY KEY (guild_id, user_id)
      );
      CREATE INDEX goon_members_top ON goon_members (guild_id, count DESC);
      CREATE TABLE goon_presses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        at INTEGER NOT NULL,
        undone_at INTEGER
      );
      CREATE INDEX goon_presses_member ON goon_presses (guild_id, user_id, id);
    `,
  },
  {
    // The counter is no longer written after nicknames. search_name feeds the search on the full
    // list page; rows from before get an ASCII lowercase name now and the full one at their next press.
    id: 'goon_002_drop_nicknames',
    sql: `
      ALTER TABLE goon_members DROP COLUMN base_name;
      ALTER TABLE goon_members DROP COLUMN last_nick;
      ALTER TABLE goon_members DROP COLUMN last_format;
      ALTER TABLE goon_members ADD COLUMN search_name TEXT;
      UPDATE goon_members SET search_name = LOWER(display_name);
    `,
  },
];

export type GoonErrorCode = 'no_channel' | 'channel_missing' | 'missing_permissions' | 'send_failed';

interface SettingsRow {
  settings: string;
  panel_channel_id: string | null;
  panel_message_id: string | null;
  last_error: string | null;
  last_error_at: number | null;
}

interface MemberRow {
  count: number;
  last_press_at: number | null;
  display_name: string | null;
  avatar_url: string | null;
}

export interface GoonTopEntry extends GoonEntry {
  displayName: string | null;
  avatarUrl: string | null;
}

export interface GoonListEntry extends GoonTopEntry {
  /** 1 based place on the full list. Search results keep their real place. */
  rank: number;
}

export const LIST_PAGE_MAX = 100;

/**
 * Lowercase without accents, so "adam" and "ÁDÁM" both find "Ádám".
 * Done in JavaScript because SQLite's LOWER() only knows ASCII letters.
 */
export const foldName = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** Escape % and _ so a search for "50%" finds the text, not everything. */
export const escapeLike = (text: string) => text.replace(/[\\%_]/g, (char) => `\\${char}`);

export type PressResult = { ok: true; count: number; pressedAt: number } | { ok: false; nextAt: number };

export class GoonStore {
  private readonly cache = new LruCache<string, GoonSettings>(10_000);

  constructor(private readonly db: Database) {}

  get(guildId: string): GoonSettings {
    const cached = this.cache.get(guildId);
    if (cached) return cached;
    const row = this.row(guildId);
    let settings = defaultGoonSettings;
    if (row) {
      // Stored as JSON: new settings get their default without a migration.
      const parsed = goonSettingsSchema.safeParse({ ...defaultGoonSettings, ...(JSON.parse(row.settings) as object) });
      if (parsed.success) settings = parsed.data;
    }
    this.cache.set(guildId, settings);
    return settings;
  }

  save(guildId: string, settings: GoonSettings): void {
    this.db
      .query(
        `INSERT INTO goon_settings (guild_id, settings, updated_at) VALUES (?, ?, ?)
         ON CONFLICT (guild_id) DO UPDATE SET settings = excluded.settings, updated_at = excluded.updated_at,
           last_error = NULL, last_error_at = NULL`,
      )
      .run(guildId, JSON.stringify(settings), Date.now());
    this.cache.delete(guildId);
  }

  panel(guildId: string): PanelRef | null {
    const row = this.row(guildId);
    return row?.panel_channel_id && row.panel_message_id ? { channelId: row.panel_channel_id, messageId: row.panel_message_id } : null;
  }

  setPanel(guildId: string, panel: PanelRef | null): void {
    this.ensureRow(guildId);
    this.db
      .query('UPDATE goon_settings SET panel_channel_id = ?, panel_message_id = ? WHERE guild_id = ?')
      .run(panel?.channelId ?? null, panel?.messageId ?? null, guildId);
  }

  setError(guildId: string, code: GoonErrorCode | null): void {
    this.ensureRow(guildId);
    this.db
      .query('UPDATE goon_settings SET last_error = ?, last_error_at = ? WHERE guild_id = ?')
      .run(code, code ? Date.now() : null, guildId);
  }

  lastError(guildId: string): { code: GoonErrorCode; at: number } | null {
    const row = this.row(guildId);
    return row?.last_error && row.last_error_at ? { code: row.last_error as GoonErrorCode, at: row.last_error_at } : null;
  }

  /** Count one press, unless the member's last press is within the cooldown. */
  press(guildId: string, userId: string, options: { now: number; cooldownMs: number; displayName: string; avatarUrl: string | null }): PressResult {
    const { now, cooldownMs, displayName, avatarUrl } = options;
    return this.db.transaction((): PressResult => {
      const last = this.member(guildId, userId)?.last_press_at ?? null;
      if (last !== null && now - last < cooldownMs) return { ok: false, nextAt: last + cooldownMs };
      this.db.query('INSERT INTO goon_presses (guild_id, user_id, at) VALUES (?, ?, ?)').run(guildId, userId, now);
      this.db
        .query(
          `INSERT INTO goon_members (guild_id, user_id, count, last_press_at, display_name, search_name, avatar_url)
           VALUES (?, ?, 1, ?, ?, ?, ?)
           ON CONFLICT (guild_id, user_id) DO UPDATE SET count = count + 1, last_press_at = excluded.last_press_at,
             display_name = excluded.display_name, search_name = excluded.search_name, avatar_url = excluded.avatar_url`,
        )
        .run(guildId, userId, now, displayName, foldName(displayName), avatarUrl);
      return { ok: true, count: this.member(guildId, userId)!.count, pressedAt: now };
    })();
  }

  /**
   * Take back the member's newest press younger than the window. Returns the new
   * count, or null when there is nothing to undo. The cooldown then counts from
   * the press before it, so an accidental press does not block the real one.
   */
  undo(guildId: string, userId: string, options: { now: number; windowMs: number }): number | null {
    return this.db.transaction((): number | null => {
      const press = this.db
        .query<{ id: number }, [string, string, number]>(
          `SELECT id FROM goon_presses WHERE guild_id = ? AND user_id = ? AND undone_at IS NULL AND at >= ?
           ORDER BY id DESC LIMIT 1`,
        )
        .get(guildId, userId, options.now - options.windowMs);
      if (!press) return null;
      this.db.query('UPDATE goon_presses SET undone_at = ? WHERE id = ?').run(options.now, press.id);
      const previous = this.db
        .query<{ at: number }, [string, string]>(
          'SELECT at FROM goon_presses WHERE guild_id = ? AND user_id = ? AND undone_at IS NULL ORDER BY id DESC LIMIT 1',
        )
        .get(guildId, userId);
      this.db
        .query('UPDATE goon_members SET count = MAX(count - 1, 0), last_press_at = ? WHERE guild_id = ? AND user_id = ?')
        .run(previous?.at ?? null, guildId, userId);
      return this.member(guildId, userId)?.count ?? 0;
    })();
  }

  /**
   * The full list, ranked by count (earlier last press first on a tie), for the member page.
   * The search runs after ranking, so results keep their real place.
   */
  list(guildId: string, options: { q?: string; offset?: number; limit?: number } = {}): { entries: GoonListEntry[]; matches: number } {
    const q = foldName(options.q?.trim() ?? '');
    const limit = Math.min(Math.max(options.limit ?? 50, 1), LIST_PAGE_MAX);
    const offset = Math.max(options.offset ?? 0, 0);
    const ranked = `
      WITH ranked AS (
        SELECT user_id, count, display_name, search_name, avatar_url,
               ROW_NUMBER() OVER (ORDER BY count DESC, last_press_at ASC, user_id ASC) AS rank
        FROM goon_members WHERE guild_id = ? AND count > 0
      )`;
    const where = q ? `WHERE search_name LIKE ? ESCAPE '\\'` : '';
    const params = q ? [guildId, `%${escapeLike(q)}%`] : [guildId];
    const rows = this.db
      .query<{ user_id: string; count: number; display_name: string | null; avatar_url: string | null; rank: number }, (string | number)[]>(
        `${ranked} SELECT * FROM ranked ${where} ORDER BY rank LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset);
    const matches =
      this.db.query<{ n: number }, string[]>(`${ranked} SELECT COUNT(*) AS n FROM ranked ${where}`).get(...params)?.n ?? 0;
    return {
      entries: rows.map((row) => ({
        rank: row.rank,
        userId: row.user_id,
        count: row.count,
        displayName: row.display_name,
        avatarUrl: row.avatar_url,
      })),
      matches,
    };
  }

  /** One member's place and count, or null when they have no goons. */
  rankOf(guildId: string, userId: string): { rank: number; count: number } | null {
    return (
      this.db
        .query<{ rank: number; count: number }, [string, string]>(
          `SELECT rank, count FROM (
             SELECT user_id, count, ROW_NUMBER() OVER (ORDER BY count DESC, last_press_at ASC, user_id ASC) AS rank
             FROM goon_members WHERE guild_id = ? AND count > 0
           ) WHERE user_id = ?`,
        )
        .get(guildId, userId) ?? null
    );
  }

  top(guildId: string, limit: number): GoonTopEntry[] {
    return this.db
      .query<{ user_id: string; count: number; display_name: string | null; avatar_url: string | null }, [string, number]>(
        `SELECT user_id, count, display_name, avatar_url FROM goon_members
         WHERE guild_id = ? AND count > 0 ORDER BY count DESC, last_press_at ASC, user_id ASC LIMIT ?`,
      )
      .all(guildId, limit)
      .map((row) => ({ userId: row.user_id, count: row.count, displayName: row.display_name, avatarUrl: row.avatar_url }));
  }

  total(guildId: string): number {
    return (
      this.db.query<{ total: number | null }, [string]>('SELECT SUM(count) AS total FROM goon_members WHERE guild_id = ?').get(guildId)
        ?.total ?? 0
    );
  }

  private member(guildId: string, userId: string) {
    return this.db
      .query<MemberRow, [string, string]>('SELECT * FROM goon_members WHERE guild_id = ? AND user_id = ?')
      .get(guildId, userId);
  }

  private ensureRow(guildId: string): void {
    this.db
      .query('INSERT OR IGNORE INTO goon_settings (guild_id, settings, updated_at) VALUES (?, ?, ?)')
      .run(guildId, JSON.stringify(this.get(guildId)), Date.now());
  }

  private row(guildId: string) {
    return this.db.query<SettingsRow, [string]>('SELECT * FROM goon_settings WHERE guild_id = ?').get(guildId);
  }
}
