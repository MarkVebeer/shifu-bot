/**
 * Leveling feature: the part shared by the bot and the dashboard.
 * Members earn chat XP for messages and voice XP for time in voice channels.
 * Each track has its own level; the overall level and the leaderboard use the
 * sum of both. Level ups are announced per track, and a leaderboard panel in a
 * channel is kept up to date. The builders below make the real messages and
 * the dashboard previews.
 */
import {
  brandFooter,
  buildEmbed,
  ButtonStyle,
  defineFeature,
  emoji,
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
  /** Most voice XP one member can earn per UTC day: about one active chat day (~500 XP). */
  voiceDailyCap: 600,
  /**
   * Minutes of talking it takes to reach the daily cap (8 hours). Voice XP is spread evenly over them,
   * 1.25 XP a minute (5 XP every 4 minutes), so voice is worth a little less than chatting.
   */
  voiceCapMinutes: 480,
  /** Average voice XP per minute, for display. */
  voicePerMinute: 600 / 480,
} as const;

/** The two independent XP tracks. "text" is shown as Chat, "voice" as Voice. */
export const LEVEL_TRACKS = ['text', 'voice'] as const;
export type LevelTrack = (typeof LEVEL_TRACKS)[number];

/** Emoji of each level kind, used everywhere so chat, voice and overall are never confused. */
export const LEVEL_EMOJI = { text: 'chat', voice: 'voice', overall: 'overall' } as const;

/** What earns XP on a server: messages and voice, messages only, or voice only. */
export const XP_SOURCES = ['both', 'text', 'voice'] as const;
export type XpSources = (typeof XP_SOURCES)[number];

/** The tracks that count for a server, in display order. */
export function activeTracks(sources: XpSources): LevelTrack[] {
  return sources === 'both' ? ['text', 'voice'] : [sources];
}

/** The level kinds to show: the overall level only exists when both tracks count. */
export function shownLevels(sources: XpSources): (LevelTrack | 'overall')[] {
  return sources === 'both' ? ['overall', 'text', 'voice'] : [sources];
}

/** XP a member is ranked by: the total when both count, otherwise the one active track. */
export function rankingXp(xp: TrackXp, sources: XpSources): number {
  return sources === 'both' ? xp.textXp + xp.voiceXp : sources === 'text' ? xp.textXp : xp.voiceXp;
}

export const LEVEL_UP_PLACEHOLDERS = ['user', 'username', 'level', 'track', 'server'] as const;
export const ANNOUNCE_MODES = ['current', 'channel', 'off'] as const;
export type AnnounceMode = (typeof ANNOUNCE_MODES)[number];
export const LEADERBOARD_INTERVALS = [1, 5, 15, 60] as const;
export const LEADERBOARD_SIZES = [5, 10, 15, 20] as const;
export const RANK_BUTTON_ID = 'leveling:rank';

const oneOf = <T extends readonly number[]>(values: T, message: string) =>
  z.number().refine((value): value is T[number] => values.includes(value), message) as unknown as z.ZodType<T[number]>;

export const levelingSettingsSchema = z.object({
  enabled: z.boolean(),
  xpSources: z.enum(XP_SOURCES),
  /** Text, voice channels and categories where nobody earns XP. */
  ignoredChannelIds: z.array(snowflake).max(100, 'At most 100 channels').transform((ids) => [...new Set(ids)]),
  announceMode: z.enum(ANNOUNCE_MODES),
  /** Only used when announceMode is "channel". "current" posts where it happened and needs no channel. */
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
  xpSources: 'both',
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

export interface TrackXp {
  textXp: number;
  voiceXp: number;
}

export interface Levels {
  text: LevelProgress;
  voice: LevelProgress;
  /** From the total XP (chat + voice). */
  overall: LevelProgress;
  totalXp: number;
}

/** Chat, voice and overall level of a member. The one place these are computed. */
export function levelsFor(xp: TrackXp): Levels {
  const totalXp = xp.textXp + xp.voiceXp;
  return { text: levelFromXp(xp.textXp), voice: levelFromXp(xp.voiceXp), overall: levelFromXp(totalXp), totalXp };
}

/** "▰▰▰▱▱▱▱▱▱▱" style bar, safe in embeds on every platform. */
export function progressBar(fraction: number, width = 12): string {
  const filled = Math.round(Math.min(1, Math.max(0, fraction)) * width);
  return '▰'.repeat(filled) + '▱'.repeat(width - filled);
}

const formatNumber = (value: number, locale: Locale) => value.toLocaleString(locale === 'hu' ? 'hu-HU' : 'en-US');

/** "💬 Chat", "🎙️ Voice" or "⭐ Overall" in the server language. */
export function levelLabel(kind: LevelTrack | 'overall', locale: Locale): string {
  return `${emoji[LEVEL_EMOJI[kind]]} ${levelingManifest.messages[locale].tracks[kind]}`;
}

export interface LevelUpContext {
  locale: Locale;
  member: { id: string; displayName: string; avatarUrl: string };
  /** Which level went up: the chat level or the voice level. */
  track: LevelTrack;
  level: number;
  server: { name: string };
  now?: Date;
}

export function buildLevelUpMessage(settings: LevelingSettings, ctx: LevelUpContext): MessagePayload {
  const texts = levelingManifest.messages[ctx.locale];
  const values = {
    user: `<@${ctx.member.id}>`,
    username: ctx.member.displayName,
    level: ctx.level,
    track: texts.tracks[ctx.track],
    server: ctx.server.name,
  };
  // Mentions do not render in embed titles, so use the plain name there.
  const plainValues = { ...values, user: ctx.member.displayName };
  return {
    ...(settings.mentionUser ? { content: `<@${ctx.member.id}>` } : {}),
    embeds: [
      buildEmbed({
        // The title starts with 💬 or 🎙️ so members see at a glance which level went up.
        emoji: LEVEL_EMOJI[ctx.track],
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

export interface LeaderboardEntry extends TrackXp {
  userId: string;
}

const MEDALS = ['🥇', '🥈', '🥉'];

/**
 * Ranked by the XP that counts on the server (see rankingXp). With both sources each line shows the
 * overall, chat and voice level; with one source only that level.
 */
export function buildLeaderboardPanel(
  settings: Pick<LevelingSettings, 'color' | 'leaderboardSize' | 'xpSources'>,
  ctx: { locale: Locale; server: { name: string }; entries: LeaderboardEntry[]; updatedAt: Date },
): MessagePayload {
  const texts = levelingManifest.messages[ctx.locale];
  const lines = [...ctx.entries]
    .filter((entry) => rankingXp(entry, settings.xpSources) > 0)
    .sort((a, b) => rankingXp(b, settings.xpSources) - rankingXp(a, settings.xpSources))
    .slice(0, settings.leaderboardSize)
    .map((entry, index) => {
      const levels = levelsFor(entry);
      return renderPlaceholders(texts.leaderboard.line, {
        rank: MEDALS[index] ?? `\`#${index + 1}\``,
        user: `<@${entry.userId}>`,
        levels: shownLevels(settings.xpSources)
          .map((kind) => `${levelLabel(kind, ctx.locale)} ${levels[kind].level}`)
          .join(' · '),
        xp: formatNumber(rankingXp(entry, settings.xpSources), ctx.locale),
      });
    });
  // The legend explains the overall level, which only exists when both sources count.
  const legend =
    settings.xpSources === 'both' ? `*${renderPlaceholders(texts.leaderboard.legend, { overall: levelLabel('overall', ctx.locale) })}*\n` : '';
  // <t:…:R> is rendered by Discord as "2 minutes ago" and keeps counting by itself.
  const updated = renderPlaceholders(texts.leaderboard.updated, { time: `<t:${Math.floor(ctx.updatedAt.getTime() / 1000)}:R>` });
  return {
    embeds: [
      buildEmbed({
        emoji: levelingManifest.emoji,
        title: renderPlaceholders(texts.leaderboard.title, { server: ctx.server.name }),
        description: lines.length ? `${lines.join('\n')}\n\n${legend}${updated}` : `${texts.leaderboard.empty}\n\n${updated}`,
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

export interface RankStats extends TrackXp {
  /** 1 based place on the leaderboard (by rankingXp), null when the member has no XP that counts yet. */
  position: number | null;
  messages: number;
  voiceMinutes: number;
}

/** The private "My rank" answer: each level that counts on the server, with its progress. */
export function buildRankMessage(
  settings: Pick<LevelingSettings, 'color' | 'xpSources'>,
  ctx: { locale: Locale; member: { displayName: string; avatarUrl: string }; stats: RankStats },
): MessagePayload {
  const texts = levelingManifest.messages[ctx.locale];
  const levels = levelsFor(ctx.stats);
  const n = (value: number) => formatNumber(value, ctx.locale);
  const block = (kind: LevelTrack | 'overall', progress: LevelProgress, xp: number, extra: string) =>
    renderPlaceholders(texts.rank.block, {
      label: levelLabel(kind, ctx.locale),
      level: progress.level,
      xp: n(xp),
      bar: progressBar(progress.current / progress.needed),
      current: n(progress.current),
      needed: n(progress.needed),
      left: n(progress.needed - progress.current),
      extra,
    });
  const blocks = {
    overall: () => block('overall', levels.overall, levels.totalXp, texts.rank.overallExtra),
    text: () => block('text', levels.text, ctx.stats.textXp, renderPlaceholders(texts.rank.textExtra, { messages: n(ctx.stats.messages) })),
    voice: () => block('voice', levels.voice, ctx.stats.voiceXp, renderPlaceholders(texts.rank.voiceExtra, { minutes: n(ctx.stats.voiceMinutes) })),
  };
  const description = [
    renderPlaceholders(texts.rank.position, { position: ctx.stats.position ? `#${ctx.stats.position}` : '–' }),
    ...shownLevels(settings.xpSources).map((kind) => blocks[kind]()),
  ].join('\n\n');
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

