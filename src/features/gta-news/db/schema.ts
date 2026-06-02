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
