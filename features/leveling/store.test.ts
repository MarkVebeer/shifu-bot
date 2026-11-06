import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { migrate } from '../../apps/bot/src/db/database';
import { MAX_MEMBER_XP, xpAdjustSchema } from './manifest';
import feature, { LevelingStore } from './server';
import { adjustedXp } from './xp';

const silent = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as never;

function createStore() {
  const db = new Database(':memory:');
  migrate(db, feature.migrations, silent);
  return { db, store: new LevelingStore(db) };
}

const member = (id: string, displayName = id) => ({ id, displayName, avatarUrl: 'https://cdn.example/a.png' });

/** Gives a member XP the normal way, so a row exists. */
function earn(store: LevelingStore, id: string, text: number, voice = 0, displayName = id) {
  if (text) store.addXp('g', member(id, displayName), text, 'text');
  if (voice) store.addXp('g', member(id, displayName), voice, 'voice');
}

const row = (db: Database, id: string) =>
  db
    .query<{ xp: number; text_xp: number; voice_xp: number; messages: number; voice_minutes: number; voice_day: string | null; voice_day_minutes: number }, [string]>(
      'SELECT xp, text_xp, voice_xp, messages, voice_minutes, voice_day, voice_day_minutes FROM leveling_members WHERE user_id = ?',
    )
    .get(id);

describe('adjustedXp', () => {
  test('adds, takes away and sets', () => {
    expect(adjustedXp(100, 'add', 50)).toBe(150);
    expect(adjustedXp(100, 'remove', 30)).toBe(70);
    expect(adjustedXp(100, 'set', 7)).toBe(7);
  });

  test('stays between 0 and the maximum', () => {
    expect(adjustedXp(100, 'remove', 500)).toBe(0);
    expect(adjustedXp(MAX_MEMBER_XP - 1, 'add', 10)).toBe(MAX_MEMBER_XP);
    expect(adjustedXp(0, 'set', MAX_MEMBER_XP)).toBe(MAX_MEMBER_XP);
  });
});

describe('xpAdjustSchema', () => {
  const valid = (patch: object) => xpAdjustSchema.safeParse({ track: 'text', op: 'add', amount: 10, ...patch }).success;

  test('accepts a correction, with or without a reason', () => {
    expect(valid({})).toBe(true);
    expect(valid({ reason: 'Lost XP after a mistake' })).toBe(true);
  });

  test('refuses nonsense', () => {
    expect(valid({ amount: -1 })).toBe(false);
    expect(valid({ amount: 1.5 })).toBe(false);
    expect(valid({ amount: MAX_MEMBER_XP + 1 })).toBe(false);
    expect(valid({ track: 'overall' })).toBe(false);
    expect(valid({ op: 'multiply' })).toBe(false);
    expect(valid({ reason: 'x'.repeat(201) })).toBe(false);
  });
});

describe('adjustXp', () => {
  test('xp stays the sum of both tracks', () => {
    const { db, store } = createStore();
    earn(store, 'a', 100, 50);
    expect(store.adjustXp('g', 'a', 'text', 'add', 40)).toEqual({ before: 100, after: 140 });
    expect(store.adjustXp('g', 'a', 'voice', 'remove', 500)).toEqual({ before: 50, after: 0 });
    expect(store.adjustXp('g', 'a', 'text', 'set', 10)).toEqual({ before: 140, after: 10 });
    const saved = row(db, 'a')!;
    expect(saved.text_xp).toBe(10);
    expect(saved.voice_xp).toBe(0);
    expect(saved.xp).toBe(10);
  });

  test('leaves the message count, voice minutes and voice cap alone', () => {
    const { db, store } = createStore();
    earn(store, 'a', 100, 50);
    db.query("UPDATE leveling_members SET voice_day = '2026-11-06', voice_day_minutes = 42 WHERE user_id = 'a'").run();
    store.adjustXp('g', 'a', 'voice', 'add', 1000);
    const saved = row(db, 'a')!;
    expect(saved.messages).toBe(1);
    expect(saved.voice_minutes).toBe(1);
    expect(saved.voice_day_minutes).toBe(42);
  });

  test('creates the row of a member without XP, from the snapshot', () => {
    const { db, store } = createStore();
    expect(store.adjustXp('g', 'new', 'voice', 'add', 500, member('new', 'Ádám'))).toEqual({ before: 0, after: 500 });
    const saved = row(db, 'new')!;
    expect(saved.voice_xp).toBe(500);
    expect(saved.text_xp).toBe(0);
    expect(saved.xp).toBe(500);
    expect(store.manageList('g', { by: 'overall', status: 'current', q: 'adam' }).entries[0]?.displayName).toBe('Ádám');
  });

  test('a correction that ends at 0 creates no row', () => {
    const { db, store } = createStore();
    expect(store.adjustXp('g', 'new', 'text', 'remove', 500, member('new'))).toEqual({ before: 0, after: 0 });
    expect(row(db, 'new')).toBeNull();
  });

  test('only touches this server', () => {
    const { db, store } = createStore();
    earn(store, 'a', 100);
    store.adjustXp('other', 'a', 'text', 'add', 40, member('a'));
    expect(row(db, 'a')!.text_xp).toBe(100);
  });
});

describe('resetMember', () => {
  test('clears the XP and its counters but keeps the voice cap', () => {
    const { db, store } = createStore();
    earn(store, 'a', 100, 50);
    db.query("UPDATE leveling_members SET voice_day = '2026-11-06', voice_day_minutes = 42 WHERE user_id = 'a'").run();
    expect(store.resetMember('g', 'a')).toBe(150);
    const saved = row(db, 'a')!;
    expect([saved.xp, saved.text_xp, saved.voice_xp, saved.messages, saved.voice_minutes]).toEqual([0, 0, 0, 0, 0]);
    expect(saved.voice_day).toBe('2026-11-06');
    expect(saved.voice_day_minutes).toBe(42);
  });

  test('null for a member without a row', () => {
    expect(createStore().store.resetMember('g', 'nobody')).toBeNull();
  });
});

describe('manageList', () => {
  function withMembers() {
    const created = createStore();
    earn(created.store, 'a', 300);
    earn(created.store, 'b', 200, 500);
    earn(created.store, 'c', 100);
    return created;
  }

  test('places match the list on the member page', () => {
    const { store } = withMembers();
    for (const by of ['overall', 'text', 'voice'] as const) {
      const shown = store.list('g', { by });
      const managed = store.manageList('g', { by, status: 'current' });
      expect(managed.entries.slice(0, shown.entries.length).map(({ userId, rank }) => ({ userId, rank }))).toEqual(shown.entries.map(({ userId, rank }) => ({ userId, rank })));
    }
  });

  test('members with no XP of the sort kind stay on the list, after the others', () => {
    const { store } = withMembers();
    const { entries, members } = store.manageList('g', { by: 'voice', status: 'current' });
    expect(entries[0]?.userId).toBe('b');
    expect(entries).toHaveLength(3);
    expect(members).toBe(3);
  });

  test('members who left only show under their own status', () => {
    const { store } = withMembers();
    store.setLeft('g', 'a', true);
    const current = store.manageList('g', { by: 'overall', status: 'current' });
    const left = store.manageList('g', { by: 'overall', status: 'left' });
    expect(current.entries.map((entry) => entry.userId)).toEqual(['b', 'c']);
    expect(current.entries.every((entry) => !entry.left)).toBe(true);
    expect(left.entries.map((entry) => entry.userId)).toEqual(['a']);
    expect(left.entries[0]?.left).toBe(true);
  });

  test('a member reset to zero drops off the list', () => {
    const { store } = withMembers();
    store.resetMember('g', 'a');
    expect(store.manageList('g', { by: 'overall', status: 'current' }).entries.map((entry) => entry.userId)).toEqual(['b', 'c']);
    expect(store.managedMember('g', 'a', 'overall')).toBeNull();
  });

  test('search keeps the real place and counts the matches', () => {
    const { store } = withMembers();
    const found = store.manageList('g', { by: 'overall', status: 'current', q: 'c' });
    expect(found.entries.map((entry) => entry.rank)).toEqual([3]);
    expect(found.matches).toBe(1);
    expect(found.members).toBe(3);
  });

  test('managedMember returns the place on the requested list', () => {
    const { store } = withMembers();
    expect(store.managedMember('g', 'b', 'overall')?.rank).toBe(1);
    expect(store.managedMember('g', 'b', 'text')?.rank).toBe(2);
  });
});

describe('idsWithXp', () => {
  test('only names members with XP on this server', () => {
    const { store } = createStore();
    earn(store, 'a', 100);
    earn(store, 'zero', 50);
    store.resetMember('g', 'zero');
    expect([...store.idsWithXp('g', ['a', 'zero', 'none'])]).toEqual(['a']);
    expect(store.idsWithXp('g', []).size).toBe(0);
  });
});
