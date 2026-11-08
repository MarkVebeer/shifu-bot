import { describe, expect, test } from 'bun:test';
import { loadConfig } from './config';

const base = {
  DISCORD_TOKEN: 'token',
  DISCORD_CLIENT_ID: '123456789012345678',
  DISCORD_CLIENT_SECRET: 'secret',
  PUBLIC_URL: 'https://shifu.example.com',
  SESSION_SECRET: 'x'.repeat(32),
};

describe('ALLOWED_GUILD_IDS', () => {
  test('missing or blank means no restriction', () => {
    expect(loadConfig(base).allowedGuildIds.size).toBe(0);
    expect(loadConfig({ ...base, ALLOWED_GUILD_IDS: '   ' }).allowedGuildIds.size).toBe(0);
  });

  test('accepts spaces, a trailing comma and duplicates', () => {
    const { allowedGuildIds } = loadConfig({
      ...base,
      ALLOWED_GUILD_IDS: ' 111111111111111111, 222222222222222222 ,111111111111111111,',
    });
    expect([...allowedGuildIds]).toEqual(['111111111111111111', '222222222222222222']);
  });

  test('refuses to start with an invalid id', () => {
    expect(() => loadConfig({ ...base, ALLOWED_GUILD_IDS: '111111111111111111,abc' })).toThrow(/ALLOWED_GUILD_IDS/);
  });
});
