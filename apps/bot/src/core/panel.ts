/**
 * Panel messages: one bot message per server that features keep in sync with
 * their settings (the verification panel, the leveling leaderboard). Posts it,
 * edits it in place, moves it when the channel changes, and removes it.
 */
import type { MessagePayload } from '@shifubot/shared';
import { DiscordAPIError, type Guild, type NewsChannel, type TextChannel } from 'discord.js';
import { isPostableChannel, missingSendPermissions } from './permissions';
import type { SendQueue } from './send-queue';

export interface PanelRef {
  channelId: string;
  messageId: string;
}

export type PanelErrorCode = 'no_channel' | 'channel_missing' | 'missing_permissions' | 'send_failed' | 'panel_deleted';

export type PanelSyncResult =
  | { ok: true; panel: PanelRef | null; channel: TextChannel | NewsChannel | null }
  | { ok: false; error: PanelErrorCode };

/** The channel a panel can be posted to, or why not. */
export function resolvePanelChannel(guild: Guild, channelId: string | null) {
  if (!channelId) return { ok: false as const, error: 'no_channel' as const };
  const channel = guild.channels.cache.get(channelId);
  if (!isPostableChannel(channel)) return { ok: false as const, error: 'channel_missing' as const };
  if (missingSendPermissions(guild, channel).length) return { ok: false as const, error: 'missing_permissions' as const };
  return { ok: true as const, channel };
}

export async function deletePanelMessage(guild: Guild, panel: PanelRef): Promise<void> {
  const channel = guild.channels.cache.get(panel.channelId);
  if (!isPostableChannel(channel)) return;
  await channel.messages.delete(panel.messageId).catch(() => {
    // Already gone or no access: nothing to clean up.
  });
}

const isUnknownMessage = (error: unknown) => error instanceof DiscordAPIError && error.code === 10008;

/**
 * Bring the panel in line with what it should be. The caller stores the
 * returned `panel` reference (null when there is none any more).
 */
export async function syncPanelMessage(options: {
  guild: Guild;
  queue: SendQueue;
  /** Queue key, e.g. "verification:<guildId>", so one server's panels go one at a time. */
  queueKey: string;
  existing: PanelRef | null;
  /** Where and what to show, or null to remove the panel. */
  target: { channelId: string | null; payload: MessagePayload } | null;
  /** Post a fresh message even if the current one could be edited. */
  forceNew?: boolean;
  /** When someone deleted the message by hand: post a new one (default) or report "panel_deleted". */
  repostIfDeleted?: boolean;
}): Promise<PanelSyncResult> {
  const { guild, queue, queueKey, existing, target, forceNew = false, repostIfDeleted = true } = options;

  if (!target) {
    if (existing) await deletePanelMessage(guild, existing);
    return { ok: true, panel: null, channel: null };
  }

  const resolved = resolvePanelChannel(guild, target.channelId);
  if (!resolved.ok) return { ok: false, error: resolved.error };
  const channel = resolved.channel;

  try {
    if (existing && existing.channelId === channel.id && !forceNew) {
      try {
        await queue.run(queueKey, () => channel.messages.edit(existing.messageId, target.payload));
        return { ok: true, panel: existing, channel };
      } catch (error) {
        if (!isUnknownMessage(error)) throw error;
        if (!repostIfDeleted) return { ok: false, error: 'panel_deleted' };
      }
    } else if (existing) {
      await deletePanelMessage(guild, existing);
    }
    const message = await queue.run(queueKey, () => channel.send(target.payload));
    return { ok: true, panel: { channelId: channel.id, messageId: message.id }, channel };
  } catch (error) {
    const missing = error instanceof DiscordAPIError && (error.code === 50013 || error.code === 50001);
    return { ok: false, error: missing ? 'missing_permissions' : 'send_failed' };
  }
}
