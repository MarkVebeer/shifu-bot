import express from 'express';
import path from 'node:path';
import fs from 'node:fs';

export function createApp() {
  const app = express();

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  app.get('/api/health', (_request, response) => {
    response.json({ ok: true, service: 'shifu-bot' });
  });

  const clientBuildPath = path.resolve('dist/client');
  if (fs.existsSync(clientBuildPath)) {
    app.use(express.static(clientBuildPath));
    // Removed SPA fallback from createApp
    // Fallback will be handled in server.ts
  }

  return app;
}
