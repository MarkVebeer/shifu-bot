import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { AuditLogEvent } from 'discord-api-types/v10';
import { migrate } from '../../apps/bot/src/db/database';
import { settingsChanges } from '../../apps/bot/src/http/guild-routes';
import { auditEntryRecord, auditEntryType, csvCell, memberChangeRecords, plain, voiceRecords, type VoiceLike } from './collect';
import en from './i18n/en.json';
import {
  AUDIT_ACTIONS,
  AUDIT_CATEGORIES,
  auditFilterSchema,
  auditSettingsSchema,
  categoryOf,
  defaultAuditSettings,
  isTypeEnabled,
  REMOVED_TYPES,
  typesByCategory,
} from './manifest';
import { auditMigrations, AuditStore, AuditWriter, searchTextOf, usedInvite, type UserSnapshot } from './store';

const silent = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as never;

function createStore() {
  const db = new Database(':memory:');
  migrate(db, auditMigrations, silent);
  return { db, store: new AuditStore(db) };
}

describe('csvCell', () => {
  test('neutralises text a spreadsheet would run as a formula', () => {
    expect(csvCell('=HYPERLINK("http://evil.example")')).toBe(`"'=HYPERLINK(""http://evil.example"")"`);
    for (const text of ['=1+1', '+1', '-1', '@SUM(A1)']) expect(csvCell(text)).toBe(`'${text}`);
    expect(csvCell('\tcmd')).toBe(`'\tcmd`);
    expect(csvCell('\rcmd')).toBe(`"'\rcmd"`);
  });

  test('leaves ordinary values alone', () => {
    expect(csvCell('Márk')).toBe('Márk');
    expect(csvCell('a=b')).toBe('a=b');
    expect(csvCell('123456789012345678')).toBe('123456789012345678');
    expect(csvCell('2026-11-08T10:00:00.000Z')).toBe('2026-11-08T10:00:00.000Z');
    expect(csvCell(42)).toBe('42');
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
  });

  test('quotes commas, quotes and line breaks', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
    expect(csvCell({ a: 1 })).toBe('"{""a"":1}"');
  });
});

describe('event types', () => {
  test('every Discord audit log action has a name, a category and an English label', () => {
    const numbers = Object.values(AuditLogEvent).filter((value): value is number => typeof value === 'number');
    for (const action of numbers) {
      const name = (AUDIT_ACTIONS as Record<number, string>)[action];
      expect(name, `AuditLogEvent ${action}`).toBe(AuditLogEvent[action]);
      expect(AUDIT_CATEGORIES).toContain(categoryOf(`audit.${name}`));
      expect((en.types.audit as Record<string, string>)[name!]).toBeTruthy();
    }
  });

  test('every gateway and ShifuBot type has a label', () => {
    for (const types of Object.values(typesByCategory())) {
      for (const type of types) {
        const [group, name] = type.split('.') as [string, string];
        expect((en.types as Record<string, Record<string, string>>)[group]?.[name], type).toBeTruthy();
      }
    }
  });

  test('moderation actions are grouped as moderation', () => {
    expect(categoryOf('audit.MemberBanAdd')).toBe('moderation');
    expect(categoryOf('audit.MemberTimeout')).toBe('moderation');
    expect(categoryOf('audit.AutoModerationBlockMessage')).toBe('automod');
    expect(categoryOf('audit.ChannelCreate')).toBe('channels');
    expect(categoryOf('voice.joined')).toBe('voice');
    expect(categoryOf('something.new')).toBe('server');
  });

  test('settings decide per category and per type', () => {
    const on = { ...defaultAuditSettings, enabled: true };
    expect(isTypeEnabled(defaultAuditSettings, 'member.join')).toBe(false);
    expect(isTypeEnabled(on, 'member.join')).toBe(true);
    expect(isTypeEnabled({ ...on, disabledTypes: ['voice.joined'] }, 'voice.joined')).toBe(false);
    expect(isTypeEnabled({ ...on, disabledCategories: ['members'] }, 'member.join')).toBe(false);
  });

  test('noise is not a type any more', () => {
    const all = Object.values(typesByCategory()).flat();
    for (const type of REMOVED_TYPES) expect(all).not.toContain(type);
    // Settings saved with a removed category still load.
    expect(auditSettingsSchema.parse({ ...defaultAuditSettings, disabledCategories: ['presence', 'voice'] }).disabledCategories).toEqual(['voice']);
  });

  test('settings and filters validate their input', () => {
    expect(auditSettingsSchema.safeParse(defaultAuditSettings).success).toBe(true);
    expect(auditSettingsSchema.safeParse({ ...defaultAuditSettings, retentionDays: 3 }).success).toBe(false);
    expect(auditSettingsSchema.safeParse({ ...defaultAuditSettings, disabledTypes: ['DROP TABLE'] }).success).toBe(false);
    const filter = auditFilterSchema.parse({ categories: 'voice,nope', types: 'voice.joined,bad type', limit: '20' });
    expect(filter.categories).toEqual(['voice']);
    expect(filter.types).toEqual(['voice.joined']);
    expect(filter.limit).toBe(20);
    expect(auditFilterSchema.safeParse({ limit: '1000' }).success).toBe(false);
    expect(auditFilterSchema.safeParse({ user: 'not-an-id' }).success).toBe(false);
  });
});

describe('Discord audit log entries', () => {
  const entry = {
    action: 24,
    executorId: '111111111111111111',
    targetId: '222222222222222222',
    targetType: 'User',
    reason: 'spam',
    changes: [{ key: 'communication_disabled_until', old: null, new: '2026-11-05T10:00:00.000Z' }],
    extra: null,
    target: { id: '222222222222222222', username: 'bob' },
    createdTimestamp: 1_000,
  };

  test('timeouts are split out of member updates', () => {
    expect(auditEntryType(entry)).toBe('audit.MemberTimeout');
    expect(auditEntryType({ ...entry, changes: [{ key: 'nick', old: 'a', new: 'b' }] })).toBe('audit.MemberUpdate');
    expect(auditEntryType({ ...entry, action: 9999 })).toBe('audit.unknown');
  });

  test('records keep executor, target, reason and changes', () => {
    const record = auditEntryRecord(entry);
    expect(record).toMatchObject({ type: 'audit.MemberTimeout', actorId: entry.executorId, targetId: entry.targetId, targetKind: 'user', at: 1_000 });
    expect(record.data).toMatchObject({ reason: 'spam', targetName: 'bob', changes: [{ key: 'communication_disabled_until', old: null }] });
  });

  test('unknown actions keep their number, message actions point at the channel', () => {
    expect(auditEntryRecord({ ...entry, action: 9999 }).data).toMatchObject({ actionType: 9999 });
    const purge = auditEntryRecord({ ...entry, action: 72, changes: [], targetType: 'Message', extra: { channel: { id: '333333333333333333', name: 'general' }, count: 3 } });
    expect(purge.channelId).toBe('333333333333333333');
    expect(purge.targetKind).toBe('user');
  });

  test('plain turns Discord values into small JSON', () => {
    expect(plain(10n)).toBe('10');
    expect(plain([{ id: '1', name: 'Mods', client: {} }], 0)).toEqual([{ id: '1', name: 'Mods' }]);
    expect(plain(new Map([['a', { id: '2', username: 'x' }]]), 0)).toEqual([{ id: '2', name: 'x' }]);
  });
});

describe('voice', () => {
  const idle: VoiceLike = { channelId: null, streaming: false, selfVideo: false };
  const inA: VoiceLike = { ...idle, channelId: 'a' };

  test('joins, leaves and moves', () => {
    expect(voiceRecords('u', idle, inA).map((record) => record.type)).toEqual(['voice.joined']);
    expect(voiceRecords('u', inA, idle)).toMatchObject([{ type: 'voice.left', channelId: 'a' }]);
    expect(voiceRecords('u', inA, { ...inA, channelId: 'b' })).toMatchObject([{ type: 'voice.moved', channelId: 'b', data: { fromChannelId: 'a' } }]);
  });

  test('streaming and camera in the same channel', () => {
    expect(voiceRecords('u', inA, { ...inA, streaming: true, selfVideo: true }).map((record) => record.type)).toEqual(['voice.streamStart', 'voice.videoStart']);
    expect(voiceRecords('u', { ...inA, selfVideo: true }, inA).map((record) => record.type)).toEqual(['voice.videoStop']);
    expect(voiceRecords('u', inA, inA)).toEqual([]);
  });
});

describe('profile changes', () => {
  const base: UserSnapshot = {
    id: 'u',
    username: 'mei',
    globalName: 'Mei',
    nick: null,
    avatar: 'a1',
    guildAvatar: null,
    avatarUrl: 'https://cdn/a1.png',
    bot: false,
    joinedAt: 1,
    pending: true,
    premiumSince: null,
    full: true,
  };

  test('user fields, rules screening and boosts', () => {
    const records = memberChangeRecords(base, { ...base, username: 'mei2', avatar: 'a2', avatarUrl: 'https://cdn/a2.png', pending: false, premiumSince: 5 });
    expect(records.map((record) => record.type)).toEqual(['user.username', 'user.avatar', 'member.rulesAccepted', 'member.boostStart']);
    expect(records[1]!.data).toEqual({ before: 'https://cdn/a1.png', after: 'https://cdn/a2.png' });
  });

  test('nothing without a stored snapshot, no server fields from a remembered name', () => {
    expect(memberChangeRecords(null, base)).toEqual([]);
    expect(memberChangeRecords({ ...base, full: false, pending: null }, { ...base, pending: false, premiumSince: 5 })).toEqual([]);
  });
});

describe('invite tracking', () => {
  test('the invite whose uses grew', () => {
    const before = [
      { code: 'a', uses: 1, inviterId: 'x', maxUses: 0 },
      { code: 'b', uses: 4, inviterId: 'y', maxUses: 0 },
    ];
    expect(usedInvite(before, [{ ...before[0]!, uses: 2 }, before[1]!])?.code).toBe('a');
    expect(usedInvite(before, before)).toBeNull();
    expect(usedInvite(before, [{ ...before[0]!, uses: 2 }, { ...before[1]!, uses: 5 }])).toBeNull();
  });

  test('a one use invite that disappeared', () => {
    const before = [{ code: 'once', uses: 0, inviterId: 'x', maxUses: 1 }];
    expect(usedInvite(before, [])).toMatchObject({ code: 'once', uses: 1 });
  });
});

describe('AuditStore', () => {
  const g = 'g';

  test('settings default to off and round trip', () => {
    const { store } = createStore();
    expect(store.get(g)).toEqual(defaultAuditSettings);
    const next = { ...defaultAuditSettings, enabled: true, retentionDays: 90 as const, ignoredChannelIds: ['123456789012345678'] };
    store.save(g, next);
    expect(store.get(g)).toEqual(next);
    expect(store.enabledGuildIds()).toEqual([g]);
  });

  test('filters by type, user role, channel, time and text, newest first with cursor paging', () => {
    const { store } = createStore();
    store.insert([
      { guildId: g, type: 'member.join', actorId: 'a', targetId: 'a', targetKind: 'user', at: 100 },
      { guildId: g, type: 'audit.MemberBanAdd', actorId: 'mod', targetId: 'a', targetKind: 'user', data: { reason: 'Spam links' }, at: 200 },
      { guildId: g, type: 'message.deleted', actorId: 'b', targetId: 'm1', channelId: 'c1', data: { content: 'Hello World' }, at: 300 },
      { guildId: g, type: 'voice.joined', actorId: 'b', targetId: 'b', channelId: 'c2', at: 400 },
      { guildId: 'other', type: 'member.join', actorId: 'a', at: 500 },
    ]);
    const all = store.query(g, { limit: 10 });
    expect(all.map((event) => event.type)).toEqual(['voice.joined', 'message.deleted', 'audit.MemberBanAdd', 'member.join']);
    expect(all[2]!.category).toBe('moderation');

    expect(store.query(g, { limit: 10, user: 'a', userRole: 'target' }).map((event) => event.type)).toEqual(['audit.MemberBanAdd', 'member.join']);
    expect(store.query(g, { limit: 10, user: 'a', userRole: 'actor' }).map((event) => event.type)).toEqual(['member.join']);
    expect(store.query(g, { limit: 10, user: 'mod' }).length).toBe(1);
    expect(store.query(g, { limit: 10, categories: ['moderation', 'voice'] }).length).toBe(2);
    expect(store.query(g, { limit: 10, types: ['message.deleted'] }).length).toBe(1);
    expect(store.query(g, { limit: 10, channel: 'c2' }).map((event) => event.type)).toEqual(['voice.joined']);
    expect(store.query(g, { limit: 10, from: 150, to: 350 }).length).toBe(2);
    expect(store.query(g, { limit: 10, q: 'hello' }).map((event) => event.type)).toEqual(['message.deleted']);
    expect(store.query(g, { limit: 10, q: 'SPAM' }).length).toBe(1);
    expect(store.query(g, { limit: 10, q: '100%' }).length).toBe(0);

    const first = store.query(g, { limit: 2 });
    const second = store.query(g, { limit: 2, before: first[1]!.id });
    expect([...first, ...second].map((event) => event.id)).toEqual(all.map((event) => event.id));
    expect(store.query(g, { limit: 10, after: all[1]!.id }).map((event) => event.type)).toEqual(['voice.joined']);
  });

  test('viewers only see events in channels they can see', () => {
    const { store } = createStore();
    store.insert([
      { guildId: g, type: 'message.deleted', channelId: 'public', at: 1 },
      { guildId: g, type: 'message.deleted', channelId: 'staff', at: 2 },
      { guildId: g, type: 'member.join', at: 3 },
    ]);
    expect(store.query(g, { limit: 10 }, ['public']).map((event) => event.channelId)).toEqual([null, 'public']);
    expect(store.query(g, { limit: 10 }, null).length).toBe(3);
  });

  test('upgrading drops the rows and defaults of removed noise types', () => {
    const db = new Database(':memory:');
    migrate(db, [auditMigrations[0]!], silent);
    db.query("INSERT INTO audit_settings (guild_id, disabled_categories, disabled_types, updated_at) VALUES ('g', '[\"presence\"]', '[\"message.typing\"]', 0)").run();
    for (const type of ['message.sent', 'presence.status', 'member.join']) {
      db.query("INSERT INTO audit_events (guild_id, created_at, category, type) VALUES ('g', 0, 'x', ?)").run(type);
    }
    migrate(db, auditMigrations, silent);
    expect(db.query('SELECT type FROM audit_events').all()).toEqual([{ type: 'member.join' }]);
    expect(new AuditStore(db).get('g')).toMatchObject({ disabledCategories: [], disabledTypes: [] });
  });

  test('retention, row cap and purge', () => {
    const { store } = createStore();
    store.insert(Array.from({ length: 30 }, (_, index) => ({ guildId: g, type: 'member.join', at: index })));
    expect(store.pruneOlderThan(g, 10, 4)).toBe(10);
    expect(store.stats(g)).toEqual({ events: 20, oldest: 10 });
    expect(store.capRows(g, 5, 4)).toBe(15);
    expect(store.query(g, { limit: 10 }).map((event) => event.at)).toEqual([29, 28, 27, 26, 25]);
    expect(store.purge(g)).toBe(5);
    expect(store.stats(g)).toEqual({ events: 0, oldest: null });
  });

  test('user snapshots: full upsert returns the previous, remember never overwrites', () => {
    const { store } = createStore();
    const mei: UserSnapshot = {
      id: 'u',
      username: 'mei',
      globalName: 'Mei',
      nick: 'Meiko',
      avatar: null,
      guildAvatar: null,
      avatarUrl: null,
      bot: false,
      joinedAt: 5,
      pending: false,
      premiumSince: null,
      full: true,
    };
    expect(store.upsertUser(g, mei)).toBeNull();
    store.rememberUser(g, { ...mei, username: 'changed', full: false });
    expect(store.user(g, 'u')?.username).toBe('mei');
    expect(store.upsertUser(g, { ...mei, username: 'mei2', joinedAt: null })?.username).toBe('mei');
    expect(store.user(g, 'u')).toMatchObject({ username: 'mei2', joinedAt: 5, full: true });
    expect(store.usersByIds(g, ['u', 'x'])).toEqual({ u: { id: 'u', name: 'Meiko', username: 'mei2', avatarUrl: null } });
    expect(store.searchUsers(g, 'meik').map((user) => user.id)).toEqual(['u']);
    expect(store.searchUsers(g, 'nobody')).toEqual([]);
  });

  test('long message text is shortened to fit', () => {
    const { store } = createStore();
    store.insert([{ guildId: g, type: 'message.deleted', data: { content: 'x'.repeat(40_000) } }]);
    const [event] = store.query(g, { limit: 1 });
    expect((event!.data.content as string).length).toBe(2_000);
    expect(event!.data.truncated).toBe(true);
  });
});

describe('AuditWriter', () => {
  test('batches writes and counts events over the per minute limit', () => {
    const { store } = createStore();
    const writer = new AuditWriter(store, 3);
    for (let index = 0; index < 5; index++) writer.push({ guildId: 'g', type: 'member.join' }, 1_000);
    writer.push({ guildId: 'h', type: 'member.join' }, 1_000);
    expect(store.stats('g').events).toBe(0);
    writer.flush(1_000);
    expect(store.stats('g').events).toBe(3);
    expect(store.stats('h').events).toBe(1);
    // The minute ends: the skip count is written once.
    writer.flush(62_000);
    const skipped = store.query('g', { limit: 10, types: ['shifubot.eventsSkipped'] });
    expect(skipped).toHaveLength(1);
    expect(skipped[0]!.data).toEqual({ count: 2 });
  });
});

describe('helpers', () => {
  test('search text collects every string', () => {
    expect(searchTextOf({ a: 'Hello', b: [{ c: 'World' }], n: 5 }, 'Mei')).toBe('hello world mei');
  });

  test('settings changes list only changed keys', () => {
    expect(settingsChanges({ a: 1, b: [1] }, { a: 1, b: [2], c: true })).toEqual([
      { key: 'b', old: [1], new: [2] },
      { key: 'c', old: null, new: true },
    ]);
    expect(settingsChanges(undefined, { a: 1 })).toEqual([]);
  });
});
