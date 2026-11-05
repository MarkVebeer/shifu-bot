/**
 * The one shared format for every Discord message ShifuBot sends.
 * Embeds built here are plain JSON in the Discord API shape, so the bot can send
 * them as is and the dashboard can render the exact same object as a preview.
 */
import { coreMessages, type Locale } from './i18n';
import { renderPlaceholders } from './placeholders';
import { DEFAULT_EMBED_COLOR, colors, hexToInt } from './tokens';

/** The emoji set shared by Discord messages and the dashboard copy. */
export const emoji = {
  welcome: '👋',
  goodbye: '🚪',
  verification: '🛡️',
  leveling: '🏆',
  /** Leveling tracks: chat level, voice level, overall level. */
  chat: '💬',
  voice: '🎙️',
  overall: '⭐',
  success: '✅',
  warning: '⚠️',
  error: '⛔',
  info: '💠',
  sparkle: '✨',
  test: '🧪',
  log: '📋',
  counter: '🔢',
  globe: '🌐',
  overview: '🧭',
  settings: '⚙️',
  rocket: '🚀',
} as const;

export type EmojiName = keyof typeof emoji;

/** Discord limits, see https://discord.com/developers/docs/resources/message#embed-object-embed-limits */
export const EMBED_LIMITS = {
  title: 256,
  description: 4096,
  footer: 2048,
  content: 2000,
} as const;

export interface EmbedData {
  title?: string;
  /** Makes the title a link. */
  url?: string;
  description?: string;
  color: number;
  thumbnail?: { url: string };
  image?: { url: string };
  footer?: { text: string };
  timestamp?: string;
}

/** Discord button styles used by ShifuBot. */
export const ButtonStyle = { Primary: 1, Secondary: 2, Success: 3, Link: 5 } as const;

/** A button that sends an interaction to the bot. */
export interface InteractionButtonData {
  type: 2;
  style: Exclude<(typeof ButtonStyle)[keyof typeof ButtonStyle], 5>;
  label: string;
  custom_id: string;
  emoji?: { name: string };
}

/** A button that opens a URL in the browser. */
export interface LinkButtonData {
  type: 2;
  style: typeof ButtonStyle.Link;
  label: string;
  url: string;
  emoji?: { name: string };
}

export type ButtonData = InteractionButtonData | LinkButtonData;

export interface ActionRowData {
  type: 1;
  components: ButtonData[];
}

export interface MessagePayload {
  content?: string;
  embeds: EmbedData[];
  /** Buttons below the message, in the Discord API shape. */
  components?: ActionRowData[];
  allowedMentions: { users: string[]; roles: string[]; parse: [] };
}

export interface EmbedInput {
  emoji: EmojiName;
  title: string;
  description?: string;
  color?: string | null;
  thumbnailUrl?: string | null;
  imageUrl?: string | null;
  footer: string;
  timestamp?: Date;
}

function clamp(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Title style shared by all messages: "<emoji> <title>". */
export function formatTitle(name: EmojiName, title: string): string {
  return clamp(`${emoji[name]} ${title.trim()}`, EMBED_LIMITS.title);
}

/** Default footer wording, identical to the dashboard copy: "ShifuBot • <feature>". */
export function brandFooter(locale: Locale, featureName: string): string {
  return renderPlaceholders(coreMessages[locale].discord.footer, { feature: featureName });
}

export function buildEmbed(input: EmbedInput): EmbedData {
  const embed: EmbedData = {
    title: formatTitle(input.emoji, input.title),
    color: hexToInt(input.color ?? DEFAULT_EMBED_COLOR),
    footer: { text: clamp(input.footer, EMBED_LIMITS.footer) },
  };
  if (input.description?.trim()) embed.description = clamp(input.description, EMBED_LIMITS.description);
  if (input.thumbnailUrl) embed.thumbnail = { url: input.thumbnailUrl };
  if (input.imageUrl) embed.image = { url: input.imageUrl };
  if (input.timestamp) embed.timestamp = input.timestamp.toISOString();
  return embed;
}

/** Colors for status embeds (errors, warnings) the bot may send in future features. */
export const statusColors = {
  success: colors.success,
  warning: colors.warning,
  error: colors.danger,
  info: colors.primary,
} as const;
