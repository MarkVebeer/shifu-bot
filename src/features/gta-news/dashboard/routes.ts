import type { Express } from 'express';
import type { SqliteDatabase } from '../../../lib/database/types.js';
import { getGtaNewsSettings } from '../db/schema.js';

export function registerGtaNewsRoutes(app: Express, database: SqliteDatabase) {
  app.get('/api/features/gta-news/:guildId', (request, response) => {
    const settings = getGtaNewsSettings(database, request.params.guildId);

    response.json({
      guildId: request.params.guildId,
      settings: settings ?? null
    });
  });
}
