import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Logger } from '../logger';

export interface Migration {
  /** Unique and stable, e.g. "core_001_init" or "welcome_001_settings". Never rename an applied one. */
  id: string;
  sql: string;
}

export function openDatabase(path: string): Database {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true, strict: true });
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA synchronous = NORMAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');
  return db;
}

/** Apply migrations that have not run yet, each in its own transaction, in the given order. */
export function migrate(db: Database, migrations: Migration[], logger: Logger): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id TEXT PRIMARY KEY,
    applied_at INTEGER NOT NULL
  )`);
  const applied = new Set(
    db.query<{ id: string }, []>('SELECT id FROM schema_migrations').all().map((row) => row.id),
  );
  const seen = new Set<string>();
  for (const migration of migrations) {
    if (seen.has(migration.id)) throw new Error(`Duplicate migration id: ${migration.id}`);
    seen.add(migration.id);
    if (applied.has(migration.id)) continue;
    db.transaction(() => {
      db.exec(migration.sql);
      db.query('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)').run(migration.id, Date.now());
    })();
    logger.info('Applied database migration', { migration: migration.id });
  }
}

export const coreMigrations: Migration[] = [
  {
    id: 'core_001_init',
    sql: `
      CREATE TABLE guilds (
        guild_id TEXT PRIMARY KEY,
        locale TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        left_at INTEGER
      );
      CREATE INDEX idx_guilds_left_at ON guilds (left_at) WHERE left_at IS NOT NULL;

      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        username TEXT NOT NULL,
        global_name TEXT,
        avatar TEXT,
        access_token TEXT NOT NULL,
        csrf_token TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX idx_sessions_user_id ON sessions (user_id);
      CREATE INDEX idx_sessions_expires_at ON sessions (expires_at);
    `,
  },
];
