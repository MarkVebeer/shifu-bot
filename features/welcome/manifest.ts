/**
 * Welcome feature: the part shared by the bot and the dashboard.
 * The embed builder below is the only place a welcome message is assembled,
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

export const welcomeManifest = defineFeature({
  id: 'welcome',
  emoji: 'welcome',
  messages: { en, hu },
});

export const WELCOME_PLACEHOLDERS = ['user', 'username', 'server', 'memberCount'] as const;

export const welcomeSettingsSchema = z.object({
  enabled: z.boolean(),
  channelId: snowflake.nullable(),
  /** Empty string means "use the default text of the server language". */
  title: z.string().trim().max(200, 'Title can be at most 200 characters'),
  description: z.string().trim().max(2000, 'Description can be at most 2000 characters'),
  color: hexColor.nullable(),
  showAvatar: z.boolean(),
  bannerUrl: z.preprocess((value) => (value === '' ? null : value), httpUrl.nullable()),
  footer: z.string().trim().max(200, 'Footer can be at most 200 characters'),
  mentionUser: z.boolean(),
});

export type WelcomeSettings = z.infer<typeof welcomeSettingsSchema>;

export const defaultWelcomeSettings: WelcomeSettings = {
  enabled: false,
  channelId: null,
  title: '',
  description: '',
  color: null,
  showAvatar: true,
  bannerUrl: null,
  footer: '',
  mentionUser: true,
};

export interface WelcomeContext {
  locale: Locale;
  member: { id: string; username: string; displayName: string; avatarUrl: string };
  server: { name: string; memberCount: number };
  now?: Date;
}

export function buildWelcomeMessage(settings: WelcomeSettings, ctx: WelcomeContext): MessagePayload {
  const texts = welcomeManifest.messages[ctx.locale];
  const values = {
    user: `<@${ctx.member.id}>`,
    username: ctx.member.displayName,
    server: ctx.server.name,
    memberCount: ctx.server.memberCount,
  };
  // Mentions do not render in embed titles or footers, so use the plain name there.
  const plainValues = { ...values, user: ctx.member.displayName };

  const embed = buildEmbed({
    emoji: welcomeManifest.emoji,
    title: renderPlaceholders(settings.title || texts.defaults.title, plainValues),
    description: renderPlaceholders(settings.description || texts.defaults.description, values),
    color: settings.color,
    thumbnailUrl: settings.showAvatar ? ctx.member.avatarUrl : null,
    imageUrl: settings.bannerUrl,
    footer: settings.footer
      ? renderPlaceholders(settings.footer, plainValues)
      : brandFooter(ctx.locale, texts.name),
    timestamp: ctx.now ?? new Date(),
  });

  return {
    ...(settings.mentionUser ? { content: `<@${ctx.member.id}>` } : {}),
    embeds: [embed],
    allowedMentions: { users: settings.mentionUser ? [ctx.member.id] : [], roles: [], parse: [] },
  };
}
