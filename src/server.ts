import 'dotenv/config';

import fs from 'node:fs';
import path from 'node:path';

import { createApp } from './lib/http/createApp.js';
import { createDatabase } from './lib/database/createDatabase.js';
import { createDiscordClient } from './lib/discord/createDiscordClient.js';
import { loadFeatures } from './lib/loader/loadFeatures.js';
import { createAuth } from './lib/auth/createAuth.js';

async function main() {
  const database = createDatabase(process.env.DATABASE_PATH ?? './data/shifu-bot.db');
  const client = createDiscordClient();
  const app = createApp();

  createAuth(app, { client, database });
  await loadFeatures({ app, client, database });

  const clientBuildPath = path.resolve('dist/client');
  if (fs.existsSync(clientBuildPath)) {
    app.use((request, response, next) => {
      if (request.method !== 'GET') {
        next();
        return;
      }

      if (request.path.startsWith('/api') || request.path.startsWith('/auth')) {
        next();
        return;
      }

      response.sendFile(path.join(clientBuildPath, 'index.html'));
    });
  }

  const port = Number(process.env.PORT ?? 3000);

  app.listen(port, () => {
    console.log(`Dashboard listening on http://localhost:${port}`);
  });

  await client.login(process.env.DISCORD_TOKEN);
}
main().catch((error) => {
  console.error('Failed to start shifu-bot', error);
  process.exitCode = 1;
});
