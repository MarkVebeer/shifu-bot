import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { migrate } from '../../apps/bot/src/db/database';
import { buildGoonPanel, defaultGoonSettings, goonSettingsSchema } from './manifest';
import { buildNickname, NICKNAME_MAX, resolveBaseName, stripSuffix, suffixFor, targetNickname } from './nickname';
import { GOON_MIGRATIONS, GoonStore } from './store';

const silent = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as never;
const FORMAT = ' [{count}]';

function createStore() {
  const db = new Database(':memory:');
  migrate(db, GOON_MIGRATIONS, silent);
  return new GoonStore(db);
}

const MIN = 60_000;
const press = (store: GoonStore, userId: string, now: number, cooldownMs = 3 * MIN) =>
  store.press('g', userId, { now, cooldownMs, displayName: userId, avatarUrl: null });

describe('nickname suffix', () => {
  test('suffixFor fills in the count', () => {
    expect(suffixFor(FORMAT, 12)).toBe(' [12]');
    expect(suffixFor(' 🍆{count}', 3)).toBe(' 🍆3');
  });

  test('stripSuffix removes a counter of the current or the previous format', () => {
    expect(stripSuffix('Mark [12]', [FORMAT])).toBe('Mark');
    expect(stripSuffix('Mark[12]', [FORMAT])).toBe('Mark');
    expect(stripSuffix('Mark (12)', [FORMAT, ' ({count})'])).toBe('Mark');
    expect(stripSuffix('Mark 🍆 7', [' 🍆 {count}'])).toBe('Mark');
    expect(stripSuffix('Mark', [FORMAT])).toBe('Mark');
    // Brackets in the middle of a name are not a counter.
    expect(stripSuffix('[12] Mark', [FORMAT])).toBe('[12] Mark');
    expect(stripSuffix('[5]', [FORMAT])).toBe('');
  });

  test('buildNickname fits the 32 character limit without cutting an emoji', () => {
    expect(buildNickname('Mark', ' [12]')).toBe('Mark [12]');
    const long = buildNickname('A'.repeat(40), ' [123]');
    expect(long.length).toBe(NICKNAME_MAX);
    expect(long.endsWith('… [123]')).toBe(true);
    const emojis = buildNickname('😀'.repeat(20), ' [1]');
    expect(emojis.length).toBeLessThanOrEqual(NICKNAME_MAX);
    expect(emojis).not.toContain('�');
    expect(emojis.endsWith('… [1]')).toBe(true);
  });
});

describe('resolveBaseName', () => {
  const stored = { baseName: 'Mark', lastNick: 'Mark [5]', lastFormat: FORMAT };

  test('keeps the stored name while the nickname is still the one ShifuBot set', () => {
    expect(resolveBaseName({ nickname: 'Mark [5]', ownName: 'mark_v', stored, format: FORMAT })).toBe('Mark');
  });

  test('a member who renamed themselves keeps the new name, with or without the old number', () => {
    expect(resolveBaseName({ nickname: 'Robert', ownName: 'mark_v', stored, format: FORMAT })).toBe('Robert');
    expect(resolveBaseName({ nickname: 'Robert [5]', ownName: 'mark_v', stored, format: FORMAT })).toBe('Robert');
  });

  test('after a format change the old counter is still removed', () => {
    expect(resolveBaseName({ nickname: 'Robert [5]', ownName: 'x', stored, format: ' ({count})' })).toBe('Robert');
  });

  test('a cleared nickname falls back to the member own name', () => {
    expect(resolveBaseName({ nickname: null, ownName: 'mark_v', stored, format: FORMAT })).toBe('mark_v');
    expect(resolveBaseName({ nickname: null, ownName: 'mark_v', stored: null, format: FORMAT })).toBe('mark_v');
    expect(resolveBaseName({ nickname: '[3]', ownName: 'mark_v', stored: null, format: FORMAT })).toBe('mark_v');
  });

  test('targetNickname: count 0 restores the name or removes the nickname', () => {
    expect(targetNickname({ base: 'Mark', count: 4, format: FORMAT, ownName: 'mark_v' })).toBe('Mark [4]');
    expect(targetNickname({ base: 'Mark', count: 0, format: FORMAT, ownName: 'mark_v' })).toBe('Mark');
    expect(targetNickname({ base: 'mark_v', count: 0, format: FORMAT, ownName: 'mark_v' })).toBeNull();
  });
});

describe('settings', () => {
  test('defaults parse, and the format must contain {count} once', () => {
    expect(goonSettingsSchema.safeParse(defaultGoonSettings).success).toBe(true);
    expect(defaultGoonSettings.enabled).toBe(false);
    expect(defaultGoonSettings.cooldownMinutes).toBe(3);
    expect(defaultGoonSettings.undoMinutes).toBe(5);
    expect(goonSettingsSchema.safeParse({ ...defaultGoonSettings, nameFormat: ' [x]' }).success).toBe(false);
    expect(goonSettingsSchema.safeParse({ ...defaultGoonSettings, nameFormat: '{count}{count}' }).success).toBe(false);
    expect(goonSettingsSchema.safeParse({ ...defaultGoonSettings, nameFormat: ' [{count}] goons!' }).success).toBe(false);
    expect(goonSettingsSchema.safeParse({ ...defaultGoonSettings, undoMinutes: 0 }).success).toBe(false);
  });

  test('saved settings round trip, and keep the leading space of the format', () => {
    const store = createStore();
    expect(store.get('g')).toEqual(defaultGoonSettings);
    store.save('g', { ...defaultGoonSettings, enabled: true, nameFormat: ' ({count})' });
    expect(store.get('g').nameFormat).toBe(' ({count})');
    expect(store.get('g').enabled).toBe(true);
  });
});

describe('store: presses, cooldown and undo', () => {
  test('a press counts, the next one waits for the cooldown', () => {
    const store = createStore();
    expect(press(store, 'a', 0)).toEqual({ ok: true, count: 1, pressedAt: 0 });
    expect(press(store, 'a', 2 * MIN)).toEqual({ ok: false, nextAt: 3 * MIN });
    expect(press(store, 'a', 3 * MIN)).toMatchObject({ ok: true, count: 2 });
    // Other members have their own cooldown.
    expect(press(store, 'b', 3 * MIN)).toMatchObject({ ok: true, count: 1 });
  });

  test('undo takes back only recent own presses, at most as many as were made', () => {
    const store = createStore();
    press(store, 'a', 0);
    press(store, 'a', 3 * MIN);
    press(store, 'b', 3 * MIN);
    // At 7 minutes only the second press (3 min) is inside the 5 minute window.
    expect(store.undo('g', 'a', { now: 7 * MIN, windowMs: 5 * MIN })).toBe(1);
    expect(store.undo('g', 'a', { now: 7 * MIN, windowMs: 5 * MIN })).toBeNull();
    // b's press was not touched.
    expect(store.top('g', 10).find((e) => e.userId === 'b')?.count).toBe(1);
    // Never below zero, and nothing to undo for someone who never pressed.
    expect(store.undo('g', 'c', { now: 7 * MIN, windowMs: 5 * MIN })).toBeNull();
  });

  test('after an undo the cooldown counts from the press before it', () => {
    const store = createStore();
    press(store, 'a', 0);
    press(store, 'a', 10 * MIN);
    store.undo('g', 'a', { now: 11 * MIN, windowMs: 5 * MIN });
    expect(press(store, 'a', 11 * MIN)).toMatchObject({ ok: true, count: 2 });
    // A single accidental press undone right away: pressing again is allowed at once.
    const other = createStore();
    press(other, 'a', 0);
    other.undo('g', 'a', { now: MIN, windowMs: 5 * MIN });
    expect(press(other, 'a', MIN)).toMatchObject({ ok: true, count: 1 });
  });

  test('top and total', () => {
    const store = createStore();
    press(store, 'a', 0);
    press(store, 'a', 3 * MIN);
    press(store, 'b', 0);
    press(store, 'c', 0);
    store.undo('g', 'c', { now: MIN, windowMs: 5 * MIN });
    expect(store.top('g', 10).map((e) => [e.userId, e.count])).toEqual([
      ['a', 2],
      ['b', 1],
    ]);
    expect(store.total('g')).toBe(3);
    expect(store.total('other')).toBe(0);
  });

  test('name data is stored per member', () => {
    const store = createStore();
    press(store, 'a', 0);
    store.saveName('g', 'a', { baseName: 'Mark', lastNick: 'Mark [1]', lastFormat: FORMAT });
    expect(store.storedName('g', 'a')).toEqual({ baseName: 'Mark', lastNick: 'Mark [1]', lastFormat: FORMAT });
    expect(store.storedName('g', 'nobody')).toBeNull();
  });
});

describe('panel', () => {
  test('shows the total and the top list, or only the description when turned off', () => {
    const ctx = { locale: 'en' as const, server: { name: 'Test' }, entries: [{ userId: '1', count: 5 }], total: 9 };
    const on = buildGoonPanel(defaultGoonSettings, ctx).embeds![0]!.description!;
    expect(on).toContain('<@1>');
    expect(on).toContain('**9**');
    const off = buildGoonPanel({ ...defaultGoonSettings, showLeaderboard: false }, ctx).embeds![0]!.description!;
    expect(off).not.toContain('<@1>');
    const buttons = buildGoonPanel(defaultGoonSettings, ctx).components![0]!.components;
    expect(buttons.map((b) => b.custom_id)).toEqual(['goon:add', 'goon:undo']);
  });
});
