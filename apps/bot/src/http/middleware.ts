import type { Context, MiddlewareHandler } from 'hono';
import { timingSafeEqual } from 'node:crypto';
import type { Config } from '../config';
import type { Logger } from '../logger';
import { ApiError } from './errors';
import type { Session, SessionStore } from './session';

/**
 * The client's address from an X-Forwarded-For header. Each proxy appends the address it saw, so
 * only the rightmost `hops` entries come from our own proxies. Anything left of them is whatever
 * the client sent, and using it would let anyone dodge the rate limit with made up addresses.
 */
export function forwardedClientIp(header: string | undefined, hops: number): string | undefined {
  const entries = header?.split(',').map((entry) => entry.trim()).filter(Boolean) ?? [];
  return entries[Math.max(entries.length - hops, 0)];
}

/** Client IP, honouring X-Forwarded-For only when TRUST_PROXY is on. */
export function clientIp(c: Context, config: Config): string {
  if (config.trustProxy) {
    const forwarded = forwardedClientIp(c.req.header('x-forwarded-for'), config.trustProxyHops);
    if (forwarded) return forwarded;
    const real = c.req.header('x-real-ip');
    if (real) return real;
  }
  const info = (c.env as { server?: { requestIP?: (req: Request) => { address: string } | null } } | undefined)?.server;
  return info?.requestIP?.(c.req.raw)?.address ?? 'unknown';
}

export function requestLogger(logger: Logger): MiddlewareHandler {
  return async (c, next) => {
    const requestId = c.req.header('x-request-id') ?? crypto.randomUUID();
    c.set('requestId' as never, requestId as never);
    c.header('x-request-id', requestId);
    const started = performance.now();
    await next();
    const ms = Math.round(performance.now() - started);
    const fields = { requestId, method: c.req.method, path: c.req.path, status: c.res.status, ms };
    if (c.res.status >= 500) logger.error('Request failed', fields);
    else if (c.req.path !== '/healthz') logger.debug('Request', fields);
  };
}

/** Token bucket rate limiter keyed by client IP. */
export function rateLimit(config: Config, options: { perMinute: number; name: string }): MiddlewareHandler {
  const buckets = new Map<string, { tokens: number; updated: number }>();
  const refillPerMs = options.perMinute / 60_000;
  setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets) if (now - bucket.updated > 120_000) buckets.delete(key);
  }, 60_000).unref();

  return async (c, next) => {
    const key = clientIp(c, config);
    const now = Date.now();
    const bucket = buckets.get(key) ?? { tokens: options.perMinute, updated: now };
    bucket.tokens = Math.min(options.perMinute, bucket.tokens + (now - bucket.updated) * refillPerMs);
    bucket.updated = now;
    if (bucket.tokens < 1) {
      buckets.set(key, bucket);
      c.header('Retry-After', String(Math.ceil((1 - bucket.tokens) / refillPerMs / 1000)));
      throw new ApiError(429, 'rate_limited', `Too many requests to ${options.name}. Try again shortly.`);
    }
    bucket.tokens -= 1;
    buckets.set(key, bucket);
    await next();
  };
}

export function requireSession(sessions: SessionStore): MiddlewareHandler<{ Variables: { session: Session } }> {
  return async (c, next) => {
    const session = await sessions.read(c);
    if (!session) throw new ApiError(401, 'unauthorized', 'You are not signed in');
    c.set('session', session);
    await next();
  };
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * CSRF protection for state changing requests: the Origin must match PUBLIC_URL
 * and the X-CSRF-Token header must match the token stored in the session.
 */
export function csrfProtection(config: Config): MiddlewareHandler<{ Variables: { session: Session } }> {
  return async (c, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) return next();
    const origin = c.req.header('origin');
    const allowed = new Set([config.publicOrigin]);
    if (!config.isProduction) allowed.add('http://localhost:5173');
    if (origin && !allowed.has(origin)) throw new ApiError(403, 'csrf', `Origin ${origin} is not allowed`);
    const token = c.req.header('x-csrf-token') ?? '';
    if (!safeEqual(token, c.get('session').csrfToken)) {
      throw new ApiError(403, 'csrf', 'Missing or invalid CSRF token');
    }
    await next();
  };
}
