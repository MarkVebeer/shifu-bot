import { describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { migrate } from '../../apps/bot/src/db/database';
import {
  buildLeaderboardPanel,
  buildLevelUpMessage,
  buildRankMessage,
  defaultLevelingSettings,
  levelFromXp,
  levelingSettingsSchema,
  levelsFor,
  progressBar,
  RANK_BUTTON_ID,
  totalXpForLevel,
  xpToNextLevel,
  XP_RULES,
} from './manifest';
import levelingFeature, { LevelingStore } from './server';
import { isIgnoredChannel, isVoiceEligible, messageXp, voiceDay, voiceXpAfter, voiceXpGrant, type VoiceSnapshot } from './xp';

describe('level curve', () => {
  test('uses 5·L² + 50·L + 100 per level', () => {
    expect(xpToNextLevel(0)).toBe(100);
    expect(xpToNextLevel(1)).toBe(155);
    expect(xpToNextLevel(10)).toBe(1100);
    expect(totalXpForLevel(0)).toBe(0);
    expect(totalXpForLevel(2)).toBe(255);
  });

  test('levelFromXp is exact at the borders', () => {
    expect(levelFromXp(0)).toEqual({ level: 0, current: 0, needed: 100 });
    expect(levelFromXp(99)).toEqual({ level: 0, current: 99, needed: 100 });
    expect(levelFromXp(100)).toEqual({ level: 1, current: 0, needed: 155 });
    expect(levelFromXp(254).level).toBe(1);
    expect(levelFromXp(255).level).toBe(2);
    expect(levelFromXp(-5).level).toBe(0);
  });

  test('totalXpForLevel and levelFromXp agree for many levels', () => {
    for (let level = 0; level < 100; level++) {
      expect(levelFromXp(totalXpForLevel(level))).toEqual({ level, current: 0, needed: xpToNextLevel(level) });
    }
  });

  test('progressBar fills proportionally and clamps', () => {
    expect(progressBar(0, 4)).toBe('▱▱▱▱');
    expect(progressBar(0.5, 4)).toBe('▰▰▱▱');
    expect(progressBar(2, 4)).toBe('▰▰▰▰');
  });
});

describe('XP rules', () => {
  test('message XP stays within the range', () => {
    expect(messageXp(() => 0)).toBe(XP_RULES.messageMin);
    expect(messageXp(() => 0.9999)).toBe(XP_RULES.messageMax);
  });

  test('ignored channels cover threads and whole categories', () => {
    const ignored = ['category', 'spam'];
    expect(isIgnoredChannel(['spam', 'other-category', null], ignored)).toBe(true);
    expect(isIgnoredChannel(['general', 'category', null], ignored)).toBe(true);
    expect(isIgnoredChannel(['thread', 'general', 'category'], ignored)).toBe(true);
    expect(isIgnoredChannel(['general', 'other-category', undefined], ignored)).toBe(false);
  });

  test('voice XP needs company, talking, hearing, and a normal channel', () => {
    const base: VoiceSnapshot = { bot: false, deaf: false, muted: false, channelId: 'vc', afkChannelId: 'afk', humansInChannel: 2, ignored: false };
    expect(isVoiceEligible(base)).toBe(true);
    expect(isVoiceEligible({ ...base, humansInChannel: 1 })).toBe(false);
    expect(isVoiceEligible({ ...base, deaf: true })).toBe(false);
    expect(isVoiceEligible({ ...base, muted: true })).toBe(false);
    expect(isVoiceEligible({ ...base, channelId: 'afk' })).toBe(false);
    expect(isVoiceEligible({ ...base, bot: true })).toBe(false);
    expect(isVoiceEligible({ ...base, ignored: true })).toBe(false);
    expect(isVoiceEligible({ ...base, channelId: null })).toBe(false);
  });

  test('the daily voice cap takes 8 hours of talking and is about one chat day', () => {
    // An active chat day is ~25 minutes with a message: about 500 XP.
    const chatDay = 25 * ((XP_RULES.messageMin + XP_RULES.messageMax) / 2);
    expect(XP_RULES.voiceCapMinutes / 60).toBe(8);
    expect(voiceXpAfter(XP_RULES.voiceCapMinutes)).toBe(XP_RULES.voiceDailyCap);
    expect(voiceXpAfter(XP_RULES.voiceCapMinutes - 60)).toBeLessThan(XP_RULES.voiceDailyCap);
    expect(XP_RULES.voiceDailyCap).toBeLessThanOrEqual(chatDay * 1.25);
    // Two hours of voice is worth well under an active chat day.
    expect(voiceXpAfter(120)).toBe(150);
  });

  test('voice XP is whole numbers that add up to exactly 1.25 a minute, then stops', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7].map(voiceXpGrant)).toEqual([1, 1, 1, 2, 1, 1, 1, 2]);
    const total = Array.from({ length: XP_RULES.voiceCapMinutes }, (_, minute) => voiceXpGrant(minute)).reduce((a, b) => a + b, 0);
    expect(total).toBe(XP_RULES.voiceDailyCap);
    expect(voiceXpGrant(XP_RULES.voiceCapMinutes)).toBe(0);
    expect(voiceDay(new Date('2026-11-04T23:59:59Z'))).toBe('2026-11-04');
  });
});

describe('messages', () => {
  const member = { id: '123456789012345678', displayName: 'Mei', avatarUrl: 'https://cdn.example/a.png' };

  test('level up message names the track, uses the defaults and only pings when asked', () => {
    const quiet = buildLevelUpMessage(defaultLevelingSettings, { locale: 'en', member, track: 'text', level: 5, server: { name: 'Dojo' } });
    expect(quiet.embeds[0]!.title).toBe('💬 Chat level up!');
    expect(quiet.embeds[0]!.description).toBe('<@123456789012345678> just reached **Chat level 5**. Keep it up!');
    expect(quiet.content).toBeUndefined();
    expect(quiet.allowedMentions.users).toEqual([]);

    const voice = buildLevelUpMessage(defaultLevelingSettings, { locale: 'hu', member, track: 'voice', level: 3, server: { name: 'Dojo' } });
    expect(voice.embeds[0]!.title).toBe('🎙️ Hang szintlépés!');
    expect(voice.embeds[0]!.description).toBe('<@123456789012345678> új szintet ért el: **Hang szint 3**. Csak így tovább!');

    const loud = buildLevelUpMessage({ ...defaultLevelingSettings, mentionUser: true, title: '{username} → {level}' }, {
      locale: 'hu',
      member,
      track: 'voice',
      level: 7,
      server: { name: 'Dojo' },
    });
    expect(loud.embeds[0]!.title).toBe('🎙️ Mei → 7');
    expect(loud.content).toBe('<@123456789012345678>');
    expect(loud.allowedMentions.users).toEqual([member.id]);
  });

  test('leaderboard ranks by total XP and labels all three levels', () => {
    const entries = Array.from({ length: 12 }, (_, i) => ({ userId: String(1000 + i), textXp: 4000 - i * 100, voiceXp: 1000 }));
    // Most chat XP, but the lowest total: must not be first.
    entries.push({ userId: '999', textXp: 4500, voiceXp: 0 });
    const payload = buildLeaderboardPanel(
      { color: null, leaderboardSize: 5, xpSources: 'both' },
      { locale: 'en', server: { name: 'Dojo' }, entries, updatedAt: new Date('2026-01-01T00:00:00Z') },
    );
    const lines = payload.embeds[0]!.description!.split('\n');
    expect(payload.embeds[0]!.title).toBe('🏆 Dojo leaderboard');
    // 5,000 total XP is overall level 10; 4,000 chat XP is chat level 9; 1,000 voice XP is voice level 4.
    expect(lines[0]).toBe('🥇 <@1000> · ⭐ Overall 10 · 💬 Chat 9 · 🎙️ Voice 4 · 5,000 XP');
    expect(lines[3]).toStartWith('`#4` <@1003>');
    expect(lines.filter((line) => line.includes('<@'))).toHaveLength(5);
    expect(lines.some((line) => line.includes('<@999>'))).toBe(false);
    expect(lines.at(-2)).toBe('*⭐ Overall level = chat XP + voice XP. Ranked by total XP.*');
    expect(lines.at(-1)).toBe('Updated <t:1767225600:R>');
    expect(payload.components![0]!.components[0]).toMatchObject({ custom_id: RANK_BUTTON_ID });
    expect(payload.allowedMentions).toEqual({ users: [], roles: [], parse: [] });
  });

  test('empty leaderboard invites people to chat', () => {
    const payload = buildLeaderboardPanel(
      { color: null, leaderboardSize: 10, xpSources: 'both' },
      { locale: 'hu', server: { name: 'Dojo' }, entries: [], updatedAt: new Date() },
    );
    expect(payload.embeds[0]!.description).toStartWith('Még senkinek sincs XP-je.');
  });

  test('a messages only leaderboard ranks by chat XP and shows only the chat level', () => {
    const entries = [
      { userId: 'a', textXp: 300, voiceXp: 5000 },
      { userId: 'b', textXp: 400, voiceXp: 0 },
      // Voice XP left over from before the switch: not ranked.
      { userId: 'c', textXp: 0, voiceXp: 9000 },
    ];
    const payload = buildLeaderboardPanel(
      { color: null, leaderboardSize: 10, xpSources: 'text' },
      { locale: 'en', server: { name: 'Dojo' }, entries, updatedAt: new Date('2026-01-01T00:00:00Z') },
    );
    const lines = payload.embeds[0]!.description!.split('\n');
    expect(lines[0]).toBe('🥇 <@b> · 💬 Chat 2 · 400 XP');
    expect(lines[1]).toBe('🥈 <@a> · 💬 Chat 2 · 300 XP');
    expect(lines.some((line) => line.includes('<@c>'))).toBe(false);
    expect(payload.embeds[0]!.description).not.toContain('Overall');
  });

  test('a voice only leaderboard shows only the voice level', () => {
    const payload = buildLeaderboardPanel(
      { color: null, leaderboardSize: 10, xpSources: 'voice' },
      { locale: 'hu', server: { name: 'Dojo' }, entries: [{ userId: 'a', textXp: 999, voiceXp: 100 }], updatedAt: new Date() },
    );
    expect(payload.embeds[0]!.description!.split('\n')[0]).toBe('🥇 <@a> · 🎙️ Hang 1 · 100 XP');
  });

  test('rank message shows the place and a block for overall, chat and voice', () => {
    const payload = buildRankMessage(
      { color: null, xpSources: 'both' },
      { locale: 'en', member, stats: { position: 3, textXp: 150, voiceXp: 40, messages: 7, voiceMinutes: 4 } },
    );
    const blocks = payload.embeds[0]!.description!.split('\n\n');
    expect(blocks[0]).toBe('**Leaderboard place:** #3');
    // Overall: 190 XP = level 1, 90 / 155.
    expect(blocks[1]).toStartWith('**⭐ Overall level 1** · 190 XP · chat + voice');
    expect(blocks[1]).toContain('90 / 155');
    // Chat: 150 XP = level 1, 50 / 155, 105 left.
    expect(blocks[2]).toStartWith('**💬 Chat level 1** · 150 XP · 7 messages');
    expect(blocks[2]).toContain('105 XP to the next level');
    // Voice: 40 XP = level 0, 40 / 100.
    expect(blocks[3]).toStartWith('**🎙️ Voice level 0** · 40 XP · 4 minutes in voice');
    expect(blocks[3]).toContain('40 / 100');
  });

  test('rank message on a voice only server shows only the voice level', () => {
    const payload = buildRankMessage(
      { color: null, xpSources: 'voice' },
      { locale: 'en', member, stats: { position: 1, textXp: 150, voiceXp: 40, messages: 7, voiceMinutes: 4 } },
    );
    const blocks = payload.embeds[0]!.description!.split('\n\n');
    expect(blocks).toHaveLength(2);
    expect(blocks[1]).toStartWith('**🎙️ Voice level 0**');
  });
});

describe('levelsFor', () => {
  test('chat and voice levels are independent and overall uses the sum', () => {
    const levels = levelsFor({ textXp: totalXpForLevel(3), voiceXp: 0 });
    expect(levels.text.level).toBe(3);
    expect(levels.voice.level).toBe(0);
    expect(levels.overall.level).toBe(3);

    const both = levelsFor({ textXp: 100, voiceXp: 155 });
    expect(both.text.level).toBe(1);
    expect(both.voice.level).toBe(1);
    expect(both.totalXp).toBe(255);
    expect(both.overall.level).toBe(2);
  });
});

describe('levelingSettingsSchema', () => {
  test('accepts the defaults and removes duplicate ignored channels', () => {
    expect(levelingSettingsSchema.parse(defaultLevelingSettings)).toEqual(defaultLevelingSettings);
    const ids = ['123456789012345678', '123456789012345678'];
    expect(levelingSettingsSchema.parse({ ...defaultLevelingSettings, ignoredChannelIds: ids }).ignoredChannelIds).toEqual(['123456789012345678']);
  });

  test('rejects unknown intervals, sizes and modes', () => {
    for (const patch of [{ leaderboardInterval: 2 }, { leaderboardSize: 50 }, { announceMode: 'dm' }, { ignoredChannelIds: ['nope'] }]) {
      expect(levelingSettingsSchema.safeParse({ ...defaultLevelingSettings, ...patch }).success).toBe(false);
    }
  });
});

const silent = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as never;

describe('migrations', () => {
  test('create the tables with a working rank index', () => {
    const db = new Database(':memory:');
    migrate(db, levelingFeature.migrations, silent);
    db.query(
      "INSERT INTO leveling_members (guild_id, user_id, xp, text_xp, voice_xp, updated_at) VALUES ('g', 'a', 10, 10, 0, 0), ('g', 'b', 30, 0, 30, 0)",
    ).run();
    expect(db.query("SELECT user_id FROM leveling_members WHERE guild_id = 'g' AND left_at IS NULL ORDER BY xp DESC").all()).toEqual([
      { user_id: 'b' },
      { user_id: 'a' },
    ]);
  });

  test('the chat/voice split resets XP that was earned with a single level', () => {
    const db = new Database(':memory:');
    const [first, ...rest] = levelingFeature.migrations;
    migrate(db, [first!], silent);
    db.query("INSERT INTO leveling_members (guild_id, user_id, xp, messages, voice_minutes, updated_at) VALUES ('g', 'a', 500, 10, 20, 0)").run();
    migrate(db, [first!, ...rest], silent);
    expect(db.query('SELECT COUNT(*) AS count FROM leveling_members').get()).toEqual({ count: 0 });
  });
});

describe('LevelingStore', () => {
  const guildId = 'g';
  const mei = { id: 'u1', displayName: 'Mei', avatarUrl: 'https://cdn.example/a.png' };

  function createStore() {
    const db = new Database(':memory:');
    migrate(db, levelingFeature.migrations, silent);
    return new LevelingStore(db);
  }

  test('message XP only moves the chat track, voice XP only the voice track, xp is their sum', () => {
    const store = createStore();
    const chat = store.addXp(guildId, mei, 120, 'text');
    expect(chat).toMatchObject({ track: 'text', before: 0, after: 120 });
    const [voice] = store.addVoiceXp(guildId, [mei]);
    expect(voice).toMatchObject({ track: 'voice', before: 0, after: voiceXpGrant(0) });
    store.addXp(guildId, mei, 30, 'text');

    expect(store.stats(guildId, mei.id)).toEqual({
      position: 1,
      textXp: 150,
      voiceXp: voiceXpGrant(0),
      messages: 2,
      voiceMinutes: 1,
    });
    const [row] = store.top(guildId, 10);
    expect(row).toMatchObject({ xp: 150 + voiceXpGrant(0), text_xp: 150, voice_xp: voiceXpGrant(0) });
  });

  test('voice XP stops at the daily cap and starts again the next UTC day', () => {
    const store = createStore();
    const day1 = new Date('2026-11-04T10:00:00Z');
    const minutes = XP_RULES.voiceCapMinutes;
    for (let i = 0; i < minutes; i++) expect(store.addVoiceXp(guildId, [mei], day1)[0]).not.toBeNull();
    expect(store.addVoiceXp(guildId, [mei], day1)).toEqual([null]);
    expect(store.stats(guildId, mei.id).voiceXp).toBe(XP_RULES.voiceDailyCap);

    const day2 = new Date('2026-11-05T00:00:01Z');
    expect(store.addVoiceXp(guildId, [mei], day2)[0]).toMatchObject({ before: XP_RULES.voiceDailyCap });
    expect(store.stats(guildId, mei.id).voiceXp).toBe(XP_RULES.voiceDailyCap + voiceXpGrant(0));
  });

  test('single source servers rank by that track only', () => {
    const store = createStore();
    store.addXp(guildId, mei, 200, 'text');
    store.addXp(guildId, { ...mei, id: 'u2' }, 100, 'text');
    store.addXp(guildId, { ...mei, id: 'u2' }, 500, 'voice');
    expect(store.top(guildId, 10, 'text').map((row) => row.user_id)).toEqual(['u1', 'u2']);
    expect(store.top(guildId, 10, 'voice').map((row) => row.user_id)).toEqual(['u2']);
    expect(store.stats(guildId, 'u1', 'text').position).toBe(1);
    expect(store.stats(guildId, 'u1', 'voice').position).toBeNull();
  });

  test('settings remember what earns XP', () => {
    const db = new Database(':memory:');
    migrate(db, levelingFeature.migrations, silent);
    const store = new LevelingStore(db);
    expect(store.get(guildId).xpSources).toBe('both');
    store.save(guildId, { ...defaultLevelingSettings, xpSources: 'voice' });
    expect(store.get(guildId).xpSources).toBe('voice');
  });

  test('the leaderboard place follows total XP', () => {
    const store = createStore();
    store.addXp(guildId, mei, 200, 'text');
    store.addXp(guildId, { ...mei, id: 'u2' }, 150, 'text');
    store.addXp(guildId, { ...mei, id: 'u2' }, 100, 'voice');
    expect(store.top(guildId, 10).map((row) => row.user_id)).toEqual(['u2', 'u1']);
    expect(store.stats(guildId, 'u1').position).toBe(2);
  });
});
