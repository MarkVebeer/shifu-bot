import type { Database } from 'bun:sqlite';
import { isLocale, type GuildSettings, type Locale } from '@shifubot/shared';
import { LruCache } from './lru-cache';

interface GuildRow {
  guild_id: string;
  locale: string;
  left_at: number | null;
}

/** Core per server settings (language) with an in memory cache that is cleared on every save. */
export class GuildSettingsStore {
  private readonly cache = new LruCache<string, GuildSettings>(10_000);

  constructor(
    private readonly db: Database,
    private readonly defaultLocale: Locale,
  ) {}

  get(guildId: string): GuildSettings {
    const cached = this.cache.get(guildId);
    if (cached) return cached;
    const row = this.db
      .query<GuildRow, [string]>('SELECT guild_id, locale, left_at FROM guilds WHERE guild_id = ?')
      .get(guildId);
    const settings: GuildSettings = { locale: row && isLocale(row.locale) ? row.locale : this.defaultLocale };
    this.cache.set(guildId, settings);
    return settings;
  }

  locale(guildId: string): Locale {
    return this.get(guildId).locale;
  }

  /** Create default settings for a new server, or revive a server that came back. */
  ensure(guildId: string): void {
    const now = Date.now();
    this.db
      .query(
        `INSERT INTO guilds (guild_id, locale, created_at, updated_at, left_at) VALUES (?, ?, ?, ?, NULL)
         ON CONFLICT (guild_id) DO UPDATE SET left_at = NULL`,
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

  /** The bot was removed: keep the data for a grace period, then the cleanup job deletes it. */
  markLeft(guildId: string): void {
    this.db.query('UPDATE guilds SET left_at = ? WHERE guild_id = ?').run(Date.now(), guildId);
    this.cache.delete(guildId);
  }
}
