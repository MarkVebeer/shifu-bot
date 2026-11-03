import { describe, expect, test } from 'bun:test';
import { coreMigrations, migrate, openDatabase } from '../db/database';
import { createLogger } from '../logger';
import { GuildSettingsStore } from './guild-settings';

function createStore() {
  const db = openDatabase(':memory:');
  migrate(db, coreMigrations, createLogger({ level: 'error', pretty: false }));
  return new GuildSettingsStore(db, 'en');
}

const guildId = '123456789012345678';

describe('GuildSettingsStore setup state', () => {
  test('a new server needs setup and uses the default language', () => {
    const store = createStore();
    store.ensure(guildId);
    expect(store.isSetupCompleted(guildId)).toBe(false);
    expect(store.locale(guildId)).toBe('en');
  });

  test('a server without any config needs setup', () => {
    expect(createStore().isSetupCompleted(guildId)).toBe(false);
  });

  test('completing setup is remembered and survives a restart (ensure on ready)', () => {
    const store = createStore();
    store.ensure(guildId);
    store.save(guildId, { locale: 'hu' });
    store.completeSetup(guildId);
    store.ensure(guildId);
    expect(store.isSetupCompleted(guildId)).toBe(true);
    expect(store.locale(guildId)).toBe('hu');
  });

  test('a server that removed the bot and added it again goes through setup again, keeping its language', () => {
    const store = createStore();
    store.ensure(guildId);
    store.save(guildId, { locale: 'hu' });
    store.completeSetup(guildId);
    store.markLeft(guildId);
    store.ensure(guildId);
    expect(store.isSetupCompleted(guildId)).toBe(false);
    expect(store.locale(guildId)).toBe('hu');
  });
});
