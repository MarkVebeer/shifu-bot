import { renderPlaceholders, type PlaceholderValues } from '../placeholders';
import en from './en.json';
import hu from './hu.json';

export const LOCALES = ['en', 'hu'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

export type CoreMessages = typeof en;
export const coreMessages: Record<Locale, CoreMessages> = { en, hu };

/** A nested object of translation strings. */
export interface MessageTree {
  [key: string]: string | MessageTree;
}

/** All dot separated leaf paths of a message tree, e.g. "common.save". */
export type MessageKey<T> = {
  [K in keyof T & string]: T[K] extends string ? K : `${K}.${MessageKey<T[K]>}`;
}[keyof T & string];

export type Translator<T> = (key: MessageKey<T>, values?: PlaceholderValues) => string;

function lookup(tree: unknown, key: string): string | undefined {
  let node: unknown = tree;
  for (const part of key.split('.')) {
    if (node === null || typeof node !== 'object') return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === 'string' ? node : undefined;
}

/**
 * Build a typed translator for one locale. Missing keys fall back to English,
 * then to the key itself, so a gap never crashes the UI or the bot.
 */
export function createTranslator<T>(messages: Record<Locale, T>, locale: Locale): Translator<T> {
  return (key, values) => {
    const raw = lookup(messages[locale], key) || lookup(messages[DEFAULT_LOCALE], key) || key;
    return values ? renderPlaceholders(raw, values) : raw;
  };
}

/** List every leaf key of a message tree. */
export function collectKeys(tree: unknown, prefix = ''): string[] {
  if (tree === null || typeof tree !== 'object') return [];
  return Object.entries(tree as Record<string, unknown>).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof value === 'string' ? [path] : collectKeys(value, path);
  });
}

/** Keys present in one locale but missing (or empty) in another. */
export function findMissingKeys(messages: Record<Locale, unknown>): { locale: Locale; key: string }[] {
  const all = new Set(LOCALES.flatMap((locale) => collectKeys(messages[locale])));
  const missing: { locale: Locale; key: string }[] = [];
  for (const locale of LOCALES) {
    for (const key of all) {
      const value = lookup(messages[locale], key);
      if (value === undefined || value.trim() === '') missing.push({ locale, key });
    }
  }
  return missing;
}
