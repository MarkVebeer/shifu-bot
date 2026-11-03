import { describe, expect, test } from 'bun:test';
import { collectKeys, findMissingKeys, LOCALES } from '@shifubot/shared';
import { features, messages } from '.';

describe('translations of the app and every registered feature', () => {
  test('no key is missing in any language', () => {
    expect(findMissingKeys(messages)).toEqual([]);
  });

  for (const feature of features) {
    test(`feature "${feature.id}" has the same keys in every language`, () => {
      const reference = collectKeys(feature.messages.en).sort();
      for (const locale of LOCALES) {
        expect(collectKeys(feature.messages[locale]).sort()).toEqual(reference);
      }
    });
  }

  test('placeholders match between languages', () => {
    const names = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
    const lookup = (tree: unknown, key: string) =>
      key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown>)[part], tree) as string;
    const mismatched = collectKeys(messages.en).filter(
      (key) => names(lookup(messages.en, key)) !== names(lookup(messages.hu, key)),
    );
    expect(mismatched).toEqual([]);
  });
});
