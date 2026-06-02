import session from 'express-session';
import type { Express, Request, Response } from 'express';
import passport, { type Profile } from 'passport';
import { Strategy as DiscordStrategy } from 'passport-discord';
import type { Client, Snowflake } from 'discord.js';

interface DiscordProfile extends Profile {
  guilds?: Array<{
    id: Snowflake;
    name: string;
    permissions: string;
    icon?: string | null;
  }>;
}

interface AuthContext {
  client: Client;
  database: unknown;
}

function isAdminOrManager(permissionValue: string) {
  const permissions = BigInt(permissionValue);
  const administrator = 1n << 3n;
  const manageGuild = 1n << 5n;

  return (permissions & administrator) === administrator || (permissions & manageGuild) === manageGuild;
}

export function createAuth(app: Express, _context: AuthContext) {
  app.use(
    session({
      secret: process.env.SESSION_SECRET ?? 'change-me',
      resave: false,
      saveUninitialized: false
    })
  );

  app.use(passport.initialize());
  app.use(passport.session());

  passport.serializeUser((user: Express.User, done: (error: unknown, id?: unknown) => void) => {
    done(null, user);
  });

  passport.deserializeUser((user: Express.User, done: (error: unknown, user?: Express.User | false | null) => void) => {
    done(null, user);
  });

  passport.use(
    new DiscordStrategy(
      {
        clientID: process.env.DISCORD_CLIENT_ID ?? '',
        clientSecret: process.env.DISCORD_CLIENT_SECRET ?? '',
        callbackURL: process.env.DISCORD_CALLBACK_URL ?? 'http://localhost:3000/auth/discord/callback',
        scope: ['identify', 'guilds']
      } as any,
      ((
        _accessToken: string,
        _refreshToken: string,
        profile: DiscordProfile,
        done: (error: unknown, profile?: DiscordProfile) => void
      ) => {
        done(null, profile);
      }) as any
    )
  );

  app.get('/auth/discord', passport.authenticate('discord'));

  app.get(
    '/auth/discord/callback',
    passport.authenticate('discord', {
      failureRedirect: '/'
    }),
    (_request: Request, response: Response) => {
      response.redirect('/');
    }
  );

  app.get('/api/auth/me', (request: Request, response: Response) => {
    response.json({ user: request.user ?? null });
  });

  app.get('/api/auth/guilds', (request: Request, response: Response) => {
    const user = request.user as DiscordProfile | undefined;
    const botGuildIds = new Set(request.app.locals.botGuildIds as Snowflake[] | undefined);

    const guilds = (user?.guilds ?? [])
      .filter((guild) => botGuildIds.has(guild.id))
      .filter((guild) => isAdminOrManager(guild.permissions))
      .map((guild) => ({
        id: guild.id,
        name: guild.name,
        icon: guild.icon
      }));

    response.json({ guilds });
  });
}
