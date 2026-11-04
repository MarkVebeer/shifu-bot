/**
 * Goodbye feature: the part shared by the bot and the dashboard.
 * The embed builder below is the only place a goodbye message is assembled,
 * so the live preview and the real Discord message can never drift apart.
 */
import {
  brandFooter,
  buildEmbed,
  defineFeature,
  hexColor,
  httpUrl,
  renderPlaceholders,
  snowflake,
  type Locale,
  type MessagePayload,
} from '@shifubot/shared';
import { z } from 'zod';
import en from './i18n/en.json';
import hu from './i18n/hu.json';

export const goodbyeManifest = defineFeature({
  id: 'goodbye',
  emoji: 'goodbye',
  messages: { en, hu },
});

/**
 * No {user} mention here: the member already left, so a mention would not notify
 * anyone and often renders as "@unknown-user".
 */
export const GOODBYE_PLACEHOLDERS = ['username', 'server', 'memberCount'] as const;

export const goodbyeSettingsSchema = z.object({
  enabled: z.boolean(),
  channelId: snowflake.nullable(),
  /** Empty string means "use the default text of the server language". */
  title: z.string().trim().max(200, 'Title can be at most 200 characters'),
  description: z.string().trim().max(2000, 'Description can be at most 2000 characters'),
  color: hexColor.nullable(),
  showAvatar: z.boolean(),
  bannerUrl: z.preprocess((value) => (value === '' ? null : value), httpUrl.nullable()),
  footer: z.string().trim().max(200, 'Footer can be at most 200 characters'),
});

export type GoodbyeSettings = z.infer<typeof goodbyeSettingsSchema>;

export const defaultGoodbyeSettings: GoodbyeSettings = {
  enabled: false,
  channelId: null,
  title: '',
  description: '',
  color: null,
  showAvatar: true,
  bannerUrl: null,
  footer: '',
};

export interface GoodbyeContext {
  locale: Locale;
  member: { id: string; username: string; displayName: string; avatarUrl: string };
  /** memberCount is the count after the member left. */
  server: { name: string; memberCount: number };
  now?: Date;
}

export function buildGoodbyeMessage(settings: GoodbyeSettings, ctx: GoodbyeContext): MessagePayload {
  const texts = goodbyeManifest.messages[ctx.locale];
  const values = {
    username: ctx.member.displayName,
    server: ctx.server.name,
    memberCount: ctx.server.memberCount,
  };

  const embed = buildEmbed({
    emoji: goodbyeManifest.emoji,
    title: renderPlaceholders(settings.title || texts.defaults.title, values),
    description: renderPlaceholders(settings.description || texts.defaults.description, values),
    color: settings.color,
    thumbnailUrl: settings.showAvatar ? ctx.member.avatarUrl : null,
    imageUrl: settings.bannerUrl,
    footer: settings.footer ? renderPlaceholders(settings.footer, values) : brandFooter(ctx.locale, texts.name),
    timestamp: ctx.now ?? new Date(),
  });

  return {
    embeds: [embed],
    allowedMentions: { users: [], roles: [], parse: [] },
  };
}
