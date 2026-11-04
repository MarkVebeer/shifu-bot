/**
 * Leveling feature: the part shared by the bot and the dashboard.
 * Members earn XP for chatting and for time in voice channels. Level ups are
 * announced, and a leaderboard panel in a channel is kept up to date. The
 * builders below make the real messages and the dashboard previews.
 */
import {
  brandFooter,
  buildEmbed,
  ButtonStyle,
  defineFeature,
  hexColor,
  renderPlaceholders,
  snowflake,
  type Locale,
  type MessagePayload,
} from '@shifubot/shared';
import { z } from 'zod';
import en from './i18n/en.json';
import hu from './i18n/hu.json';

export const levelingManifest = defineFeature({
  id: 'leveling',
  emoji: 'leveling',
  messages: { en, hu },
});

/** XP amounts. Fixed on purpose: the same rules everywhere keep leaderboards comparable. */
export const XP_RULES = {
  messageMin: 15,
  messageMax: 25,
  /** A member earns message XP at most once per this many seconds. */
  messageCooldownSeconds: 60,
  /** XP per full minute in a voice channel with at least one other person. */
  voicePerMinute: 10,
} as const;

export const LEVEL_UP_PLACEHOLDERS = ['user', 'username', 'level', 'server'] as const;
export const ANNOUNCE_MODES = ['current', 'channel', 'off'] as const;
export type AnnounceMode = (typeof ANNOUNCE_MODES)[number];
export const LEADERBOARD_INTERVALS = [1, 5, 15, 60] as const;
export const LEADERBOARD_SIZES = [5, 10, 15, 20] as const;
export const RANK_BUTTON_ID = 'leveling:rank';

const oneOf = <T extends readonly number[]>(values: T, message: string) =>
  z.number().refine((value): value is T[number] => values.includes(value), message) as unknown as z.ZodType<T[number]>;

export const levelingSettingsSchema = z.object({
  enabled: z.boolean(),
  /** Text, voice channels and categories where nobody earns XP. */
  ignoredChannelIds: z.array(snowflake).max(100, 'At most 100 channels').transform((ids) => [...new Set(ids)]),
  announceMode: z.enum(ANNOUNCE_MODES),
  announceChannelId: snowflake.nullable(),
  /** Empty string means "use the default text of the server language". */
  title: z.string().trim().max(200, 'Title can be at most 200 characters'),
  description: z.string().trim().max(2000, 'Description can be at most 2000 characters'),
  color: hexColor.nullable(),
  mentionUser: z.boolean(),
  leaderboardChannelId: snowflake.nullable(),
  /** Minutes between leaderboard refreshes. */
  leaderboardInterval: oneOf(LEADERBOARD_INTERVALS, 'Pick 1, 5, 15 or 60 minutes'),
  leaderboardSize: oneOf(LEADERBOARD_SIZES, 'Pick 5, 10, 15 or 20'),
});

export type LevelingSettings = z.infer<typeof levelingSettingsSchema>;

export const defaultLevelingSettings: LevelingSettings = {
  enabled: false,
  ignoredChannelIds: [],
  announceMode: 'current',
  announceChannelId: null,
  title: '',
  description: '',
  color: null,
  mentionUser: false,
  leaderboardChannelId: null,
  leaderboardInterval: 5,
  leaderboardSize: 10,
};

/** XP needed to go from `level` to `level + 1`. Same curve as the well known MEE6 one. */
export function xpToNextLevel(level: number): number {
  return 5 * level * level + 50 * level + 100;
}

/** Total XP needed to reach `level` from zero. */
export function totalXpForLevel(level: number): number {
  let total = 0;
  for (let l = 0; l < level; l++) total += xpToNextLevel(l);
  return total;
}

export interface LevelProgress {
  level: number;
  /** XP earned since the current level started. */
  current: number;
  /** XP the current level needs in total. */
  needed: number;
}

export function levelFromXp(totalXp: number): LevelProgress {
  let level = 0;
  let rest = Math.max(0, Math.floor(totalXp));
  while (rest >= xpToNextLevel(level)) {
    rest -= xpToNextLevel(level);
    level++;
  }
  return { level, current: rest, needed: xpToNextLevel(level) };
}

/** "▰▰▰▱▱▱▱▱▱▱" style bar, safe in embeds on every platform. */
export function progressBar(fraction: number, width = 12): string {
  const filled = Math.round(Math.min(1, Math.max(0, fraction)) * width);
  return '▰'.repeat(filled) + '▱'.repeat(width - filled);
}

const formatNumber = (value: number, locale: Locale) => value.toLocaleString(locale === 'hu' ? 'hu-HU' : 'en-US');

export interface LevelUpContext {
  locale: Locale;
  member: { id: string; displayName: string; avatarUrl: string };
  level: number;
  server: { name: string };
  now?: Date;
}

export function buildLevelUpMessage(settings: LevelingSettings, ctx: LevelUpContext): MessagePayload {
  const texts = levelingManifest.messages[ctx.locale];
  const values = { user: `<@${ctx.member.id}>`, username: ctx.member.displayName, level: ctx.level, server: ctx.server.name };
  // Mentions do not render in embed titles, so use the plain name there.
  const plainValues = { ...values, user: ctx.member.displayName };
  return {
    ...(settings.mentionUser ? { content: `<@${ctx.member.id}>` } : {}),
    embeds: [
      buildEmbed({
        emoji: levelingManifest.emoji,
        title: renderPlaceholders(settings.title || texts.defaults.title, plainValues),
        description: renderPlaceholders(settings.description || texts.defaults.description, values),
        color: settings.color,
        thumbnailUrl: ctx.member.avatarUrl,
        footer: brandFooter(ctx.locale, texts.name),
        timestamp: ctx.now ?? new Date(),
      }),
    ],
    allowedMentions: { users: settings.mentionUser ? [ctx.member.id] : [], roles: [], parse: [] },
  };
}

export interface LeaderboardEntry {
  userId: string;
  xp: number;
}

const MEDALS = ['🥇', '🥈', '🥉'];

export function buildLeaderboardPanel(
  settings: Pick<LevelingSettings, 'color' | 'leaderboardSize'>,
  ctx: { locale: Locale; server: { name: string }; entries: LeaderboardEntry[]; updatedAt: Date },
): MessagePayload {
  const texts = levelingManifest.messages[ctx.locale];
  const lines = ctx.entries.slice(0, settings.leaderboardSize).map((entry, index) => {
    const rank = MEDALS[index] ?? `\`#${index + 1}\``;
    const { level } = levelFromXp(entry.xp);
    return renderPlaceholders(texts.leaderboard.line, {
      rank,
      user: `<@${entry.userId}>`,
      level,
      xp: formatNumber(entry.xp, ctx.locale),
    });
  });
  // <t:…:R> is rendered by Discord as "2 minutes ago" and keeps counting by itself.
  const updated = renderPlaceholders(texts.leaderboard.updated, { time: `<t:${Math.floor(ctx.updatedAt.getTime() / 1000)}:R>` });
  return {
    embeds: [
      buildEmbed({
        emoji: levelingManifest.emoji,
        title: renderPlaceholders(texts.leaderboard.title, { server: ctx.server.name }),
        description: `${lines.length ? lines.join('\n') : texts.leaderboard.empty}\n\n${updated}`,
        color: settings.color,
        footer: brandFooter(ctx.locale, texts.name),
      }),
    ],
    components: [
      {
        type: 1,
        components: [
          { type: 2, style: ButtonStyle.Primary, label: texts.leaderboard.rankButton, custom_id: RANK_BUTTON_ID, emoji: { name: '📊' } },
        ],
      },
    ],
    allowedMentions: { users: [], roles: [], parse: [] },
  };
}

export interface RankStats {
  /** 1 based place on the leaderboard, null when the member has no XP yet. */
  position: number | null;
  xp: number;
  messages: number;
  voiceMinutes: number;
}

/** The private "My rank" answer. */
export function buildRankMessage(
  settings: Pick<LevelingSettings, 'color'>,
  ctx: { locale: Locale; member: { displayName: string; avatarUrl: string }; stats: RankStats },
): MessagePayload {
  const texts = levelingManifest.messages[ctx.locale];
  const { level, current, needed } = levelFromXp(ctx.stats.xp);
  const n = (value: number) => formatNumber(value, ctx.locale);
  const description = renderPlaceholders(texts.rank.body, {
    position: ctx.stats.position ? `#${ctx.stats.position}` : '–',
    level,
    xp: n(ctx.stats.xp),
    bar: progressBar(current / needed),
    current: n(current),
    needed: n(needed),
    left: n(needed - current),
    messages: n(ctx.stats.messages),
    voice: n(ctx.stats.voiceMinutes),
  });
  return {
    embeds: [
      buildEmbed({
        emoji: levelingManifest.emoji,
        title: renderPlaceholders(texts.rank.title, { username: ctx.member.displayName }),
        description,
        color: settings.color,
        thumbnailUrl: ctx.member.avatarUrl,
        footer: brandFooter(ctx.locale, texts.name),
      }),
    ],
    allowedMentions: { users: [], roles: [], parse: [] },
  };
}
