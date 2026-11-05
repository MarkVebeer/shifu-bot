import { describe, expect, test } from 'bun:test';
import { safeNextPath } from './auth-routes';

describe('safeNextPath', () => {
  test('keeps paths on this site', () => {
    expect(safeNextPath('/servers/123/counter')).toBe('/servers/123/counter');
    expect(safeNextPath('/servers/123/counter?q=mark')).toBe('/servers/123/counter?q=mark');
  });

  test('falls back to /guilds for anything that could leave the site', () => {
    for (const next of [
      undefined,
      null,
      '',
      'https://evil.example',
      '//evil.example',
      '/\\evil.example',
      'javascript:alert(1)',
      '/\tevil',
      '/ok\n',
      `/${'a'.repeat(600)}`,
    ]) {
      expect(safeNextPath(next)).toBe('/guilds');
    }
  });
});
