import type { Database } from 'bun:sqlite';
import type { Context } from 'hono';
import { deleteCookie, getSignedCookie, setSignedCookie } from 'hono/cookie';
import type { Config } from '../config';
import { LruCache } from '../core/lru-cache';

export const SESSION_COOKIE = 'shifu_session';

export interface Session {
  id: string;
  userId: string;
  username: string;
  globalName: string | null;
  avatar: string | null;
  accessToken: string;
  csrfToken: string;
  expiresAt: number;
}

/** The name to show for the signed in user, for example in the audit log. */
export const sessionName = (session: Pick<Session, 'globalName' | 'username'>) => session.globalName ?? session.username;

interface SessionRow {
  id: string;
  user_id: string;
  username: string;
  global_name: string | null;
  avatar: string | null;
  access_token: string;
  csrf_token: string;
  expires_at: number;
}

function randomToken(bytes = 32): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(bytes))).toString('base64url');
}

/** Server side sessions. The browser only holds a signed, httpOnly cookie with the session id. */
export class SessionStore {
  private readonly cache = new LruCache<string, Session>(5_000, 60_000);

  constructor(
    private readonly db: Database,
    private readonly config: Config,
  ) {}

  create(input: Omit<Session, 'id' | 'csrfToken'>): Session {
    const session: Session = { ...input, id: randomToken(), csrfToken: randomToken() };
    this.db
      .query(
        `INSERT INTO sessions (id, user_id, username, global_name, avatar, access_token, csrf_token, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        session.id,
        session.userId,
        session.username,
        session.globalName,
        session.avatar,
        session.accessToken,
        session.csrfToken,
        session.expiresAt,
        Date.now(),
      );
    return session;
  }

  get(id: string): Session | null {
    const cached = this.cache.get(id);
    if (cached && cached.expiresAt > Date.now()) return cached;
    const row = this.db.query<SessionRow, [string]>('SELECT * FROM sessions WHERE id = ?').get(id);
    if (!row || row.expires_at < Date.now()) return null;
    const session: Session = {
      id: row.id,
      userId: row.user_id,
      username: row.username,
      globalName: row.global_name,
      avatar: row.avatar,
      accessToken: row.access_token,
      csrfToken: row.csrf_token,
      expiresAt: row.expires_at,
    };
    this.cache.set(id, session);
    return session;
  }

  delete(id: string): void {
    this.db.query('DELETE FROM sessions WHERE id = ?').run(id);
    this.cache.delete(id);
  }

  async read(c: Context): Promise<Session | null> {
    const id = await getSignedCookie(c, this.config.sessionSecret, SESSION_COOKIE);
    return id ? this.get(id) : null;
  }

  async writeCookie(c: Context, session: Session): Promise<void> {
    await setSignedCookie(c, SESSION_COOKIE, session.id, this.config.sessionSecret, {
      httpOnly: true,
      secure: this.config.secureCookies,
      sameSite: 'Lax',
      path: '/',
      expires: new Date(session.expiresAt),
    });
  }

  clearCookie(c: Context): void {
    deleteCookie(c, SESSION_COOKIE, { path: '/', secure: this.config.secureCookies });
  }
}

export { randomToken };
