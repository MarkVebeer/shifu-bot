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
  /**
   * Muted by themselves or by a moderator, or a Stage listener without the right to speak: they are not
   * talking, and idling muted is the usual way to farm XP.
   */
  muted: boolean;
  channelId: string | null;
  afkChannelId: string | null;
  /** Non-bot, non-deafened members in the same channel, the member included: people who can hear each other. */
  humansInChannel: number;
  ignored: boolean;
}

/**
 * True when a member earns voice XP for this minute: talking (not muted or deafened) with at least one
 * other person, outside the AFK channel.
 */
export function isVoiceEligible(state: VoiceSnapshot): boolean {
  return (
    !state.bot &&
    !state.deaf &&
    !state.muted &&
    state.channelId !== null &&
    state.channelId !== state.afkChannelId &&
    !state.ignored &&
    state.humansInChannel >= 2
  );
}

/** UTC calendar day ("2026-11-04"), the window of the daily voice XP cap. */
export function voiceDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/** Voice XP a member has after `minutes` eligible minutes on one day: the cap spread evenly over voiceCapMinutes. */
export function voiceXpAfter(minutes: number): number {
  const capped = Math.min(Math.max(0, minutes), XP_RULES.voiceCapMinutes);
  return Math.floor((capped * XP_RULES.voiceDailyCap) / XP_RULES.voiceCapMinutes);
}

/**
 * Voice XP for the next eligible minute, given how many eligible minutes the member already had today.
 * Whole XP only: the pattern 1, 1, 1, 2 adds up to exactly 1.25 a minute. 0 once the daily cap is reached.
 */
export function voiceXpGrant(minutesToday: number): number {
  return voiceXpAfter(minutesToday + 1) - voiceXpAfter(minutesToday);
}

/** Random XP for one message, between the configured min and max (both included). */
export function messageXp(random = Math.random): number {
  return XP_RULES.messageMin + Math.floor(random() * (XP_RULES.messageMax - XP_RULES.messageMin + 1));
}
