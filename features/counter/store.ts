/**
 * Counters: database tables and queries.
 * Every press is a row, so an undo can only take back real, recent presses of
 * the same member. counter_members keeps the current count next to the name data.
 */
import type { Database } from 'bun:sqlite';
import { LruCache } from '../../apps/bot/src/core/lru-cache';
import type { PanelRef } from '../../apps/bot/src/core/panel';
import { escapeLike, foldName, namePattern } from '../../apps/bot/src/core/search';
import { counterSettingsSchema, defaultCounterSettings, type CounterEntry, type CounterSettings } from './manifest';

export const COUNTER_TABLES = ['counters', 'counter_members', 'counter_presses'];

export const COUNTER_MIGRATIONS = [
  {
    id: 'counter_001_init',
    sql: `
      CREATE TABLE counters (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        settings TEXT NOT NULL,
        panel_channel_id TEXT,
        panel_message_id TEXT,
        last_error TEXT,
        last_error_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX counters_guild ON counters (guild_id, id);
      CREATE TABLE counter_members (
        counter_id INTEGER NOT NULL,
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        count INTEGER NOT NULL DEFAULT 0,
        last_press_at INTEGER,
        display_name TEXT,
        search_name TEXT,
        avatar_url TEXT,
        PRIMARY KEY (counter_id, user_id)
      );
      CREATE INDEX counter_members_top ON counter_members (counter_id, count DESC);
      CREATE INDEX counter_members_guild ON counter_members (guild_id);
      CREATE TABLE counter_presses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        counter_id INTEGER NOT NULL,
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        at INTEGER NOT NULL,
        undone_at INTEGER
      );
      CREATE INDEX counter_presses_member ON counter_presses (counter_id, user_id, id);
      CREATE INDEX counter_presses_guild ON counter_presses (guild_id);
    `,
  },
];

export type CounterErrorCode = 'no_channel' | 'channel_missing' | 'missing_permissions' | 'send_failed';

interface CounterRow {
  id: number;
  guild_id: string;
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

export interface Counter {
  id: number;
  settings: CounterSettings;
}

export interface CounterTopEntry extends CounterEntry {
  displayName: string | null;
  avatarUrl: string | null;
}

export interface CounterListEntry extends CounterTopEntry {
  /** 1 based place on the full list. Search results keep their real place. */
  rank: number;
}

export const LIST_PAGE_MAX = 100;

export { escapeLike, foldName };

export type PressResult = { ok: true; count: number; pressedAt: number } | { ok: false; nextAt: number };

function parseSettings(json: string): CounterSettings {
  // Stored as JSON: new settings get their default without a migration.
  const parsed = counterSettingsSchema.safeParse({ ...defaultCounterSettings, ...(JSON.parse(json) as object) });
  return parsed.success ? parsed.data : defaultCounterSettings;
}

export class CounterStore {
  private readonly cache = new LruCache<number, { guildId: string; settings: CounterSettings }>(10_000);

  constructor(private readonly db: Database) {}

  /** All counters of a server, oldest first. */
  listCounters(guildId: string): Counter[] {
    return this.db
      .query<CounterRow, [string]>('SELECT * FROM counters WHERE guild_id = ? ORDER BY id')
      .all(guildId)
      .map((row) => ({ id: row.id, settings: parseSettings(row.settings) }));
  }

  /** One counter, or null when it does not exist or belongs to another server. */
  getCounter(guildId: string, counterId: number): Counter | null {
    let cached = this.cache.get(counterId);
    if (!cached) {
      const row = this.row(counterId);
      if (!row) return null;
      cached = { guildId: row.guild_id, settings: parseSettings(row.settings) };
      this.cache.set(counterId, cached);
    }
    return cached.guildId === guildId ? { id: counterId, settings: cached.settings } : null;
  }

  count(guildId: string): number {
    return this.db.query<{ n: number }, [string]>('SELECT COUNT(*) AS n FROM counters WHERE guild_id = ?').get(guildId)?.n ?? 0;
  }

  create(guildId: string, settings: CounterSettings): Counter {
    const now = Date.now();
    const row = this.db
      .query<{ id: number }, [string, string, number, number]>(
        'INSERT INTO counters (guild_id, settings, created_at, updated_at) VALUES (?, ?, ?, ?) RETURNING id',
      )
      .get(guildId, JSON.stringify(settings), now, now)!;
    return { id: row.id, settings };
  }

  save(counterId: number, settings: CounterSettings): void {
    this.db
      .query('UPDATE counters SET settings = ?, updated_at = ?, last_error = NULL, last_error_at = NULL WHERE id = ?')
      .run(JSON.stringify(settings), Date.now(), counterId);
    this.cache.delete(counterId);
  }

  /** Remove a counter with its counts and presses. Other servers' counters are out of reach. */
  delete(guildId: string, counterId: number): void {
    this.db.transaction(() => {
      this.db.query('DELETE FROM counter_presses WHERE counter_id = ? AND guild_id = ?').run(counterId, guildId);
      this.db.query('DELETE FROM counter_members WHERE counter_id = ? AND guild_id = ?').run(counterId, guildId);
      this.db.query('DELETE FROM counters WHERE id = ? AND guild_id = ?').run(counterId, guildId);
    })();
    this.cache.delete(counterId);
  }

  panel(counterId: number): PanelRef | null {
    const row = this.row(counterId);
    return row?.panel_channel_id && row.panel_message_id ? { channelId: row.panel_channel_id, messageId: row.panel_message_id } : null;
  }

  setPanel(counterId: number, panel: PanelRef | null): void {
    this.db
      .query('UPDATE counters SET panel_channel_id = ?, panel_message_id = ? WHERE id = ?')
      .run(panel?.channelId ?? null, panel?.messageId ?? null, counterId);
  }

  setError(counterId: number, code: CounterErrorCode | null): void {
    this.db.query('UPDATE counters SET last_error = ?, last_error_at = ? WHERE id = ?').run(code, code ? Date.now() : null, counterId);
  }

  lastError(counterId: number): { code: CounterErrorCode; at: number } | null {
    const row = this.row(counterId);
    return row?.last_error && row.last_error_at ? { code: row.last_error as CounterErrorCode, at: row.last_error_at } : null;
  }

  /** Count one press, unless the member's last press is within the cooldown. */
  press(
    counterId: number,
    guildId: string,
    userId: string,
    options: { now: number; cooldownMs: number; displayName: string; avatarUrl: string | null },
  ): PressResult {
    const { now, cooldownMs, displayName, avatarUrl } = options;
    return this.db.transaction((): PressResult => {
      const last = this.member(counterId, userId)?.last_press_at ?? null;
      if (last !== null && now - last < cooldownMs) return { ok: false, nextAt: last + cooldownMs };
      this.db.query('INSERT INTO counter_presses (counter_id, guild_id, user_id, at) VALUES (?, ?, ?, ?)').run(counterId, guildId, userId, now);
      this.db
        .query(
          `INSERT INTO counter_members (counter_id, guild_id, user_id, count, last_press_at, display_name, search_name, avatar_url)
           VALUES (?, ?, ?, 1, ?, ?, ?, ?)
           ON CONFLICT (counter_id, user_id) DO UPDATE SET count = count + 1, last_press_at = excluded.last_press_at,
             display_name = excluded.display_name, search_name = excluded.search_name, avatar_url = excluded.avatar_url`,
        )
        .run(counterId, guildId, userId, now, displayName, foldName(displayName), avatarUrl);
      return { ok: true, count: this.member(counterId, userId)!.count, pressedAt: now };
    })();
  }

  /**
   * Take back the member's newest press younger than the window. Returns the new
   * count, or null when there is nothing to undo. The cooldown then counts from
   * the press before it, so an accidental press does not block the real one.
   */
  undo(counterId: number, userId: string, options: { now: number; windowMs: number }): number | null {
    return this.db.transaction((): number | null => {
      const press = this.db
        .query<{ id: number }, [number, string, number]>(
          `SELECT id FROM counter_presses WHERE counter_id = ? AND user_id = ? AND undone_at IS NULL AND at >= ?
           ORDER BY id DESC LIMIT 1`,
        )
        .get(counterId, userId, options.now - options.windowMs);
      if (!press) return null;
      this.db.query('UPDATE counter_presses SET undone_at = ? WHERE id = ?').run(options.now, press.id);
      const previous = this.db
        .query<{ at: number }, [number, string]>(
          'SELECT at FROM counter_presses WHERE counter_id = ? AND user_id = ? AND undone_at IS NULL ORDER BY id DESC LIMIT 1',
        )
        .get(counterId, userId);
      this.db
        .query('UPDATE counter_members SET count = MAX(count - 1, 0), last_press_at = ? WHERE counter_id = ? AND user_id = ?')
        .run(previous?.at ?? null, counterId, userId);
      return this.member(counterId, userId)?.count ?? 0;
    })();
  }

  /**
   * The full list, ranked by count (earlier last press first on a tie), for the member page.
   * The search runs after ranking, so results keep their real place.
   */
  list(counterId: number, options: { q?: string; offset?: number; limit?: number } = {}): { entries: CounterListEntry[]; matches: number } {
    const pattern = namePattern(options.q);
    const limit = Math.min(Math.max(options.limit ?? 50, 1), LIST_PAGE_MAX);
    const offset = Math.max(options.offset ?? 0, 0);
    const ranked = `
      WITH ranked AS (
        SELECT user_id, count, display_name, search_name, avatar_url,
               ROW_NUMBER() OVER (ORDER BY count DESC, last_press_at ASC, user_id ASC) AS rank
        FROM counter_members WHERE counter_id = ? AND count > 0
      )`;
    const where = pattern ? `WHERE search_name LIKE ? ESCAPE '\\'` : '';
    const params: (string | number)[] = pattern ? [counterId, pattern] : [counterId];
    const rows = this.db
      .query<{ user_id: string; count: number; display_name: string | null; avatar_url: string | null; rank: number }, (string | number)[]>(
        `${ranked} SELECT * FROM ranked ${where} ORDER BY rank LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset);
    const matches =
      this.db.query<{ n: number }, (string | number)[]>(`${ranked} SELECT COUNT(*) AS n FROM ranked ${where}`).get(...params)?.n ?? 0;
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

  /** One member's place and count, or null when they have not counted anything. */
  rankOf(counterId: number, userId: string): { rank: number; count: number } | null {
    return (
      this.db
        .query<{ rank: number; count: number }, [number, string]>(
          `SELECT rank, count FROM (
             SELECT user_id, count, ROW_NUMBER() OVER (ORDER BY count DESC, last_press_at ASC, user_id ASC) AS rank
             FROM counter_members WHERE counter_id = ? AND count > 0
           ) WHERE user_id = ?`,
        )
        .get(counterId, userId) ?? null
    );
  }

  top(counterId: number, limit: number): CounterTopEntry[] {
    return this.db
      .query<{ user_id: string; count: number; display_name: string | null; avatar_url: string | null }, [number, number]>(
        `SELECT user_id, count, display_name, avatar_url FROM counter_members
         WHERE counter_id = ? AND count > 0 ORDER BY count DESC, last_press_at ASC, user_id ASC LIMIT ?`,
      )
      .all(counterId, limit)
      .map((row) => ({ userId: row.user_id, count: row.count, displayName: row.display_name, avatarUrl: row.avatar_url }));
  }

  total(counterId: number): number {
    return (
      this.db.query<{ total: number | null }, [number]>('SELECT SUM(count) AS total FROM counter_members WHERE counter_id = ?').get(counterId)
        ?.total ?? 0
    );
  }

  /** Panels of the old goon counter, if its tables are still there. */
  legacyGoonPanels(): { guildId: string; panel: PanelRef }[] {
    if (!this.hasLegacyGoonTables()) return [];
    return this.db
      .query<{ guild_id: string; panel_channel_id: string; panel_message_id: string }, []>(
        'SELECT guild_id, panel_channel_id, panel_message_id FROM goon_settings WHERE panel_channel_id IS NOT NULL AND panel_message_id IS NOT NULL',
      )
      .all()
      .map((row) => ({ guildId: row.guild_id, panel: { channelId: row.panel_channel_id, messageId: row.panel_message_id } }));
  }

  hasLegacyGoonTables(): boolean {
    return Boolean(this.db.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'goon_settings'").get());
  }

  dropLegacyGoonTables(): void {
    this.db.exec('DROP TABLE IF EXISTS goon_presses; DROP TABLE IF EXISTS goon_members; DROP TABLE IF EXISTS goon_settings;');
  }

  private member(counterId: number, userId: string) {
    return this.db
      .query<MemberRow, [number, string]>('SELECT * FROM counter_members WHERE counter_id = ? AND user_id = ?')
      .get(counterId, userId);
  }

  private row(counterId: number) {
    return this.db.query<CounterRow, [number]>('SELECT * FROM counters WHERE id = ?').get(counterId);
  }
}
