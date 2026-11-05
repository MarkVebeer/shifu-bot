/**
 * Counters: the part shared by the bot and the dashboard.
 * A server can have several counters, each named on the dashboard ("Push-ups", "Coffee").
 * Each has a panel message in a channel with a +1 button and an Undo button. Each press
 * adds one to the member's count. Presses have a cooldown, and a press can be undone for
 * a few minutes. The panel shows the counter's total and the top 20, and links to a page
 * with the full list that only members can open. The panel builder below is used for both
 * the real message and the dashboard preview.
 */
import {
  brandFooter,
  buildEmbed,
  ButtonStyle,
  defineFeature,
  EMBED_LIMITS,
  hexColor,
  renderPlaceholders,
  snowflake,
  type Locale,
  type MessagePayload,
} from '@shifubot/shared';
import { z } from 'zod';
import en from './i18n/en.json';
import hu from './i18n/hu.json';

export const counterManifest = defineFeature({
  id: 'counter',
  emoji: 'counter',
  messages: { en, hu },
});

export const COUNTER_PLACEHOLDERS = ['server', 'name', 'unit'] as const;

/** Custom ids of the Discord components. They carry the counter, so one server can have many panels. */
export const COUNTER_IDS = {
  add: (counterId: number) => `counter:add:${counterId}`,
  undo: (counterId: number) => `counter:undo:${counterId}`,
  parse(customId: string): { action: 'add' | 'undo'; counterId: number } | null {
    const match = /^counter:(add|undo):(\d+)$/.exec(customId);
    return match ? { action: match[1] as 'add' | 'undo', counterId: Number(match[2]) } : null;
  },
} as const;

/** Members shown on the Discord panel and the dashboard. The full list is on the member page. */
export const LEADERBOARD_SIZE = 20;

/** Path of the full list page of a counter, relative to the dashboard address. */
export const listPath = (guildId: string, counterId: number) => `/servers/${guildId}/counter?c=${counterId}`;

export const DEFAULT_COUNTER_EMOJI = '➕';

/** One emoji, including skin tones and joined emoji. Built at runtime: the v flag is newer than the compile target. */
const SINGLE_EMOJI = new RegExp('^\\p{RGI_Emoji}$', 'v');

export const counterSettingsSchema = z.object({
  enabled: z.boolean(),
  channelId: snowflake.nullable(),
  name: z.string().trim().min(1, 'Give the counter a name').max(50, 'Name can be at most 50 characters'),
  /** What is being counted, e.g. "push-ups". Empty string means the default word of the server language. */
  unit: z.string().trim().max(30, 'Unit can be at most 30 characters'),
  emoji: z.string().trim().regex(SINGLE_EMOJI, 'Must be a single emoji'),
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
  /** Show the total and the top 20 on the panel. */
  showLeaderboard: z.boolean(),
});

export type CounterSettings = z.infer<typeof counterSettingsSchema>;

export const defaultCounterSettings: CounterSettings = {
  enabled: false,
  channelId: null,
  name: 'Counter',
  unit: '',
  emoji: DEFAULT_COUNTER_EMOJI,
  title: '',
  description: '',
  buttonLabel: '',
  undoLabel: '',
  color: null,
  cooldownMinutes: 3,
  undoMinutes: 5,
  showLeaderboard: true,
};

export interface CounterEntry {
  userId: string;
  count: number;
}

const MEDALS = ['🥇', '🥈', '🥉'];

const formatNumber = (value: number, locale: Locale) => value.toLocaleString(locale === 'hu' ? 'hu-HU' : 'en-US');

/** The word shown after a number: the counter's unit, or the default of the server language. */
export const unitOf = (settings: Pick<CounterSettings, 'unit'>, locale: Locale) => settings.unit || counterManifest.messages[locale].defaults.unit;

export function buildCounterPanel(
  counterId: number,
  settings: Pick<CounterSettings, 'name' | 'unit' | 'emoji' | 'title' | 'description' | 'buttonLabel' | 'undoLabel' | 'color' | 'showLeaderboard'>,
  ctx: {
    locale: Locale;
    server: { name: string };
    entries: CounterEntry[];
    total: number;
    /** Absolute URL of the full list page. */
    listUrl: string;
    /** When the panel was drawn, shown as "Updated 2 minutes ago". */
    updatedAt: Date;
  },
): MessagePayload {
  const texts = counterManifest.messages[ctx.locale];
  const unit = unitOf(settings, ctx.locale);
  const values = { server: ctx.server.name, name: settings.name, unit };
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
    const total = renderPlaceholders(texts.panel.total, { emoji: settings.emoji, count: formatNumber(ctx.total, ctx.locale), unit });
    description += `\n\n${total}\n\n**${texts.panel.top}**\n${lines.length ? lines.join('\n') : texts.panel.empty}`;
  }
  // <t:…:R> is rendered by Discord as "2 minutes ago" and keeps counting by itself.
  description += `\n\n${renderPlaceholders(texts.panel.updated, { time: `<t:${Math.floor(ctx.updatedAt.getTime() / 1000)}:R>` })}`;

  const title = renderPlaceholders(settings.title || texts.defaults.title, values);
  return {
    embeds: [
      {
        ...buildEmbed({
          emoji: counterManifest.emoji,
          title,
          description,
          color: settings.color,
          footer: brandFooter(ctx.locale, settings.name),
        }),
        // The counter's own emoji instead of the feature's.
        title: `${settings.emoji} ${title.trim()}`.slice(0, EMBED_LIMITS.title),
        url: ctx.listUrl,
      },
    ],
    components: [
      {
        type: 1,
        components: [
          {
            type: 2,
            style: ButtonStyle.Success,
            label: (settings.buttonLabel || texts.defaults.button).slice(0, 80),
            custom_id: COUNTER_IDS.add(counterId),
            emoji: { name: settings.emoji },
          },
          {
            type: 2,
            style: ButtonStyle.Secondary,
            label: (settings.undoLabel || texts.defaults.undo).slice(0, 80),
            custom_id: COUNTER_IDS.undo(counterId),
            emoji: { name: '↩️' },
          },
          { type: 2, style: ButtonStyle.Link, label: texts.panel.fullList, url: ctx.listUrl, emoji: { name: '📜' } },
        ],
      },
    ],
    allowedMentions: { users: [], roles: [], parse: [] },
  };
}
