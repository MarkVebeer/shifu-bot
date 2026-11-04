/**
 * ShifuBot entry point. The Discord bot and the HTTP API run in this one process,
 * so a setting saved in the dashboard applies to the bot instantly.
 */
import { loadConfig } from './config';
import { AuditSink } from './core/audit-sink';
import { startCleanupJob } from './core/cleanup';
import type { AppContext } from './core/feature';
import { GuildSettingsStore } from './core/guild-settings';
import { loadServerFeatures } from './core/registry';
import { SendQueue } from './core/send-queue';
import { coreMigrations, migrate, openDatabase } from './db/database';
import { createDiscordClient } from './discord/client';
import { registerEvents } from './discord/events';
import { createHttpApp } from './http/app';
import { createLogger } from './logger';

async function main() {
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    console.error(`\n✖ ${(error as Error).message}\n`);
    process.exit(1);
  }

  const logger = createLogger({ level: config.logLevel, pretty: !config.isProduction });
  logger.info('Starting ShifuBot', { env: config.env, database: config.databasePath });

  const db = openDatabase(config.databasePath);
  const serverFeatures = await loadServerFeatures();
  migrate(db, [...coreMigrations, ...serverFeatures.flatMap((feature) => feature.migrations)], logger);

  const client = createDiscordClient({ messageContent: config.discord.messageContent });
  const ctx: AppContext = {
    audit: new AuditSink(),
    config,
    logger,
    db,
    client,
    guildSettings: new GuildSettingsStore(db, config.defaultLocale),
    queue: new SendQueue(config.sendConcurrency, logger.child({ component: 'send-queue' })),
  };

  const features = serverFeatures.map((feature) => ({
    feature,
    instance: feature.setup({ ...ctx, logger: logger.child({ feature: feature.manifest.id }) }),
  }));
  logger.info('Loaded features', { features: features.map(({ feature }) => feature.manifest.id) });

  registerEvents(ctx, features);
  const cleanupTimer = startCleanupJob(db, serverFeatures, config.cleanupAfterDays, logger.child({ component: 'cleanup' }));

  const app = createHttpApp(ctx, features);
  const server = Bun.serve({
    hostname: config.host,
    port: config.port,
    fetch: (request, srv) => app.fetch(request, { server: srv }),
  });
  logger.info('Dashboard listening', { url: config.publicUrl, bind: `${config.host}:${server.port}` });

  if (config.botDisabled) {
    logger.warn('BOT_DISABLED is set: the Discord bot will not log in. Only the dashboard runs.');
  } else {
    client.login(config.discord.token).catch((error: Error) => {
      const privileged = [
        'SERVER MEMBERS INTENT',
        ...(config.discord.messageContent ? ['MESSAGE CONTENT INTENT (or set DISCORD_MESSAGE_CONTENT=false)'] : []),
      ];
      const hint = /disallowed intents/i.test(error.message)
        ? `Turn on ${privileged.join(', ')} in Developer Portal > Bot > Privileged Gateway Intents.`
        : /token/i.test(error.message)
          ? 'Check DISCORD_TOKEN. Reset it in Developer Portal > Bot if needed.'
          : undefined;
      logger.error('Could not log in to Discord', { error, hint });
      process.exit(1);
    });
  }

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    logger.info('Shutting down', { signal });
    clearInterval(cleanupTimer);
    server.stop();
    await client.destroy().catch(() => undefined);
    db.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('unhandledRejection', (error) => logger.error('Unhandled promise rejection', { error }));
}

void main();
