import { coreMessages, type MeResponse } from '@shifubot/shared';
import { Hono } from 'hono';
import { deleteCookie, getSignedCookie, setSignedCookie } from 'hono/cookie';
import { z } from 'zod';
import type { AppContext } from '../core/feature';
import { authorizeUrl, exchangeCode, fetchUser, revokeToken, userAvatarUrl } from './discord-oauth';
import { localeFromCookie, renderErrorPage } from './error-page';
import { csrfProtection, requireSession } from './middleware';
import { randomToken, type Session, type SessionStore } from './session';

const STATE_COOKIE = 'shifu_oauth_state';
const NEXT_COOKIE = 'shifu_oauth_next';
const DEFAULT_NEXT = '/guilds';

/**
 * Where to go after signing in. Only paths on this site are allowed, so the
 * login link cannot be used to send people to another website.
 */
export function safeNextPath(raw: string | undefined | null): string {
  if (!raw || raw.length > 512) return DEFAULT_NEXT;
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return DEFAULT_NEXT;
  // Control characters (including tabs and newlines) can turn a path into another URL in some browsers.
  if ([...raw].some((char) => char.charCodeAt(0) < 0x20 || char.charCodeAt(0) === 0x7f)) return DEFAULT_NEXT;
  return raw;
}

const callbackSchema = z.union([
  z.object({ code: z.string().min(1).max(512), state: z.string().min(1).max(256) }),
  z.object({ error: z.string().max(256), state: z.string().max(256).optional() }),
]);

/** Browser facing OAuth2 routes: /auth/login and /auth/callback. */
export function authRoutes(ctx: AppContext, sessions: SessionStore) {
  const { config, logger } = ctx;
  const app = new Hono();

  app.get('/login', async (c) => {
    const state = randomToken(24);
    await setSignedCookie(c, STATE_COOKIE, state, config.sessionSecret, {
      httpOnly: true,
      secure: config.secureCookies,
      sameSite: 'Lax',
      path: '/auth',
      maxAge: 600,
    });
    const next = safeNextPath(c.req.query('next'));
    if (next !== DEFAULT_NEXT) {
      await setSignedCookie(c, NEXT_COOKIE, next, config.sessionSecret, {
        httpOnly: true,
        secure: config.secureCookies,
        sameSite: 'Lax',
        path: '/auth',
        maxAge: 600,
      });
    } else {
      deleteCookie(c, NEXT_COOKIE, { path: '/auth', secure: config.secureCookies });
    }
    return c.redirect(authorizeUrl(config, state));
  });

  app.get('/callback', async (c) => {
    const locale = localeFromCookie(c.req.header('cookie'), config.defaultLocale);
    const fail = (reason: string, extra?: Record<string, unknown>) => {
      logger.warn('OAuth login failed', { reason, ...extra });
      const texts = coreMessages[locale].errors;
      return c.html(renderErrorPage({ status: 400, title: texts.title, message: texts.oauth_failed, locale }), 400);
    };

    const query = callbackSchema.safeParse(c.req.query());
    if (!query.success) return fail('invalid callback query');
    if ('error' in query.data) return fail('user denied or Discord error', { error: query.data.error });

    const expected = await getSignedCookie(c, config.sessionSecret, STATE_COOKIE);
    deleteCookie(c, STATE_COOKIE, { path: '/auth', secure: config.secureCookies });
    if (!expected || expected !== query.data.state) return fail('state mismatch');

    try {
      const token = await exchangeCode(config, query.data.code);
      const user = await fetchUser(token.access_token);
      const session = sessions.create({
        userId: user.id,
        username: user.username,
        globalName: user.global_name ?? null,
        avatar: user.avatar ?? null,
        accessToken: token.access_token,
        expiresAt: Date.now() + Math.min(token.expires_in, 7 * 86_400) * 1000,
      });
      await sessions.writeCookie(c, session);
      logger.info('User signed in', { userId: user.id });
      const next = safeNextPath((await getSignedCookie(c, config.sessionSecret, NEXT_COOKIE)) || null);
      deleteCookie(c, NEXT_COOKIE, { path: '/auth', secure: config.secureCookies });
      return c.redirect(next);
    } catch (error) {
      return fail('token exchange failed', { error });
    }
  });

  return app;
}

/** JSON API for the current session: /api/me and /api/auth/logout. */
export function sessionApiRoutes(ctx: AppContext, sessions: SessionStore) {
  const app = new Hono<{ Variables: { session: Session } }>();
  for (const path of ['/me', '/auth/*']) app.use(path, requireSession(sessions), csrfProtection(ctx.config));

  app.get('/me', (c) => {
    const session = c.get('session');
    const body: MeResponse = {
      user: {
        id: session.userId,
        username: session.username,
        globalName: session.globalName,
        avatarUrl: userAvatarUrl({ id: session.userId, avatar: session.avatar }),
      },
      csrfToken: session.csrfToken,
    };
    c.header('Cache-Control', 'no-store');
    return c.json(body);
  });

  app.post('/auth/logout', async (c) => {
    const session = c.get('session');
    sessions.delete(session.id);
    sessions.clearCookie(c);
    void revokeToken(ctx.config, session.accessToken);
    return c.json({ ok: true });
  });

  return app;
}
