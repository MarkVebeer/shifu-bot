import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { migrate } from '../../apps/bot/src/db/database';
import { buildCounterPanel, COUNTER_IDS, counterSettingsSchema, defaultCounterSettings, LEADERBOARD_SIZE, listPath } from './manifest';
import { COUNTER_MIGRATIONS, COUNTER_TABLES, CounterStore, escapeLike, foldName } from './store';

const silent = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as never;

function createStore() {
  const db = new Database(':memory:');
  migrate(db, COUNTER_MIGRATIONS, silent);
  const store = new CounterStore(db);
  const id = store.create('g', defaultCounterSettings).id;
  return { db, store, id };
}

const MIN = 60_000;
const press = (store: CounterStore, id: number, userId: string, now: number, cooldownMs = 3 * MIN, displayName = userId) =>
  store.press(id, 'g', userId, { now, cooldownMs, displayName, avatarUrl: null });

describe('settings', () => {
  const valid = (patch: Partial<typeof defaultCounterSettings>) => counterSettingsSchema.safeParse({ ...defaultCounterSettings, ...patch }).success;

  test('defaults parse and have the agreed values', () => {
    expect(valid({})).toBe(true);
    expect(defaultCounterSettings.enabled).toBe(false);
    expect(defaultCounterSettings.cooldownMinutes).toBe(3);
    expect(defaultCounterSettings.undoMinutes).toBe(5);
    expect(valid({ undoMinutes: 0 })).toBe(false);
  });

  test('a counter needs a name', () => {
    expect(valid({ name: '   ' })).toBe(false);
    expect(valid({ name: 'x'.repeat(51) })).toBe(false);
    expect(valid({ name: 'Fekvőtámasz' })).toBe(true);
  });

  test('the emoji must be exactly one emoji', () => {
    for (const emoji of ['☕', '➕', '💪🏽', '👨‍👩‍👧', '1️⃣']) expect(valid({ emoji })).toBe(true);
    for (const emoji of ['', 'ab', '1', '☕☕', '☕ a']) expect(valid({ emoji })).toBe(false);
  });
});

describe('store: counters', () => {
  test('create, read, save and count, only within the own server', () => {
    const { store, id } = createStore();
    expect(store.count('g')).toBe(1);
    expect(store.getCounter('g', id)?.settings).toEqual(defaultCounterSettings);
    expect(store.getCounter('other', id)).toBeNull();
    expect(store.getCounter('g', 9999)).toBeNull();

    store.save(id, { ...defaultCounterSettings, name: 'Kávé', enabled: true });
    expect(store.getCounter('g', id)?.settings.name).toBe('Kávé');
    expect(store.getCounter('other', id)).toBeNull();

    const second = store.create('g', { ...defaultCounterSettings, name: 'Tea' });
    expect(store.listCounters('g').map((counter) => counter.id)).toEqual([id, second.id]);
    expect(store.listCounters('other')).toEqual([]);
  });

  test('counters on one server count separately, each with its own cooldown', () => {
    const { store, id } = createStore();
    const other = store.create('g', defaultCounterSettings).id;
    expect(press(store, id, 'a', 0)).toMatchObject({ ok: true, count: 1 });
    expect(press(store, other, 'a', 0)).toMatchObject({ ok: true, count: 1 });
    expect(press(store, id, 'a', MIN)).toMatchObject({ ok: false });
    expect(press(store, id, 'a', 3 * MIN)).toMatchObject({ ok: true, count: 2 });
    expect(store.total(id)).toBe(2);
    expect(store.total(other)).toBe(1);
    expect(store.rankOf(other, 'a')).toEqual({ rank: 1, count: 1 });
    // Undo only touches the counter it was pressed on.
    expect(store.undo(other, 'a', { now: 3 * MIN, windowMs: 5 * MIN })).toBe(0);
    expect(store.total(id)).toBe(2);
  });

  test('delete removes the counter with its counts and presses, and only on its own server', () => {
    const { db, store, id } = createStore();
    const kept = store.create('g', defaultCounterSettings).id;
    press(store, id, 'a', 0);
    press(store, kept, 'a', 0);

    store.delete('other', id);
    expect(store.getCounter('g', id)).not.toBeNull();
    expect(store.total(id)).toBe(1);

    store.delete('g', id);
    expect(store.getCounter('g', id)).toBeNull();
    expect(store.total(id)).toBe(0);
    expect(db.query('SELECT * FROM counter_presses WHERE counter_id = ?').all(id)).toEqual([]);
    expect(store.total(kept)).toBe(1);
    expect(store.count('g')).toBe(1);
  });

  test('every table can be cleaned up by guild_id', () => {
    const { db } = createStore();
    for (const table of COUNTER_TABLES) {
      expect(db.query<{ name: string }, []>(`PRAGMA table_info(${table})`).all().map((c) => c.name)).toContain('guild_id');
    }
  });

  test('panel and last error belong to one counter', () => {
    const { store, id } = createStore();
    const other = store.create('g', defaultCounterSettings).id;
    store.setPanel(id, { channelId: '1', messageId: '2' });
    store.setError(id, 'send_failed');
    expect(store.panel(id)).toEqual({ channelId: '1', messageId: '2' });
    expect(store.panel(other)).toBeNull();
    expect(store.lastError(id)?.code).toBe('send_failed');
    expect(store.lastError(other)).toBeNull();
    // Saving clears the error, but keeps the panel.
    store.save(id, defaultCounterSettings);
    expect(store.lastError(id)).toBeNull();
    expect(store.panel(id)).toEqual({ channelId: '1', messageId: '2' });
  });
});

describe('store: presses, cooldown and undo', () => {
  test('a press counts, the next one waits for the cooldown', () => {
    const { store, id } = createStore();
    expect(press(store, id, 'a', 0)).toEqual({ ok: true, count: 1, pressedAt: 0 });
    expect(press(store, id, 'a', 2 * MIN)).toEqual({ ok: false, nextAt: 3 * MIN });
    expect(press(store, id, 'a', 3 * MIN)).toMatchObject({ ok: true, count: 2 });
    // Other members have their own cooldown.
    expect(press(store, id, 'b', 3 * MIN)).toMatchObject({ ok: true, count: 1 });
  });

  test('undo takes back only recent own presses, at most as many as were made', () => {
    const { store, id } = createStore();
    press(store, id, 'a', 0);
    press(store, id, 'a', 3 * MIN);
    press(store, id, 'b', 3 * MIN);
    // At 7 minutes only the second press (3 min) is inside the 5 minute window.
    expect(store.undo(id, 'a', { now: 7 * MIN, windowMs: 5 * MIN })).toBe(1);
    expect(store.undo(id, 'a', { now: 7 * MIN, windowMs: 5 * MIN })).toBeNull();
    // b's press was not touched.
    expect(store.top(id, 10).find((e) => e.userId === 'b')?.count).toBe(1);
    // Nothing to undo for someone who never pressed.
    expect(store.undo(id, 'c', { now: 7 * MIN, windowMs: 5 * MIN })).toBeNull();
  });

  test('after an undo the cooldown counts from the press before it', () => {
    const { store, id } = createStore();
    press(store, id, 'a', 0);
    press(store, id, 'a', 10 * MIN);
    store.undo(id, 'a', { now: 11 * MIN, windowMs: 5 * MIN });
    expect(press(store, id, 'a', 11 * MIN)).toMatchObject({ ok: true, count: 2 });
    // A single accidental press undone right away: pressing again is allowed at once.
    const fresh = createStore();
    press(fresh.store, fresh.id, 'a', 0);
    fresh.store.undo(fresh.id, 'a', { now: MIN, windowMs: 5 * MIN });
    expect(press(fresh.store, fresh.id, 'a', MIN)).toMatchObject({ ok: true, count: 1 });
  });

  test('top and total', () => {
    const { store, id } = createStore();
    press(store, id, 'a', 0);
    press(store, id, 'a', 3 * MIN);
    press(store, id, 'b', 0);
    press(store, id, 'c', 0);
    store.undo(id, 'c', { now: MIN, windowMs: 5 * MIN });
    expect(store.top(id, 10).map((e) => [e.userId, e.count])).toEqual([
      ['a', 2],
      ['b', 1],
    ]);
    expect(store.total(id)).toBe(3);
    expect(store.total(id + 1)).toBe(0);
  });
});

describe('store: full list', () => {
  function seeded() {
    const { store, id } = createStore();
    // anna 3, bob 2 (pressed last at 7), cleo 2 (pressed last at 5, so ahead of bob), dan_50% 1.
    for (const at of [0, 3, 6]) press(store, id, 'anna', at * MIN, 0, 'Anna');
    for (const at of [1, 7]) press(store, id, 'bob', at * MIN, 0, 'Bob');
    for (const at of [2, 5]) press(store, id, 'cleo', at * MIN, 0, 'Cleo');
    press(store, id, 'dan', 4 * MIN, 0, 'dan_50%');
    return { store, id };
  }

  test('ranks by count, earlier last press first on a tie', () => {
    const { store, id } = seeded();
    const { entries, matches } = store.list(id);
    expect(entries.map((e) => [e.rank, e.userId, e.count])).toEqual([
      [1, 'anna', 3],
      [2, 'cleo', 2],
      [3, 'bob', 2],
      [4, 'dan', 1],
    ]);
    expect(matches).toBe(4);
  });

  test('search is case insensitive and keeps the real rank', () => {
    const { store, id } = seeded();
    expect(store.list(id, { q: 'BO' }).entries.map((e) => [e.rank, e.userId])).toEqual([[3, 'bob']]);
    expect(store.list(id, { q: 'zzz' })).toEqual({ entries: [], matches: 0 });
  });

  test('search ignores accents and case outside ASCII', () => {
    const { store, id } = createStore();
    press(store, id, 'adam', 0, 0, 'Ádám');
    press(store, id, 'zsofi', 0, 0, 'ZSÓFI');
    for (const q of ['ádám', 'ADAM', 'Ádám', 'dá']) expect(store.list(id, { q }).entries.map((e) => e.userId)).toEqual(['adam']);
    expect(store.list(id, { q: 'zsófi' }).entries.map((e) => e.userId)).toEqual(['zsofi']);
    expect(foldName('Árvíztűrő TÜKÖRFÚRÓGÉP')).toBe('arvizturo tukorfurogep');
  });

  test('LIKE wildcards in the search are matched literally', () => {
    const { store, id } = seeded();
    expect(escapeLike('50%_\\')).toBe('50\\%\\_\\\\');
    expect(store.list(id, { q: '%' }).entries.map((e) => e.userId)).toEqual(['dan']);
    expect(store.list(id, { q: '_' }).entries.map((e) => e.userId)).toEqual(['dan']);
  });

  test('paging, limits and own rank', () => {
    const { store, id } = seeded();
    const page = store.list(id, { offset: 1, limit: 2 });
    expect(page.entries.map((e) => e.rank)).toEqual([2, 3]);
    expect(page.matches).toBe(4);
    expect(store.list(id, { limit: 10_000 }).entries).toHaveLength(4);
    expect(store.rankOf(id, 'bob')).toEqual({ rank: 3, count: 2 });
    expect(store.rankOf(id, 'nobody')).toBeNull();
  });
});

describe('old goon counter', () => {
  test('finds its panels, then its tables can be dropped', () => {
    const { db, store } = createStore();
    expect(store.hasLegacyGoonTables()).toBe(false);
    expect(store.legacyGoonPanels()).toEqual([]);

    db.exec(`
      CREATE TABLE goon_settings (guild_id TEXT PRIMARY KEY, panel_channel_id TEXT, panel_message_id TEXT);
      CREATE TABLE goon_members (guild_id TEXT);
      CREATE TABLE goon_presses (guild_id TEXT);
      INSERT INTO goon_settings VALUES ('g', '1', '2'), ('h', NULL, NULL);
    `);
    expect(store.hasLegacyGoonTables()).toBe(true);
    expect(store.legacyGoonPanels()).toEqual([{ guildId: 'g', panel: { channelId: '1', messageId: '2' } }]);

    store.dropLegacyGoonTables();
    expect(store.hasLegacyGoonTables()).toBe(false);
    const left = db.query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'goon_%'").all();
    expect(left).toEqual([]);
  });
});

describe('panel', () => {
  const listUrl = `https://shifu.example.com${listPath('123', 7)}`;
  const updatedAt = new Date('2026-01-01T00:00:00Z');
  const pushUps = { ...defaultCounterSettings, name: 'Push-ups', unit: 'push-ups', emoji: '💪' };

  test('list path and button ids carry the counter', () => {
    expect(listPath('123', 7)).toBe('/servers/123/counter?c=7');
    expect(COUNTER_IDS.parse(COUNTER_IDS.add(7))).toEqual({ action: 'add', counterId: 7 });
    expect(COUNTER_IDS.parse(COUNTER_IDS.undo(7))).toEqual({ action: 'undo', counterId: 7 });
    for (const other of ['goon:add', 'counter:add', 'counter:add:x', 'counter:reset:7']) expect(COUNTER_IDS.parse(other)).toBeNull();
  });

  test('shows the name, unit, emoji, total, top 20, a linked title and a Full list button', () => {
    const entries = Array.from({ length: 25 }, (_, i) => ({ userId: String(1000 + i), count: 30 - i }));
    const payload = buildCounterPanel(7, pushUps, { locale: 'en', server: { name: 'Test' }, entries, total: 99, listUrl, updatedAt });
    const embed = payload.embeds[0]!;
    expect(embed.title).toBe('💪 Push-ups');
    expect(embed.url).toBe(listUrl);
    expect(embed.footer?.text).toContain('Push-ups');
    expect(embed.description!.split('\n').at(-1)).toBe('Updated <t:1767225600:R>');
    expect(embed.description).toContain('💪 Server total: **99** push-ups');
    expect(embed.description).toContain(`<@${1000 + LEADERBOARD_SIZE - 1}>`);
    expect(embed.description).not.toContain(`<@${1000 + LEADERBOARD_SIZE}>`);
    const buttons = payload.components![0]!.components;
    expect(buttons.map((b) => ('url' in b ? b.url : b.custom_id))).toEqual(['counter:add:7', 'counter:undo:7', listUrl]);
    expect(buttons[0]!.emoji).toEqual({ name: '💪' });
    expect(LEADERBOARD_SIZE).toBe(20);
    // Listing members never pings them.
    expect(payload.allowedMentions).toEqual({ users: [], roles: [], parse: [] });
  });

  test('without the leaderboard the description, the update time and the buttons stay', () => {
    const ctx = { locale: 'hu' as const, server: { name: 'Test' }, entries: [{ userId: '1', count: 5 }], total: 9, listUrl, updatedAt };
    const payload = buildCounterPanel(7, { ...defaultCounterSettings, showLeaderboard: false }, ctx);
    expect(payload.embeds[0]!.description).not.toContain('<@1>');
    expect(payload.embeds[0]!.description).toEndWith('Frissítve <t:1767225600:R>');
    expect(payload.components![0]!.components).toHaveLength(3);
  });

  test('an empty unit falls back to the server language, and placeholders are filled in', () => {
    const ctx = { server: { name: 'Teszt' }, entries: [], total: 2, listUrl, updatedAt };
    const hu = buildCounterPanel(7, { ...defaultCounterSettings, name: 'Kávé' }, { ...ctx, locale: 'hu' });
    expect(hu.embeds[0]!.description).toContain('Szerver összesen: **2** alkalom');
    const custom = buildCounterPanel(7, { ...defaultCounterSettings, name: 'Kávé', unit: 'csésze', title: '{name} @ {server}', description: 'Eddig {unit}' }, { ...ctx, locale: 'hu' });
    expect(custom.embeds[0]!.title).toBe('➕ Kávé @ Teszt');
    expect(custom.embeds[0]!.description).toStartWith('Eddig csésze');
  });
});
