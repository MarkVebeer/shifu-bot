/**
 * Goon counter: the part shared by the bot and the dashboard.
 * A panel message in a channel has a +1 button and an Undo button. Each press
 * adds one to the member's count, which ShifuBot writes after their nickname.
 * Presses have a cooldown, and a press can be undone for a few minutes. The
 * panel shows the server total and the top 10. The panel builder below is used
 * for both the real message and the dashboard preview.
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
import { COUNT_TOKEN } from './nickname';

export const goonManifest = defineFeature({
  id: 'goon',
  emoji: 'goon',
  messages: { en, hu },
});

export const GOON_PLACEHOLDERS = ['server'] as const;

/** Custom ids of the Discord components. Prefixed so other features never collide. */
export const GOON_IDS = {
  add: 'goon:add',
  undo: 'goon:undo',
} as const;

export const LEADERBOARD_SIZE = 10;
export const NAME_FORMAT_MAX = 12;

export const goonSettingsSchema = z.object({
  enabled: z.boolean(),
  channelId: snowflake.nullable(),
  /** Empty string means "use the default text of the server language". */
  title: z.string().trim().max(200, 'Title can be at most 200 characters'),
  description: z.string().trim().max(2000, 'Description can be at most 2000 characters'),
  buttonLabel: z.string().trim().max(80, 'Button label can be at most 80 characters'),
  undoLabel: z.string().trim().max(80, 'Button label can be at most 80 characters'),
  color: hexColor.nullable(),
  /** Minutes a member must wait between two presses. 0 turns it off. */
  cooldownMinutes: z.number().int().min(0, 'Must be 0 or more').max(60, 'At most 60 minutes'),
  /** Minutes a press can still be undone. */
  undoMinutes: z.number().int().min(1, 'At least 1 minute').max(30, 'At most 30 minutes'),
  /** Write the count after the member's nickname. */
  renameMembers: z.boolean(),
  /** What goes after the name, e.g. " [{count}]". Not trimmed: the leading space is part of it. */
  nameFormat: z
    .string()
    .max(NAME_FORMAT_MAX, `At most ${NAME_FORMAT_MAX} characters`)
    .refine((value) => value.split(COUNT_TOKEN).length === 2, `Must contain ${COUNT_TOKEN} exactly once`),
  /** Show the server total and the top 10 on the panel. */
  showLeaderboard: z.boolean(),
});

export type GoonSettings = z.infer<typeof goonSettingsSchema>;

export const defaultGoonSettings: GoonSettings = {
  enabled: false,
  channelId: null,
  title: '',
  description: '',
  buttonLabel: '',
  undoLabel: '',
  color: null,
  cooldownMinutes: 3,
  undoMinutes: 5,
  renameMembers: true,
  nameFormat: ' [{count}]',
  showLeaderboard: true,
};

export interface GoonEntry {
  userId: string;
  count: number;
}

const MEDALS = ['🥇', '🥈', '🥉'];

const formatNumber = (value: number, locale: Locale) => value.toLocaleString(locale === 'hu' ? 'hu-HU' : 'en-US');

export function buildGoonPanel(
  settings: Pick<GoonSettings, 'title' | 'description' | 'buttonLabel' | 'undoLabel' | 'color' | 'showLeaderboard'>,
  ctx: { locale: Locale; server: { name: string }; entries: GoonEntry[]; total: number },
): MessagePayload {
  const texts = goonManifest.messages[ctx.locale];
  const values = { server: ctx.server.name };
  let description = renderPlaceholders(settings.description || texts.defaults.description, values);

  if (settings.showLeaderboard) {
    const lines = ctx.entries
      .filter((entry) => entry.count > 0)
      .slice(0, LEADERBOARD_SIZE)
      .map((entry, index) =>
        renderPlaceholders(texts.panel.line, {
          rank: MEDALS[index] ?? `\`#${index + 1}\``,
          user: `<@${entry.userId}>`,
          count: formatNumber(entry.count, ctx.locale),
        }),
      );
    const total = renderPlaceholders(texts.panel.total, { count: formatNumber(ctx.total, ctx.locale) });
    description += `\n\n${total}\n\n**${texts.panel.top}**\n${lines.length ? lines.join('\n') : texts.panel.empty}`;
  }

  return {
    embeds: [
      buildEmbed({
        emoji: goonManifest.emoji,
        title: renderPlaceholders(settings.title || texts.defaults.title, values),
        description,
        color: settings.color,
        footer: brandFooter(ctx.locale, texts.name),
      }),
    ],
    components: [
      {
        type: 1,
        components: [
          {
            type: 2,
            style: ButtonStyle.Success,
            label: (settings.buttonLabel || texts.defaults.button).slice(0, 80),
            custom_id: GOON_IDS.add,
            emoji: { name: '🍆' },
          },
          {
            type: 2,
            style: ButtonStyle.Secondary,
            label: (settings.undoLabel || texts.defaults.undo).slice(0, 80),
            custom_id: GOON_IDS.undo,
            emoji: { name: '↩️' },
          },
        ],
      },
    ],
    allowedMentions: { users: [], roles: [], parse: [] },
  };
}
