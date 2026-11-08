import type { Guild } from 'discord.js';
import type { Logger } from '../logger';

/** An empty list means the bot may join any server. */
export function isGuildAllowed(allowed: ReadonlySet<string>, guildId: string): boolean {
  return allowed.size === 0 || allowed.has(guildId);
}

/**
 * Discord has no way to refuse an invite, so the bot leaves right after joining.
 * Returns true when the server is not allowed, even if leaving failed: the next start tries again.
 */
export async function leaveIfNotAllowed(
  guild: Pick<Guild, 'id' | 'name' | 'leave'>,
  allowed: ReadonlySet<string>,
  logger: Logger,
): Promise<boolean> {
  if (isGuildAllowed(allowed, guild.id)) return false;
  logger.warn('Leaving server that is not in ALLOWED_GUILD_IDS', { guildId: guild.id, name: guild.name });
  try {
    await guild.leave();
  } catch (error) {
    logger.error('Could not leave server that is not in ALLOWED_GUILD_IDS', { guildId: guild.id, error });
  }
  return true;
}
