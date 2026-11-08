import { Database } from 'bun:sqlite';
import { beforeEach, describe, expect, setSystemTime, test } from 'bun:test';
import { migrate } from '../../apps/bot/src/db/database';
import verificationFeature, { VerificationStore } from './server';

const silent = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as never;

let db: Database;
let store: VerificationStore;

/** Marks members one millisecond apart, so the newest is the last one given. */
function verify(guildId: string, ...userIds: string[]) {
  userIds.forEach((userId, index) => {
    setSystemTime(new Date(1_000_000 + index));
    store.markVerified(guildId, userId);
  });
  setSystemTime();
}

const ids = (rows: { user_id: string }[]) => rows.map((row) => row.user_id);

beforeEach(() => {
  db = new Database(':memory:');
  migrate(db, verificationFeature.migrations, silent);
  store = new VerificationStore(db);
});

describe('listVerified', () => {
  test('newest first, with paging and the number of matches', () => {
    verify('g', '100', '200', '300');
    expect(ids(store.listVerified('g', { limit: 2 }).rows)).toEqual(['300', '200']);
    const second = store.listVerified('g', { limit: 2, offset: 2 });
    expect(ids(second.rows)).toEqual(['100']);
    expect(second.matches).toBe(3);
  });

  test('only shows the own server', () => {
    verify('g', '100');
    verify('other', '200');
    expect(ids(store.listVerified('g', { limit: 10 }).rows)).toEqual(['100']);
  });

  test('filters to the given ids, and an empty search result shows nobody', () => {
    verify('g', '100', '200', '300');
    const found = store.listVerified('g', { ids: ['100', '300', '999'], limit: 10 });
    expect(ids(found.rows)).toEqual(['300', '100']);
    expect(found.matches).toBe(2);
    expect(store.listVerified('g', { ids: [], limit: 10 })).toEqual({ matches: 0, rows: [] });
  });

  test('filters by the start of the id', () => {
    verify('g', '12345', '12399', '91234');
    expect(ids(store.listVerified('g', { idPrefix: '123', limit: 10 }).rows)).toEqual(['12399', '12345']);
  });
});

describe('removeVerified', () => {
  test('takes the member off the list, so the next verify needs a captcha again', () => {
    verify('g', '100');
    expect(store.removeVerified('g', '100')).toBe(true);
    expect(store.isVerified('g', '100')).toBe(false);
    expect(store.verifiedCount('g')).toBe(0);
  });

  test('reports a member who was not on the list', () => {
    expect(store.removeVerified('g', '100')).toBe(false);
  });

  test('only touches the own server', () => {
    verify('g', '100');
    verify('other', '100');
    store.removeVerified('g', '100');
    expect(store.isVerified('other', '100')).toBe(true);
  });
});

test('the migration creates the index the list sorts by', () => {
  const index = db.query("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_verification_members_date'").get();
  expect(index).toEqual({ name: 'idx_verification_members_date' });
});
