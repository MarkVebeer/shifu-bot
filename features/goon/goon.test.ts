import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { migrate } from '../../apps/bot/src/db/database';
import { buildGoonPanel, defaultGoonSettings, goonSettingsSchema, LEADERBOARD_SIZE, listPath } from './manifest';
import { escapeLike, foldName, GOON_MIGRATIONS, GoonStore } from './store';

const silent = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as never;

function createStore() {
  const db = new Database(':memory:');
  migrate(db, GOON_MIGRATIONS, silent);
  return { db, store: new GoonStore(db) };
}

const MIN = 60_000;
const press = (store: GoonStore, userId: string, now: number, cooldownMs = 3 * MIN, displayName = userId) =>
  store.press('g', userId, { now, cooldownMs, displayName, avatarUrl: null });

describe('settings', () => {
  test('defaults parse and have the agreed values', () => {
    expect(goonSettingsSchema.safeParse(defaultGoonSettings).success).toBe(true);
    expect(defaultGoonSettings.enabled).toBe(false);
    expect(defaultGoonSettings.cooldownMinutes).toBe(3);
    expect(defaultGoonSettings.undoMinutes).toBe(5);
    expect(goonSettingsSchema.safeParse({ ...defaultGoonSettings, undoMinutes: 0 }).success).toBe(false);
  });

  test('saved settings round trip, and settings saved with the old nickname options still load', () => {
    const { db, store } = createStore();
    expect(store.get('g')).toEqual(defaultGoonSettings);
    store.save('g', { ...defaultGoonSettings, enabled: true });
    expect(store.get('g').enabled).toBe(true);

    db.query('INSERT INTO goon_settings (guild_id, settings, updated_at) VALUES (?, ?, ?)').run(
      'old',
      JSON.stringify({ ...defaultGoonSettings, enabled: true, renameMembers: true, nameFormat: ' [{count}]' }),
      0,
    );
    const old = store.get('old');
    expect(old.enabled).toBe(true);
    expect(old).not.toHaveProperty('nameFormat');
  });
});

describe('store: presses, cooldown and undo', () => {
  test('a press counts, the next one waits for the cooldown', () => {
    const { store } = createStore();
    expect(press(store, 'a', 0)).toEqual({ ok: true, count: 1, pressedAt: 0 });
    expect(press(store, 'a', 2 * MIN)).toEqual({ ok: false, nextAt: 3 * MIN });
    expect(press(store, 'a', 3 * MIN)).toMatchObject({ ok: true, count: 2 });
    // Other members have their own cooldown.
    expect(press(store, 'b', 3 * MIN)).toMatchObject({ ok: true, count: 1 });
  });

  test('undo takes back only recent own presses, at most as many as were made', () => {
    const { store } = createStore();
    press(store, 'a', 0);
    press(store, 'a', 3 * MIN);
    press(store, 'b', 3 * MIN);
    // At 7 minutes only the second press (3 min) is inside the 5 minute window.
    expect(store.undo('g', 'a', { now: 7 * MIN, windowMs: 5 * MIN })).toBe(1);
    expect(store.undo('g', 'a', { now: 7 * MIN, windowMs: 5 * MIN })).toBeNull();
    // b's press was not touched.
    expect(store.top('g', 10).find((e) => e.userId === 'b')?.count).toBe(1);
    // Nothing to undo for someone who never pressed.
    expect(store.undo('g', 'c', { now: 7 * MIN, windowMs: 5 * MIN })).toBeNull();
  });

  test('after an undo the cooldown counts from the press before it', () => {
    const { store } = createStore();
    press(store, 'a', 0);
    press(store, 'a', 10 * MIN);
    store.undo('g', 'a', { now: 11 * MIN, windowMs: 5 * MIN });
    expect(press(store, 'a', 11 * MIN)).toMatchObject({ ok: true, count: 2 });
    // A single accidental press undone right away: pressing again is allowed at once.
    const other = createStore().store;
    press(other, 'a', 0);
    other.undo('g', 'a', { now: MIN, windowMs: 5 * MIN });
    expect(press(other, 'a', MIN)).toMatchObject({ ok: true, count: 1 });
  });

  test('top and total', () => {
    const { store } = createStore();
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
});

describe('store: full list', () => {
  function seeded() {
    const { store } = createStore();
    // anna 3, bob 2 (pressed last at 7), cleo 2 (pressed last at 5, so ahead of bob), dan_50% 1.
    for (const at of [0, 3, 6]) press(store, 'anna', at * MIN, 0, 'Anna');
    for (const at of [1, 7]) press(store, 'bob', at * MIN, 0, 'Bob');
    for (const at of [2, 5]) press(store, 'cleo', at * MIN, 0, 'Cleo');
    press(store, 'dan', 4 * MIN, 0, 'dan_50%');
    return store;
  }

  test('ranks by count, earlier last press first on a tie', () => {
    const { entries, matches } = seeded().list('g');
    expect(entries.map((e) => [e.rank, e.userId, e.count])).toEqual([
      [1, 'anna', 3],
      [2, 'cleo', 2],
      [3, 'bob', 2],
      [4, 'dan', 1],
    ]);
    expect(matches).toBe(4);
  });

  test('search is case insensitive and keeps the real rank', () => {
    const store = seeded();
    expect(store.list('g', { q: 'BO' }).entries.map((e) => [e.rank, e.userId])).toEqual([[3, 'bob']]);
    expect(store.list('g', { q: 'zzz' })).toEqual({ entries: [], matches: 0 });
  });

  test('search ignores accents and case outside ASCII', () => {
    const { store } = createStore();
    press(store, 'adam', 0, 0, 'Ádám');
    press(store, 'zsofi', 0, 0, 'ZSÓFI');
    for (const q of ['ádám', 'ADAM', 'Ádám', 'dá']) expect(store.list('g', { q }).entries.map((e) => e.userId)).toEqual(['adam']);
    expect(store.list('g', { q: 'zsófi' }).entries.map((e) => e.userId)).toEqual(['zsofi']);
    expect(foldName('Árvíztűrő TÜKÖRFÚRÓGÉP')).toBe('arvizturo tukorfurogep');
  });

  test('LIKE wildcards in the search are matched literally', () => {
    const store = seeded();
    expect(escapeLike('50%_\\')).toBe('50\\%\\_\\\\');
    expect(store.list('g', { q: '%' }).entries.map((e) => e.userId)).toEqual(['dan']);
    expect(store.list('g', { q: '_' }).entries.map((e) => e.userId)).toEqual(['dan']);
  });

  test('paging, limits and own rank', () => {
    const store = seeded();
    const page = store.list('g', { offset: 1, limit: 2 });
    expect(page.entries.map((e) => e.rank)).toEqual([2, 3]);
    expect(page.matches).toBe(4);
    expect(store.list('g', { limit: 10_000 }).entries).toHaveLength(4);
    expect(store.rankOf('g', 'bob')).toEqual({ rank: 3, count: 2 });
    expect(store.rankOf('g', 'nobody')).toBeNull();
  });
});

describe('migrations', () => {
  test('goon_002 drops the nickname columns from a database made by goon_001', () => {
    const db = new Database(':memory:');
    migrate(db, [GOON_MIGRATIONS[0]!], silent);
    db.query("INSERT INTO goon_members (guild_id, user_id, count, display_name, base_name) VALUES ('g', 'a', 4, 'Mark', 'Mark')").run();
    migrate(db, GOON_MIGRATIONS, silent);
    const columns = db.query<{ name: string }, []>('PRAGMA table_info(goon_members)').all().map((c) => c.name);
    expect(columns).not.toContain('base_name');
    expect(columns).not.toContain('last_nick');
    expect(columns).not.toContain('last_format');
    const store = new GoonStore(db);
    expect(store.total('g')).toBe(4);
    // Rows from before the search column are found by name right away.
    expect(store.list('g', { q: 'mark' }).entries.map((e) => e.userId)).toEqual(['a']);
  });
});

describe('panel', () => {
  const listUrl = `https://shifu.example.com${listPath('123')}`;
  const updatedAt = new Date('2026-01-01T00:00:00Z');

  test('shows the total, the top 20, a linked title and a Full list button', () => {
    const entries = Array.from({ length: 25 }, (_, i) => ({ userId: String(1000 + i), count: 30 - i }));
    const payload = buildGoonPanel(defaultGoonSettings, { locale: 'en', server: { name: 'Test' }, entries, total: 99, listUrl, updatedAt });
    const embed = payload.embeds[0]!;
    expect(embed.url).toBe(listUrl);
    expect(embed.description!.split('\n').at(-1)).toBe('Updated <t:1767225600:R>');
    expect(embed.description).toContain('**99**');
    expect(embed.description).toContain(`<@${1000 + LEADERBOARD_SIZE - 1}>`);
    expect(embed.description).not.toContain(`<@${1000 + LEADERBOARD_SIZE}>`);
    const buttons = payload.components![0]!.components;
    expect(buttons.map((b) => ('url' in b ? b.url : b.custom_id))).toEqual(['goon:add', 'goon:undo', listUrl]);
    expect(LEADERBOARD_SIZE).toBe(20);
  });

  test('without the leaderboard the description, the update time and the buttons stay', () => {
    const ctx = { locale: 'hu' as const, server: { name: 'Test' }, entries: [{ userId: '1', count: 5 }], total: 9, listUrl, updatedAt };
    const payload = buildGoonPanel({ ...defaultGoonSettings, showLeaderboard: false }, ctx);
    expect(payload.embeds[0]!.description).not.toContain('<@1>');
    expect(payload.embeds[0]!.description).toEndWith('Frissítve <t:1767225600:R>');
    expect(payload.components![0]!.components).toHaveLength(3);
  });
});
