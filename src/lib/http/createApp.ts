import express from 'express';
import path from 'node:path';

export function createApp(options: { serveClientBuild: boolean }) {
  const app = express();

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  app.get('/api/health', (_request, response) => {
    response.json({ ok: true, service: 'shifu-bot' });
  });

  if (options.serveClientBuild) {
    const clientBuildPath = path.resolve('dist/client');
    app.use(express.static(clientBuildPath));
  }

  return app;
}
