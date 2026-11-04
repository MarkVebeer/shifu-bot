/**
 * Leveling rules that decide who earns XP. Plain data in, boolean out, so they
 * are easy to test without Discord objects.
 */
import { XP_RULES } from './manifest';

/**
 * True when XP is off for a channel. `chain` is the channel id followed by its
 * parents: a thread, its channel, and that channel's category. Ignoring a
 * category ignores everything inside it.
 */
export function isIgnoredChannel(chain: (string | null | undefined)[], ignored: readonly string[]): boolean {
  return chain.some((id) => id != null && ignored.includes(id));
}

export interface VoiceSnapshot {
  bot: boolean;
  /** Deafened by themselves or by a moderator: they cannot hear anyone, so they are not taking part. */
  deaf: boolean;
  channelId: string | null;
  afkChannelId: string | null;
  /** Non-bot members in the same channel, the member included. */
  humansInChannel: number;
  ignored: boolean;
}

/** True when a member earns voice XP for this minute. Being alone or in the AFK channel does not count. */
export function isVoiceEligible(state: VoiceSnapshot): boolean {
  return (
    !state.bot &&
    !state.deaf &&
    state.channelId !== null &&
    state.channelId !== state.afkChannelId &&
    !state.ignored &&
    state.humansInChannel >= 2
  );
}

/** Random XP for one message, between the configured min and max (both included). */
export function messageXp(random = Math.random): number {
  return XP_RULES.messageMin + Math.floor(random() * (XP_RULES.messageMax - XP_RULES.messageMin + 1));
}
