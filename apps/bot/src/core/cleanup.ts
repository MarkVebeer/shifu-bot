import type { Database } from 'bun:sqlite';
import type { Logger } from '../logger';
import type { ServerFeature } from './feature';

/**
 * Delete data of servers that removed the bot more than `afterDays` ago,
 * and expired login sessions. Runs on start and then every 6 hours.
 */
export function startCleanupJob(db: Database, features: ServerFeature[], afterDays: number, logger: Logger) {
  const tables = features.flatMap((feature) => feature.tables);
  for (const table of tables) {
    if (!/^[a-z_][a-z0-9_]*$/.test(table)) throw new Error(`Invalid table name for cleanup: ${table}`);
  }

  const run = () => {
    try {
      const cutoff = Date.now() - afterDays * 86_400_000;
      const guildIds = db
        .query<{ guild_id: string }, [number]>('SELECT guild_id FROM guilds WHERE left_at IS NOT NULL AND left_at < ?')
        .all(cutoff)
        .map((row) => row.guild_id);
      db.transaction(() => {
        for (const guildId of guildIds) {
          for (const table of tables) db.query(`DELETE FROM ${table} WHERE guild_id = ?`).run(guildId);
          db.query('DELETE FROM guilds WHERE guild_id = ?').run(guildId);
        }
        db.query('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
      })();
      if (guildIds.length) logger.info('Cleaned up data of servers that removed the bot', { count: guildIds.length });
    } catch (error) {
      logger.error('Cleanup job failed', { error });
    }
  };

  run();
  return setInterval(run, 6 * 3_600_000);
}
