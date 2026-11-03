import type { Database } from 'bun:sqlite';
import { isLocale, type GuildSettings, type Locale } from '@shifubot/shared';
import { LruCache } from './lru-cache';

interface GuildRow {
  guild_id: string;
  locale: string;
  left_at: number | null;
  setup_completed_at: number | null;
}

interface GuildRecord {
  settings: GuildSettings;
  /** False until an admin finished the first run setup in the dashboard. */
  setupCompleted: boolean;
}

/** Core per server settings (language, setup state) with an in memory cache that is cleared on every save. */
export class GuildSettingsStore {
  private readonly cache = new LruCache<string, GuildRecord>(10_000);

  constructor(
    private readonly db: Database,
    private readonly defaultLocale: Locale,
  ) {}

  private record(guildId: string): GuildRecord {
    const cached = this.cache.get(guildId);
    if (cached) return cached;
    const row = this.db
      .query<GuildRow, [string]>('SELECT guild_id, locale, left_at, setup_completed_at FROM guilds WHERE guild_id = ?')
      .get(guildId);
    const record: GuildRecord = {
      settings: { locale: row && isLocale(row.locale) ? row.locale : this.defaultLocale },
      setupCompleted: row?.setup_completed_at != null,
    };
    this.cache.set(guildId, record);
    return record;
  }

  get(guildId: string): GuildSettings {
    return this.record(guildId).settings;
  }

  locale(guildId: string): Locale {
    return this.get(guildId).locale;
  }

  isSetupCompleted(guildId: string): boolean {
    return this.record(guildId).setupCompleted;
  }

  /**
   * Create default settings for a new server, or revive a server that came back.
   * A server that removed the bot and added it again goes through setup again.
   */
  ensure(guildId: string): void {
    const now = Date.now();
    this.db
      .query(
        `INSERT INTO guilds (guild_id, locale, created_at, updated_at, left_at, setup_completed_at)
         VALUES (?, ?, ?, ?, NULL, NULL)
         ON CONFLICT (guild_id) DO UPDATE SET
           setup_completed_at = CASE WHEN left_at IS NULL THEN setup_completed_at ELSE NULL END,
           left_at = NULL`,
      )
      .run(guildId, this.defaultLocale, now, now);
    this.cache.delete(guildId);
  }

  save(guildId: string, settings: GuildSettings): GuildSettings {
    const now = Date.now();
    this.db
      .query(
        `INSERT INTO guilds (guild_id, locale, created_at, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (guild_id) DO UPDATE SET locale = excluded.locale, updated_at = excluded.updated_at`,
      )
      .run(guildId, settings.locale, now, now);
    this.cache.delete(guildId);
    return this.get(guildId);
  }

  completeSetup(guildId: string): void {
    const now = Date.now();
    this.db
      .query(
        `INSERT INTO guilds (guild_id, locale, created_at, updated_at, setup_completed_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (guild_id) DO UPDATE SET setup_completed_at = excluded.setup_completed_at, updated_at = excluded.updated_at`,
      )
      .run(guildId, this.defaultLocale, now, now, now);
    this.cache.delete(guildId);
  }

  /** The bot was removed: keep the data for a grace period, then the cleanup job deletes it. */
  markLeft(guildId: string): void {
    this.db.query('UPDATE guilds SET left_at = ? WHERE guild_id = ?').run(Date.now(), guildId);
    this.cache.delete(guildId);
  }
}
