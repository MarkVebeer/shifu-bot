/**
 * Verification feature: the part shared by the bot and the dashboard.
 * New members click a button on a panel message, solve a captcha (or just
 * click, in button mode) and get the verified role. The panel builder below is
 * used for both the real message and the dashboard preview.
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

export const verificationManifest = defineFeature({
  id: 'verification',
  emoji: 'verification',
  messages: { en, hu },
});

export const VERIFICATION_PLACEHOLDERS = ['server'] as const;

export const VERIFICATION_MODES = ['captcha', 'button'] as const;
export type VerificationMode = (typeof VERIFICATION_MODES)[number];

/** Custom ids of the Discord components. Prefixed so other features never collide. */
export const VERIFY_IDS = {
  start: 'verification:start',
  answer: 'verification:answer',
  refresh: 'verification:refresh',
  modal: 'verification:modal',
  codeInput: 'verification:code',
} as const;

/** Captcha rules, shown in the dashboard and enforced by the bot. */
export const CAPTCHA_RULES = {
  expiresMinutes: 5,
  /** Wrong answers are counted per member for this long, across new pictures too. */
  attemptsWindowMinutes: 60,
} as const;

/** What happens when a member runs out of captcha tries. */
export const FAIL_ACTIONS = ['retry', 'timeout', 'kick', 'ban'] as const;
export type FailAction = (typeof FAIL_ACTIONS)[number];

/** Discord's longest timeout: 28 days. */
export const MAX_TIMEOUT_MINUTES = 40_320;

export const verificationSettingsSchema = z.object({
  enabled: z.boolean(),
  channelId: snowflake.nullable(),
  roleId: snowflake.nullable(),
  mode: z.enum(VERIFICATION_MODES),
  /** Empty string means "use the default text of the server language". */
  title: z.string().trim().max(200, 'Title can be at most 200 characters'),
  description: z.string().trim().max(2000, 'Description can be at most 2000 characters'),
  buttonLabel: z.string().trim().max(80, 'Button label can be at most 80 characters'),
  color: hexColor.nullable(),
  /** Accounts younger than this many days cannot verify. 0 turns the check off. */
  minAccountAgeDays: z.number().int().min(0, 'Must be 0 or more').max(365, 'At most 365 days'),
  /** Wrong captcha answers allowed before failAction runs. */
  maxAttempts: z.number().int().min(1, 'At least 1 try').max(10, 'At most 10 tries'),
  failAction: z.enum(FAIL_ACTIONS),
  /** Length of the timeout when failAction is "timeout". */
  timeoutMinutes: z.number().int().min(1, 'At least 1 minute').max(MAX_TIMEOUT_MINUTES, 'At most 28 days (40320 minutes)'),
});

export type VerificationSettings = z.infer<typeof verificationSettingsSchema>;

export const defaultVerificationSettings: VerificationSettings = {
  enabled: false,
  channelId: null,
  roleId: null,
  mode: 'captcha',
  title: '',
  description: '',
  buttonLabel: '',
  color: null,
  minAccountAgeDays: 0,
  maxAttempts: 3,
  failAction: 'retry',
  timeoutMinutes: 10,
};

export interface PanelContext {
  locale: Locale;
  server: { name: string };
}

export function buildVerificationPanel(settings: VerificationSettings, ctx: PanelContext): MessagePayload {
  const texts = verificationManifest.messages[ctx.locale];
  const values = { server: ctx.server.name };
  const description = settings.description || texts.defaults[settings.mode === 'captcha' ? 'descriptionCaptcha' : 'descriptionButton'];

  return {
    embeds: [
      buildEmbed({
        emoji: verificationManifest.emoji,
        title: renderPlaceholders(settings.title || texts.defaults.title, values),
        description: renderPlaceholders(description, values),
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
            custom_id: VERIFY_IDS.start,
            emoji: { name: '✅' },
          },
        ],
      },
    ],
    allowedMentions: { users: [], roles: [], parse: [] },
  };
}

/** A captcha is only for captcha mode, and only once: a member who verified before just presses the button. */
export function needsCaptcha(mode: VerificationMode, verifiedBefore: boolean): boolean {
  return mode === 'captcha' && !verifiedBefore;
}

/** Whole days since a Discord account was created. */
export function accountAgeDays(createdAt: Date, now = new Date()): number {
  return Math.floor((now.getTime() - createdAt.getTime()) / 86_400_000);
}
