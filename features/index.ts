/**
 * Feature registry. To add a feature, create features/<id>/ with manifest.ts,
 * server.ts and web.tsx, then add its manifest to this list. That is all.
 */
import {
  coreMessages,
  createTranslator,
  LOCALES,
  type CoreMessages,
  type Locale,
  type MessageKey,
} from '@shifubot/shared';
import { goodbyeManifest } from './goodbye/manifest';
import { verificationManifest } from './verification/manifest';
import { welcomeManifest } from './welcome/manifest';

export const features = [welcomeManifest, goodbyeManifest, verificationManifest] as const;

export type FeatureId = (typeof features)[number]['id'];

type FeatureMessages = {
  [F in (typeof features)[number] as F['id']]: F['messages']['en'];
};

/** Core translations plus every feature's translations under its id. */
export type AppMessages = CoreMessages & FeatureMessages;
export type AppMessageKey = MessageKey<AppMessages>;

export const messages = Object.fromEntries(
  LOCALES.map((locale) => [
    locale,
    {
      ...coreMessages[locale],
      ...Object.fromEntries(features.map((feature) => [feature.id, feature.messages[locale]])),
    },
  ]),
) as Record<Locale, AppMessages>;

export function getTranslator(locale: Locale) {
  return createTranslator(messages, locale);
}
