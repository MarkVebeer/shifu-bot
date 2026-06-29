import 'dotenv/config';

import http from 'node:http';
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
  const clientBuildPath = path.resolve('dist/client');
  const isDevLifecycle = process.env.npm_lifecycle_event === 'dev' || process.env.npm_lifecycle_event === 'dev:server';
  const serveClientBuild = !isDevLifecycle && fs.existsSync(clientBuildPath);
  const app = createApp({ serveClientBuild });
  const server = http.createServer(app);

  createAuth(app, { client, database });
  await loadFeatures({ app, client, database });

  if (serveClientBuild) {
    app.get('/dashboard', (_request, response) => {
      response.sendFile(path.join(clientBuildPath, 'index.html'));
    });

    app.get('/dashboard/guild/:guildId', (_request, response) => {
      response.sendFile(path.join(clientBuildPath, 'index.html'));
    });

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
  } else {
    const { createServer: createViteServer } = await import('vite');
    const clientIndexPath = path.resolve('frontend/index.html');
    const vite = await createViteServer({
      root: path.resolve('frontend'),
      appType: 'custom',
      server: {
        middlewareMode: true,
        hmr: {
          server
        }
      }
    });

    app.use(vite.middlewares);
    app.get('/dashboard', (_request, response, next) => {
      vite.transformIndexHtml('/dashboard', fs.readFileSync(clientIndexPath, 'utf8'))
        .then((html) => response.status(200).set({ 'Content-Type': 'text/html' }).end(html))
        .catch(next);
    });

    app.get('/dashboard/guild/:guildId', (_request, response, next) => {
      vite.transformIndexHtml('/dashboard/guild', fs.readFileSync(clientIndexPath, 'utf8'))
        .then((html) => response.status(200).set({ 'Content-Type': 'text/html' }).end(html))
        .catch(next);
    });

    app.use(async (request, response, next) => {
      if (request.method !== 'GET') {
        next();
        return;
      }

      if (request.path.startsWith('/api') || request.path.startsWith('/auth')) {
        next();
        return;
      }

      const html = fs.readFileSync(clientIndexPath, 'utf8');
      const transformedHtml = await vite.transformIndexHtml(request.originalUrl, html);

      response.status(200).set({ 'Content-Type': 'text/html' }).end(transformedHtml);
    });
  }

  const port = Number(process.env.PORT ?? 3000);

  server.listen(port, () => {
    console.log(`Dashboard listening on http://localhost:${port}`);
  });

  await client.login(process.env.DISCORD_TOKEN);
}
main().catch((error) => {
  console.error('Failed to start shifu-bot', error);
  process.exitCode = 1;
});
