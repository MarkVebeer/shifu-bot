import { describe, expect, test } from 'bun:test';
import { collectKeys, coreMessages, createTranslator, findMissingKeys } from '.';

describe('core translations', () => {
  test('every key exists in every language', () => {
    expect(findMissingKeys(coreMessages)).toEqual([]);
  });

  test('every language uses the same placeholders for a key', () => {
    const mismatched = collectKeys(coreMessages.en).filter((key) => {
      const t = (locale: 'en' | 'hu') => createTranslator(coreMessages, locale)(key as never);
      const names = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
      return names(t('en')) !== names(t('hu'));
    });
    expect(mismatched).toEqual([]);
  });
});

describe('findMissingKeys', () => {
  test('reports a key missing in one language', () => {
    expect(findMissingKeys({ en: { a: 'A', b: { c: 'C' } }, hu: { a: 'A' } })).toEqual([
      { locale: 'hu', key: 'b.c' },
    ]);
  });

  test('reports empty strings as missing', () => {
    expect(findMissingKeys({ en: { a: 'A' }, hu: { a: ' ' } })).toEqual([{ locale: 'hu', key: 'a' }]);
  });
});

describe('createTranslator', () => {
  test('interpolates values and falls back to English', () => {
    const messages = { en: { hi: 'Hi {name}', only: 'English only' }, hu: { hi: 'Szia {name}', only: '' } };
    const t = createTranslator(messages, 'hu');
    expect(t('hi', { name: 'Mei' })).toBe('Szia Mei');
    expect(t('only')).toBe('English only');
  });
});
