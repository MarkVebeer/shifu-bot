import type { EmojiName } from './format';
import type { Locale, MessageTree } from './i18n';

/**
 * The part of a feature that both the bot and the dashboard load. It must stay
 * free of server only (bun:sqlite, discord.js) and browser only code.
 */
export interface FeatureManifest<Id extends string = string, M extends MessageTree = MessageTree> {
  /** URL and database friendly id, e.g. "welcome". */
  id: Id;
  emoji: EmojiName;
  /** Translations, merged under the feature id: t('welcome.name'). Each must contain "name" and "description". */
  messages: Record<Locale, M>;
}

export function defineFeature<const Id extends string, M extends MessageTree & { name: string; description: string }>(
  manifest: { id: Id; emoji: EmojiName; messages: { en: M; hu: NoInfer<M> } },
): FeatureManifest<Id, M> {
  return manifest;
}
