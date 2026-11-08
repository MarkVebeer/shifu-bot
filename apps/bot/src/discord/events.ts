import { Events, type ClientEvents } from 'discord.js';
import type { AppContext, FeatureInstance, ServerFeature } from '../core/feature';
import { leaveIfNotAllowed } from '../core/guild-allowlist';

/** Wire core lifecycle events and every feature's event handlers onto the client. */
export function registerEvents(ctx: AppContext, features: { feature: ServerFeature; instance: FeatureInstance }[]) {
  const { client, config, logger, guildSettings } = ctx;

  client.once(Events.ClientReady, async (ready) => {
    logger.info('Connected to Discord', { user: ready.user.tag, guilds: ready.guilds.cache.size });
    // Make sure servers that added the bot while it was offline get default settings.
    // Servers off the list are skipped: ensure() would cancel their pending cleanup.
    for (const guild of ready.guilds.cache.values()) {
      if (!(await leaveIfNotAllowed(guild, config.allowedGuildIds, logger))) guildSettings.ensure(guild.id);
    }
  });

  client.on(Events.GuildCreate, async (guild) => {
    if (await leaveIfNotAllowed(guild, config.allowedGuildIds, logger)) return;
    logger.info('Joined server', { guildId: guild.id, members: guild.memberCount });
    guildSettings.ensure(guild.id);
    for (const { feature, instance } of features) {
      try {
        await instance.onGuildCreate?.(guild);
      } catch (error) {
        logger.error('Feature guildCreate hook failed', { feature: feature.manifest.id, guildId: guild.id, error });
      }
    }
  });

  client.on(Events.GuildDelete, (guild) => {
    // Also fires during outages (guild.available === false). Only mark real removals.
    if (!guild.available) return;
    logger.info('Removed from server, data marked for cleanup', { guildId: guild.id });
    guildSettings.markLeft(guild.id);
  });

  client.on(Events.Error, (error) => logger.error('Discord client error', { error }));
  client.on(Events.Warn, (message) => logger.warn('Discord client warning', { message }));
  client.on(Events.ShardDisconnect, (event, shardId) => logger.warn('Shard disconnected', { shardId, code: event.code }));
  client.on(Events.ShardReconnecting, (shardId) => logger.info('Shard reconnecting', { shardId }));

  for (const { feature, instance } of features) {
    for (const [event, handler] of Object.entries(instance.events ?? {})) {
      client.on(event as keyof ClientEvents, async (...args: unknown[]) => {
        try {
          await (handler as (...a: unknown[]) => unknown)(...args);
        } catch (error) {
          logger.error('Feature event handler failed', { feature: feature.manifest.id, event, error });
        }
      });
    }
  }
}
