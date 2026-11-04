import { coreMessages, type ApiErrorBody, type ConfigResponse } from '@shifubot/shared';
import { DiscordAPIError } from 'discord.js';
import { Hono } from 'hono';
import { serveStatic } from 'hono/bun';
import { secureHeaders } from 'hono/secure-headers';
import { existsSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import type { AppContext, FeatureInstance, ServerFeature } from '../core/feature';
import { authRoutes, sessionApiRoutes } from './auth-routes';
import { localeFromCookie, renderErrorPage } from './error-page';
import { ApiError } from './errors';
import { guildRoutes } from './guild-routes';
import { memberRoutes } from './member-routes';
import { rateLimit, requestLogger } from './middleware';
import { SessionStore } from './session';

const WEB_DIST = resolve(import.meta.dir, '../../../web/dist');

export function createHttpApp(ctx: AppContext, features: { feature: ServerFeature; instance: FeatureInstance }[]) {
  const { config, logger, client, db } = ctx;
  const sessions = new SessionStore(db, config);
  const app = new Hono();
  const startedAt = Date.now();

  app.use('*', requestLogger(logger));
  app.use(
    '*',
    secureHeaders({
      contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'https:', 'http:'],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        fontSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
      strictTransportSecurity: config.secureCookies ? 'max-age=15552000; includeSubDomains' : false,
      crossOriginEmbedderPolicy: false,
    }),
  );

  app.get('/healthz', (c) => {
    let database = 'ok';
    try {
      db.query('SELECT 1').get();
    } catch {
      database = 'error';
    }
    const discord = config.botDisabled ? 'disabled' : client.isReady() ? 'ready' : 'connecting';
    const healthy = database === 'ok';
    return c.json(
      {
        status: healthy ? 'ok' : 'error',
        discord,
        database,
        guilds: client.isReady() ? client.guilds.cache.size : 0,
        queue: ctx.queue.size,
        uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
        memoryMb: Math.round(process.memoryUsage().rss / 1_048_576),
      },
      healthy ? 200 : 503,
    );
  });

  app.use('/auth/*', rateLimit(config, { perMinute: 20, name: 'sign in' }));
  app.route('/auth', authRoutes(ctx, sessions));

  app.use('/api/*', rateLimit(config, { perMinute: 180, name: 'the API' }));
  app.get('/api/config', (c) => {
    const body: ConfigResponse = {
      clientId: config.discord.clientId,
      defaultLocale: config.defaultLocale,
      botReady: client.isReady(),
    };
    return c.json(body);
  });
  app.route('/api', sessionApiRoutes(ctx, sessions));
  app.route('/api/guilds', guildRoutes(ctx, sessions, features));
  app.route('/api/servers', memberRoutes(ctx, sessions, features));
  app.all('/api/*', () => {
    throw new ApiError(404, 'not_found', 'Unknown API route');
  });

  // Dashboard (built by `bun run build`), with SPA fallback to index.html.
  const webBuilt = existsSync(join(WEB_DIST, 'index.html'));
  if (!webBuilt) logger.warn('Dashboard is not built yet. Run `bun run build` to serve it.', { path: WEB_DIST });
  const root = relative(process.cwd(), WEB_DIST) || '.';
  app.use(
    '/assets/*',
    serveStatic({
      root,
      onFound: (_path, c) => c.header('Cache-Control', 'public, max-age=31536000, immutable'),
    }),
  );
  app.get('/assets/*', (c) => c.text('Not found', 404));
  app.use('*', serveStatic({ root }));
  app.get('*', serveStatic({ root, path: 'index.html', onFound: (_path, c) => c.header('Cache-Control', 'no-cache') }));
  app.get('*', (c) => {
    const locale = localeFromCookie(c.req.header('cookie'), config.defaultLocale);
    const texts = coreMessages[locale].errors;
    return c.html(renderErrorPage({ status: 404, title: texts.notFound, message: texts.notFoundBody, locale }), 404);
  });

  app.onError((error, c) => {
    const requestId = c.res.headers.get('x-request-id') ?? undefined;
    let apiError: ApiError;
    if (error instanceof ApiError) apiError = error;
    else if (error instanceof DiscordAPIError && error.status === 403) {
      apiError = new ApiError(403, 'missing_permissions', `Discord refused the action: ${error.message}`);
    } else {
      logger.error('Unhandled error', { error, path: c.req.path, requestId });
      apiError = new ApiError(500, 'internal', 'Unexpected server error. It was logged.');
    }
    if (apiError.status >= 500 && error instanceof ApiError) logger.error('API error', { error, path: c.req.path });

    if (!c.req.path.startsWith('/api/')) {
      const locale = localeFromCookie(c.req.header('cookie'), config.defaultLocale);
      const texts = coreMessages[locale].errors;
      return c.html(
        renderErrorPage({ status: apiError.status, title: texts.title, message: apiError.message, locale }),
        apiError.status,
      );
    }
    const body: ApiErrorBody = {
      error: { code: apiError.code, message: apiError.message, details: apiError.details },
    };
    return c.json(body, apiError.status);
  });

  return app;
}
