/**
 * Turns Discord objects into audit records. Kept apart from the wiring in server.ts so the mapping
 * can be tested with plain objects.
 */
import type { AuditRecord, AuditTargetKind } from '../../apps/bot/src/core/audit-sink';
import { AUDIT_ACTIONS, AUDIT_TIMEOUT } from './manifest';
import type { UserSnapshot } from './store';

/** Converts discord.js values (users, channels, roles, collections, bigints) into small JSON. */
export function plain(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.getTime();
  if (depth > 3) return null;
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => plain(item, depth + 1));
  if (value instanceof Map) return [...value.values()].slice(0, 50).map((item) => plain(item, depth + 1));
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    // Discord entities: keep the id and a readable name.
    if (typeof record.id === 'string' && depth > 0) {
      const name = record.name ?? record.username ?? record.code ?? record.tag;
      return name !== undefined && name !== null ? { id: record.id, name: String(name) } : { id: record.id };
    }
    if (typeof (record as { toJSON?: unknown }).toJSON === 'function' && depth > 0) {
      return plain((record as { toJSON: () => unknown }).toJSON(), depth + 1);
    }
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(record).slice(0, 40)) {
      if (typeof item === 'function' || key === 'client' || key.startsWith('_')) continue;
      out[key] = plain(item, depth + 1);
    }
    return out;
  }
  return null;
}

const TARGET_KINDS: Record<string, AuditTargetKind> = {
  Guild: 'guild',
  Channel: 'channel',
  Thread: 'channel',
  StageInstance: 'channel',
  User: 'user',
  Role: 'role',
  Invite: 'invite',
  Webhook: 'webhook',
  Emoji: 'emoji',
  Sticker: 'sticker',
  SoundboardSound: 'emoji',
  Message: 'user',
  Integration: 'integration',
  GuildScheduledEvent: 'event',
  AutoModeration: 'rule',
  ApplicationCommand: 'integration',
};

/** The parts of a discord.js GuildAuditLogsEntry this module reads. */
export interface AuditEntryLike {
  action: number;
  executorId: string | null;
  targetId: string | null;
  targetType: string;
  reason: string | null;
  changes: { key: string; old?: unknown; new?: unknown }[];
  extra: unknown;
  target: unknown;
  createdTimestamp?: number;
}

/** Type id of a Discord audit log entry. Timeouts are split out of member updates. */
export function auditEntryType(entry: Pick<AuditEntryLike, 'action' | 'changes'>): string {
  const name = (AUDIT_ACTIONS as Record<number, string>)[entry.action];
  if (!name) return 'audit.unknown';
  if (name === 'MemberUpdate' && entry.changes.some((change) => change.key === 'communication_disabled_until')) return `audit.${AUDIT_TIMEOUT}`;
  return `audit.${name}`;
}

/** One record for a Discord audit log entry: who did what to whom, why, and what changed. */
export function auditEntryRecord(entry: AuditEntryLike): AuditRecord {
  const extra = plain(entry.extra, 1) as Record<string, unknown> | null;
  const extraChannel = extra && typeof extra === 'object' && 'channel' in extra ? (extra.channel as { id?: string } | string | null) : null;
  const channelId = typeof extraChannel === 'string' ? extraChannel : (extraChannel?.id ?? null);
  const target = entry.target as { name?: unknown; username?: unknown; code?: unknown; tag?: unknown } | null;
  const targetName = target ? (target.name ?? target.username ?? target.code ?? target.tag ?? null) : null;
  // For message actions Discord's target is the author of the messages.
  const kind = entry.targetType === 'Message' ? 'user' : (TARGET_KINDS[entry.targetType] ?? 'other');
  return {
    type: auditEntryType(entry),
    actorId: entry.executorId,
    targetId: entry.targetId,
    targetKind: kind,
    channelId,
    at: entry.createdTimestamp,
    data: {
      ...(entry.reason ? { reason: entry.reason } : {}),
      ...(targetName ? { targetName: String(targetName) } : {}),
      ...(entry.changes.length
        ? { changes: entry.changes.map((change) => ({ key: change.key, old: plain(change.old, 1), new: plain(change.new, 1) })) }
        : {}),
      ...(extra && typeof extra === 'object' && Object.keys(extra).length ? { extra } : {}),
      ...((AUDIT_ACTIONS as Record<number, string>)[entry.action] ? {} : { actionType: entry.action }),
    },
  };
}

/** The voice state fields the log compares. */
export interface VoiceLike {
  channelId: string | null;
  streaming: boolean | null;
  selfVideo: boolean | null;
}

/**
 * Records for one voice state change: joins, leaves, moves, streaming and camera. Muting and
 * deafening yourself is left out: it happens all the time and says nothing.
 */
export function voiceRecords(userId: string, before: VoiceLike, after: VoiceLike): AuditRecord[] {
  const base = { actorId: userId, targetId: userId, targetKind: 'user' as const };
  if (!before.channelId && after.channelId) return [{ ...base, type: 'voice.joined', channelId: after.channelId }];
  if (before.channelId && !after.channelId) return [{ ...base, type: 'voice.left', channelId: before.channelId }];
  if (!after.channelId) return [];
  if (before.channelId !== after.channelId) {
    return [{ ...base, type: 'voice.moved', channelId: after.channelId, data: { fromChannelId: before.channelId, toChannelId: after.channelId } }];
  }
  const records: AuditRecord[] = [];
  const toggle = (was: boolean | null, now: boolean | null, on: string, off: string) => {
    if (Boolean(was) === Boolean(now)) return;
    records.push({ ...base, type: now ? on : off, channelId: after.channelId });
  };
  toggle(before.streaming, after.streaming, 'voice.streamStart', 'voice.streamStop');
  toggle(before.selfVideo, after.selfVideo, 'voice.videoStart', 'voice.videoStop');
  return records;
}

/**
 * Records for profile changes between the stored snapshot and the member now. Nicknames, roles and
 * timeouts are left out: Discord's audit log reports those with the moderator who did it.
 * Server only fields (server avatar, rules screening, boosting) are only compared when the snapshot
 * came from a member event; a name remembered from a message only knows the user fields.
 */
export function memberChangeRecords(before: UserSnapshot | null, after: UserSnapshot): AuditRecord[] {
  if (!before) return [];
  const base = { actorId: after.id, targetId: after.id, targetKind: 'user' as const };
  const records: AuditRecord[] = [];
  const diff = (type: string, was: string | null, now: string | null, show?: { before: string | null; after: string | null }) => {
    if ((was ?? null) !== (now ?? null)) records.push({ ...base, type, data: show ?? { before: was, after: now } });
  };
  diff('user.username', before.username || null, after.username || null);
  diff('user.globalName', before.globalName, after.globalName);
  diff('user.avatar', before.avatar, after.avatar, { before: before.avatarUrl, after: after.avatarUrl });
  if (before.full && after.full) {
    diff('member.serverAvatar', before.guildAvatar, after.guildAvatar, { before: before.avatarUrl, after: after.avatarUrl });
    if (before.pending === true && after.pending === false) records.push({ ...base, type: 'member.rulesAccepted' });
    if (!before.premiumSince && after.premiumSince) records.push({ ...base, type: 'member.boostStart', data: { since: after.premiumSince } });
    if (before.premiumSince && !after.premiumSince) records.push({ ...base, type: 'member.boostStop', data: { since: before.premiumSince } });
  }
  return records;
}

/** Days between two times, rounded down. */
export function daysBetween(from: number, to: number): number {
  return Math.max(0, Math.floor((to - from) / 86_400_000));
}

/** Accounts younger than this are flagged as new in join events. */
export const NEW_ACCOUNT_DAYS = 7;
