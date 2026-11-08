/**
 * Audit log feature: the part shared by the bot and the dashboard.
 * The bot records everything Discord lets it see about a server (Discord's own audit log stream
 * plus gateway events the audit log does not cover) and the dashboard shows it, filterable.
 * Off by default, per server.
 */
import { defineFeature, snowflake } from '@shifubot/shared';
import { z } from 'zod';
import en from './i18n/en.json';
import hu from './i18n/hu.json';

export const auditManifest = defineFeature({
  id: 'audit',
  emoji: 'log',
  messages: { en, hu },
});

export const AUDIT_CATEGORIES = [
  'moderation',
  'members',
  'messages',
  'voice',
  'channels',
  'threads',
  'roles',
  'invites',
  'expressions',
  'events',
  'automod',
  'integrations',
  'server',
  'shifubot',
] as const;
export type AuditCategory = (typeof AUDIT_CATEGORIES)[number];

/** Emoji per category, for chips and rows. */
export const CATEGORY_EMOJI: Record<AuditCategory, string> = {
  moderation: '🔨',
  members: '👥',
  messages: '💬',
  voice: '🔊',
  channels: '#️⃣',
  threads: '🧵',
  roles: '🎭',
  invites: '✉️',
  expressions: '😀',
  events: '📅',
  automod: '🛡️',
  integrations: '🔌',
  server: '🏠',
  shifubot: '🤖',
};

/**
 * Discord audit log actions by number (discord-api-types AuditLogEvent). Stored as type "audit.<Name>".
 * Numbers Discord adds later are stored as "audit.unknown" with the number in the details, so nothing
 * is lost before this list is updated.
 */
export const AUDIT_ACTIONS = {
  1: 'GuildUpdate',
  10: 'ChannelCreate',
  11: 'ChannelUpdate',
  12: 'ChannelDelete',
  13: 'ChannelOverwriteCreate',
  14: 'ChannelOverwriteUpdate',
  15: 'ChannelOverwriteDelete',
  20: 'MemberKick',
  21: 'MemberPrune',
  22: 'MemberBanAdd',
  23: 'MemberBanRemove',
  24: 'MemberUpdate',
  25: 'MemberRoleUpdate',
  26: 'MemberMove',
  27: 'MemberDisconnect',
  28: 'BotAdd',
  30: 'RoleCreate',
  31: 'RoleUpdate',
  32: 'RoleDelete',
  40: 'InviteCreate',
  41: 'InviteUpdate',
  42: 'InviteDelete',
  50: 'WebhookCreate',
  51: 'WebhookUpdate',
  52: 'WebhookDelete',
  60: 'EmojiCreate',
  61: 'EmojiUpdate',
  62: 'EmojiDelete',
  72: 'MessageDelete',
  73: 'MessageBulkDelete',
  74: 'MessagePin',
  75: 'MessageUnpin',
  80: 'IntegrationCreate',
  81: 'IntegrationUpdate',
  82: 'IntegrationDelete',
  83: 'StageInstanceCreate',
  84: 'StageInstanceUpdate',
  85: 'StageInstanceDelete',
  90: 'StickerCreate',
  91: 'StickerUpdate',
  92: 'StickerDelete',
  100: 'GuildScheduledEventCreate',
  101: 'GuildScheduledEventUpdate',
  102: 'GuildScheduledEventDelete',
  110: 'ThreadCreate',
  111: 'ThreadUpdate',
  112: 'ThreadDelete',
  121: 'ApplicationCommandPermissionUpdate',
  130: 'SoundboardSoundCreate',
  131: 'SoundboardSoundUpdate',
  132: 'SoundboardSoundDelete',
  140: 'AutoModerationRuleCreate',
  141: 'AutoModerationRuleUpdate',
  142: 'AutoModerationRuleDelete',
  143: 'AutoModerationBlockMessage',
  144: 'AutoModerationFlagToChannel',
  145: 'AutoModerationUserCommunicationDisabled',
  146: 'AutoModerationQuarantineUser',
  150: 'CreatorMonetizationRequestCreated',
  151: 'CreatorMonetizationTermsAccepted',
  163: 'OnboardingPromptCreate',
  164: 'OnboardingPromptUpdate',
  165: 'OnboardingPromptDelete',
  166: 'OnboardingCreate',
  167: 'OnboardingUpdate',
  190: 'HomeSettingsCreate',
  191: 'HomeSettingsUpdate',
  192: 'VoiceChannelStatusCreate',
  193: 'VoiceChannelStatusDelete',
} as const satisfies Record<number, string>;

/**
 * Member updates that set a timeout are split out of MemberUpdate as their own type, because
 * moderators filter for them. Not a Discord action number.
 */
export const AUDIT_TIMEOUT = 'MemberTimeout';

export type AuditActionName = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS] | typeof AUDIT_TIMEOUT | 'unknown';

const MODERATION_ACTIONS = new Set<string>([
  'MemberKick',
  'MemberPrune',
  'MemberBanAdd',
  'MemberBanRemove',
  AUDIT_TIMEOUT,
  'MemberMove',
  'MemberDisconnect',
  'MessageDelete',
  'MessageBulkDelete',
]);

/** Category of a Discord audit log action, by its name. */
export function auditActionCategory(name: string): AuditCategory {
  if (MODERATION_ACTIONS.has(name)) return 'moderation';
  if (name.startsWith('AutoModeration')) return 'automod';
  if (name.startsWith('Member') || name === 'BotAdd') return 'members';
  if (name.startsWith('Channel') || name.startsWith('StageInstance')) return 'channels';
  if (name.startsWith('Thread')) return 'threads';
  if (name.startsWith('Role')) return 'roles';
  if (name.startsWith('Invite')) return 'invites';
  if (name.startsWith('Emoji') || name.startsWith('Sticker') || name.startsWith('SoundboardSound')) return 'expressions';
  if (name.startsWith('GuildScheduledEvent')) return 'events';
  if (name.startsWith('Webhook') || name.startsWith('Integration') || name.startsWith('ApplicationCommand')) return 'integrations';
  if (name.startsWith('Message')) return 'messages';
  if (name.startsWith('VoiceChannelStatus')) return 'voice';
  return 'server';
}

/**
 * Event types from gateway events and ShifuBot itself, by category. Order is the display order.
 * Only what a moderator would look for is recorded. Sent messages, typing, single reactions, poll
 * votes, self mute/deafen, thread and event sign-ups, status and activity changes and level ups were
 * removed on purpose: they are high volume and nobody investigates them.
 */
export const GATEWAY_TYPES = {
  members: [
    'member.join',
    'member.leave',
    'member.rulesAccepted',
    'member.boostStart',
    'member.boostStop',
    'member.serverAvatar',
    'user.username',
    'user.globalName',
    'user.avatar',
  ],
  messages: ['message.edited', 'message.deleted', 'message.bulkDeleted', 'reaction.cleared'],
  voice: ['voice.joined', 'voice.left', 'voice.moved', 'voice.streamStart', 'voice.streamStop', 'voice.videoStart', 'voice.videoStop', 'voice.effect'],
  invites: ['invite.used'],
  automod: ['automod.action'],
  shifubot: [
    'shifubot.settings',
    'shifubot.setup',
    'shifubot.verified',
    'shifubot.verificationRefused',
    'shifubot.verificationFailed',
    'shifubot.verificationRemoved',
    'shifubot.xpReset',
    'shifubot.xpChanged',
    'shifubot.messageFailed',
    'shifubot.logsPurged',
    'shifubot.eventsSkipped',
  ],
} as const satisfies Partial<Record<AuditCategory, readonly string[]>>;

/** Types earlier versions recorded and that are now dropped as noise. Their old rows are deleted. */
export const REMOVED_TYPES = [
  'message.sent',
  'message.typing',
  'reaction.added',
  'reaction.removed',
  'poll.voteAdded',
  'poll.voteRemoved',
  'voice.selfMute',
  'voice.selfUnmute',
  'voice.selfDeaf',
  'voice.selfUndeaf',
  'voice.requestToSpeak',
  'thread.memberJoined',
  'thread.memberLeft',
  'event.interested',
  'event.uninterested',
  'presence.status',
  'presence.activityStart',
  'presence.activityStop',
  'shifubot.levelUp',
] as const;

export type GatewayType = (typeof GATEWAY_TYPES)[keyof typeof GATEWAY_TYPES][number];
export type AuditType = GatewayType | `audit.${AuditActionName}`;

const GATEWAY_CATEGORY = new Map<string, AuditCategory>(
  Object.entries(GATEWAY_TYPES).flatMap(([category, types]) => types.map((type) => [type, category as AuditCategory])),
);

/** Category of any event type id. */
export function categoryOf(type: string): AuditCategory {
  if (type.startsWith('audit.')) return auditActionCategory(type.slice(6));
  return GATEWAY_CATEGORY.get(type) ?? 'server';
}

/** Every known type, grouped by category, for the filters and the settings page. */
export function typesByCategory(): Record<AuditCategory, string[]> {
  const result = Object.fromEntries(AUDIT_CATEGORIES.map((category) => [category, [] as string[]])) as Record<AuditCategory, string[]>;
  for (const [category, types] of Object.entries(GATEWAY_TYPES)) result[category as AuditCategory].push(...types);
  for (const name of [...Object.values(AUDIT_ACTIONS), AUDIT_TIMEOUT]) result[auditActionCategory(name)].push(`audit.${name}`);
  return result;
}

export const RETENTION_DAYS = [7, 14, 30, 90, 180] as const;

const oneOf = <T extends readonly number[]>(values: T, message: string) =>
  z.number().refine((value): value is T[number] => values.includes(value), message) as unknown as z.ZodType<T[number]>;

export const auditSettingsSchema = z.object({
  enabled: z.boolean(),
  /** Categories that are not recorded at all. Names of removed categories are dropped. */
  disabledCategories: z
    .array(z.string())
    .max(50)
    .transform((items) => [...new Set(items.filter((item): item is AuditCategory => (AUDIT_CATEGORIES as readonly string[]).includes(item)))]),
  /** Single event types that are not recorded. */
  disabledTypes: z
    .array(z.string().regex(/^[a-z]+\.[A-Za-z]+$/, 'Unknown event type').max(80))
    .max(300)
    .transform((items) => [...new Set(items)]),
  retentionDays: oneOf(RETENTION_DAYS, 'Pick 7, 14, 30, 90 or 180 days'),
  /** Channels and categories whose messages, reactions and voice activity are not recorded. */
  ignoredChannelIds: z.array(snowflake).max(100, 'At most 100 channels').transform((ids) => [...new Set(ids)]),
  /** Skip messages, reactions and voice activity of bots and webhooks. Moderation actions by bots are always kept. */
  ignoreBots: z.boolean(),
  /** Work out which invite each new member used. Needs the Manage Server permission. */
  trackInvites: z.boolean(),
});

export type AuditSettings = z.infer<typeof auditSettingsSchema>;

export const defaultAuditSettings: AuditSettings = {
  enabled: false,
  disabledCategories: [],
  disabledTypes: [],
  retentionDays: 30,
  ignoredChannelIds: [],
  ignoreBots: true,
  trackInvites: false,
};

/** True when a server records this event type with its settings. */
export function isTypeEnabled(settings: Pick<AuditSettings, 'enabled' | 'disabledCategories' | 'disabledTypes'>, type: string): boolean {
  return settings.enabled && !settings.disabledCategories.includes(categoryOf(type)) && !settings.disabledTypes.includes(type);
}

/** One event as the API returns it. */
export interface AuditEvent {
  id: number;
  at: number;
  category: AuditCategory;
  type: string;
  actorId: string | null;
  targetId: string | null;
  targetKind: string | null;
  channelId: string | null;
  data: Record<string, unknown>;
}

export interface AuditUser {
  id: string;
  name: string;
  username: string;
  avatarUrl: string | null;
}

export interface AuditEventsResponse {
  events: AuditEvent[];
  /** Names of every user, channel and role the events mention. */
  users: Record<string, AuditUser>;
  channels: Record<string, { name: string; kind: 'text' | 'voice' | 'category' | 'thread' | 'other' }>;
  roles: Record<string, { name: string; color: string | null }>;
  /** Pass as `before` to load older events, null when there are no more. */
  nextBefore: number | null;
}

export interface AuditCapabilities {
  messageContent: boolean;
  viewAuditLog: boolean;
  manageGuild: boolean;
}

export interface AuditResponse {
  settings: AuditSettings;
  capabilities: AuditCapabilities;
  stats: { events: number; oldest: number | null };
}

export const USER_ROLES = ['any', 'actor', 'target'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const MAX_PAGE = 100;
export const MAX_EXPORT = 10_000;

/** Filters of the log view. Shared so the URL, the API and the export use the same names. */
export const auditFilterSchema = z.object({
  before: z.coerce.number().int().positive().optional(),
  after: z.coerce.number().int().nonnegative().optional(),
  from: z.coerce.number().int().nonnegative().optional(),
  to: z.coerce.number().int().nonnegative().optional(),
  categories: z
    .string()
    .optional()
    .transform((value) => (value ? value.split(',').filter((item): item is AuditCategory => (AUDIT_CATEGORIES as readonly string[]).includes(item)) : [])),
  types: z
    .string()
    .optional()
    .transform((value) => (value ? value.split(',').filter((item) => /^[a-z]+\.[A-Za-z]+$/.test(item)).slice(0, 200) : [])),
  user: snowflake.optional(),
  userRole: z.enum(USER_ROLES).default('any'),
  channel: snowflake.optional(),
  q: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE).default(50),
});

export type AuditFilter = z.infer<typeof auditFilterSchema>;
