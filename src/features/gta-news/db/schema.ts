import type { SqliteDatabase } from '../../../lib/database/types.js';

export interface GtaNewsSettings {
  guildId: string;
  channelId: string | null;
  enabled: boolean;
}

export function ensureGtaNewsTable(database: SqliteDatabase) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS gta_news_settings (
      guild_id TEXT PRIMARY KEY,
      channel_id TEXT,
      enabled INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (guild_id) REFERENCES guild_settings(guild_id) ON DELETE CASCADE
    );
  `);
}

export function getGtaNewsSettings(database: SqliteDatabase, guildId: string): GtaNewsSettings | undefined {
  const statement = database.prepare(`
    SELECT guild_id AS guildId, channel_id AS channelId, enabled
    FROM gta_news_settings
    WHERE guild_id = ?
  `);

  return statement.get(guildId) as GtaNewsSettings | undefined;
}

export function setGtaNewsSettings(database: SqliteDatabase, guildId: string, channelId: string | null, enabled = true) {
  // ensure guild_settings row exists to satisfy foreign key constraint
  const ensureGuild = database.prepare(`INSERT OR IGNORE INTO guild_settings (guild_id) VALUES (?)`);
  ensureGuild.run(guildId);

  const statement = database.prepare(`
    INSERT INTO gta_news_settings (guild_id, channel_id, enabled, created_at, updated_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT(guild_id) DO UPDATE SET
      channel_id = excluded.channel_id,
      enabled = excluded.enabled,
      updated_at = CURRENT_TIMESTAMP
  `);

  return statement.run(guildId, channelId, enabled ? 1 : 0);
}
