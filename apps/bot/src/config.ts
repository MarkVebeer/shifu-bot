import { DEFAULT_LOCALE, LOCALES } from '@shifubot/shared';
import { isAbsolute, resolve } from 'node:path';
import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0', 'yes', 'no', ''])
  .transform((value) => value === 'true' || value === '1' || value === 'yes');

const required = (hint: string) => z.string({ required_error: `is required. ${hint}` });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  BOT_DISABLED: bool.default('false'),
  DISCORD_TOKEN: required('Copy it from Developer Portal > Bot > Reset Token.'),
  DISCORD_CLIENT_ID: required('Copy the Application ID from Developer Portal > General Information.').regex(
    /^\d{17,20}$/,
    'must be the Application ID (17-20 digits) from General Information.',
  ),
  DISCORD_CLIENT_SECRET: required('Copy it from Developer Portal > OAuth2 > Client Secret.'),
  PUBLIC_URL: required('Set it to the address of the dashboard, e.g. https://shifu.example.com')
    .regex(/^https?:\/\/[^\s/]+/, 'must be a full URL that starts with http:// or https://')
    .transform((value) => value.replace(/\/+$/, '')),
  SESSION_SECRET: required('Generate one: bun -e "console.log(crypto.randomUUID()+crypto.randomUUID())"').min(
    32,
    'must be at least 32 random characters.',
  ),
  SERVER_PORT: z.coerce.number().int().min(1).max(65535).optional(),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_PATH: z.string().default('./data/shifubot.db'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
  DEFAULT_LOCALE: z.enum(LOCALES).default(DEFAULT_LOCALE),
  TRUST_PROXY: bool.default('true'),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(1).max(10).default(1),
  WELCOME_MAX_PER_MINUTE: z.coerce.number().int().min(1).max(120).default(10),
  GOODBYE_MAX_PER_MINUTE: z.coerce.number().int().min(1).max(120).default(10),
  SEND_CONCURRENCY: z.coerce.number().int().min(1).max(50).default(4),
  CLEANUP_AFTER_DAYS: z.coerce.number().int().min(1).max(3650).default(30),
  DISCORD_MESSAGE_CONTENT: bool.default('false'),
  AUDIT_MAX_ROWS_PER_GUILD: z.coerce.number().int().min(1_000).max(50_000_000).default(500_000),
  AUDIT_MAX_EVENTS_PER_MINUTE: z.coerce.number().int().min(10).max(100_000).default(1_200),
  COUNTER_MAX_PER_GUILD: z.coerce.number().int().min(1).max(25).default(5),
});

export type Config = ReturnType<typeof loadConfig>;

/** Empty values from .env or a panel count as "not set". */
function cleanEnv(env: Record<string, string | undefined>) {
  return Object.fromEntries(Object.entries(env).filter(([, value]) => value !== undefined && value.trim() !== ''));
}

export function loadConfig(env: Record<string, string | undefined> = process.env) {
  const parsed = envSchema.safeParse(cleanEnv(env));
  if (!parsed.success) {
    const lines = parsed.error.issues.map((issue) => `  - ${issue.path.join('.')} ${issue.message}`);
    throw new Error(
      `Invalid configuration. Fix these environment variables (see .env.example):\n${lines.join('\n')}`,
    );
  }
  const raw = parsed.data;
  const publicUrl = new URL(raw.PUBLIC_URL);
  return {
    env: raw.NODE_ENV,
    isProduction: raw.NODE_ENV === 'production',
    botDisabled: raw.BOT_DISABLED,
    discord: {
      token: raw.DISCORD_TOKEN,
      clientId: raw.DISCORD_CLIENT_ID,
      clientSecret: raw.DISCORD_CLIENT_SECRET,
      /** Privileged intent, only requested when turned on here and in the Developer Portal. */
      messageContent: raw.DISCORD_MESSAGE_CONTENT,
    },
    audit: {
      maxRowsPerGuild: raw.AUDIT_MAX_ROWS_PER_GUILD,
      maxEventsPerMinute: raw.AUDIT_MAX_EVENTS_PER_MINUTE,
    },
    counter: {
      maxPerGuild: raw.COUNTER_MAX_PER_GUILD,
    },
    publicUrl: raw.PUBLIC_URL,
    publicOrigin: publicUrl.origin,
    secureCookies: publicUrl.protocol === 'https:',
    redirectUri: `${raw.PUBLIC_URL}/auth/callback`,
    sessionSecret: raw.SESSION_SECRET,
    port: raw.SERVER_PORT ?? raw.PORT,
    host: raw.HOST,
    databasePath: isAbsolute(raw.DATABASE_PATH) ? raw.DATABASE_PATH : resolve(process.cwd(), raw.DATABASE_PATH),
    logLevel: raw.LOG_LEVEL,
    defaultLocale: raw.DEFAULT_LOCALE,
    trustProxy: raw.TRUST_PROXY,
    trustProxyHops: raw.TRUST_PROXY_HOPS,
    welcomeMaxPerMinute: raw.WELCOME_MAX_PER_MINUTE,
    goodbyeMaxPerMinute: raw.GOODBYE_MAX_PER_MINUTE,
    sendConcurrency: raw.SEND_CONCURRENCY,
    cleanupAfterDays: raw.CLEANUP_AFTER_DAYS,
  };
}
