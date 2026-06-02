import type { Client } from 'discord.js';
import type { SqliteDatabase } from '../../../../lib/database/types.js';

export function registerGtaNewsEvents(client: Client, _database: SqliteDatabase) {
  client.once('clientReady', () => {
    console.log('gta-news feature ready');
  });
}
