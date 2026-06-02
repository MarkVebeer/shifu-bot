import type { FeatureContext, FeatureModule } from '../../lib/loader/loadFeatures.js';
import { registerGtaNewsRoutes } from './dashboard/routes.js';
import { ensureGtaNewsTable } from './db/schema.js';
import { registerGtaNewsEvents } from './bot/events/ready.js';
import { registerGtaNewsCommand } from './bot/commands/news.js';

const feature: FeatureModule = {
  name: 'gta-news',
  register(context: FeatureContext) {
    const { app, client, database } = context;
    ensureGtaNewsTable(database);
    registerGtaNewsRoutes(app, database);
    registerGtaNewsEvents(client, database);
    registerGtaNewsCommand(client, database);
  }
};

export default feature;
