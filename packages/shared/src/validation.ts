import { z } from 'zod';
import { LOCALES } from './i18n';

/** A Discord ID: 17 to 20 digits. */
export const snowflake = z.string().regex(/^\d{17,20}$/, 'Must be a Discord ID (17-20 digits)');

export const hexColor = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Must be a hex color like #8FA8FF')
  .transform((value) => value.toUpperCase());

/** Only http and https URLs, nothing else (no javascript:, data:, file:). */
export const httpUrl = z
  .string()
  .trim()
  .max(2048, 'URL is too long')
  .url('Must be a valid URL')
  .refine((value) => {
    try {
      const { protocol } = new URL(value);
      return protocol === 'http:' || protocol === 'https:';
    } catch {
      return false;
    }
  }, 'Only http and https URLs are allowed');

export const localeSchema = z.enum(LOCALES);

export const guildSettingsSchema = z.object({
  locale: localeSchema,
});
export type GuildSettings = z.infer<typeof guildSettingsSchema>;
