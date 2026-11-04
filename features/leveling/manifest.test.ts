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
  progressBar,
  RANK_BUTTON_ID,
  totalXpForLevel,
  xpToNextLevel,
  XP_RULES,
} from './manifest';
import levelingFeature from './server';
import { isIgnoredChannel, isVoiceEligible, messageXp, type VoiceSnapshot } from './xp';

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

  test('voice XP needs company, hearing, and a normal channel', () => {
    const base: VoiceSnapshot = { bot: false, deaf: false, channelId: 'vc', afkChannelId: 'afk', humansInChannel: 2, ignored: false };
    expect(isVoiceEligible(base)).toBe(true);
    expect(isVoiceEligible({ ...base, humansInChannel: 1 })).toBe(false);
    expect(isVoiceEligible({ ...base, deaf: true })).toBe(false);
    expect(isVoiceEligible({ ...base, channelId: 'afk' })).toBe(false);
    expect(isVoiceEligible({ ...base, bot: true })).toBe(false);
    expect(isVoiceEligible({ ...base, ignored: true })).toBe(false);
    expect(isVoiceEligible({ ...base, channelId: null })).toBe(false);
  });
});

describe('messages', () => {
  const member = { id: '123456789012345678', displayName: 'Mei', avatarUrl: 'https://cdn.example/a.png' };

  test('level up message uses the defaults and only pings when asked', () => {
    const quiet = buildLevelUpMessage(defaultLevelingSettings, { locale: 'en', member, level: 5, server: { name: 'Dojo' } });
    expect(quiet.embeds[0]!.title).toBe('🏆 Level up!');
    expect(quiet.embeds[0]!.description).toBe('<@123456789012345678> just reached **level 5**. Keep it up!');
    expect(quiet.content).toBeUndefined();
    expect(quiet.allowedMentions.users).toEqual([]);

    const loud = buildLevelUpMessage({ ...defaultLevelingSettings, mentionUser: true, title: '{username} → {level}' }, {
      locale: 'hu',
      member,
      level: 7,
      server: { name: 'Dojo' },
    });
    expect(loud.embeds[0]!.title).toBe('🏆 Mei → 7');
    expect(loud.content).toBe('<@123456789012345678>');
    expect(loud.allowedMentions.users).toEqual([member.id]);
  });

  test('leaderboard lists the top N with medals, a live timestamp and the rank button', () => {
    const entries = Array.from({ length: 12 }, (_, i) => ({ userId: String(1000 + i), xp: 5000 - i * 100 }));
    const payload = buildLeaderboardPanel(
      { color: null, leaderboardSize: 5 },
      { locale: 'en', server: { name: 'Dojo' }, entries, updatedAt: new Date('2026-01-01T00:00:00Z') },
    );
    const lines = payload.embeds[0]!.description!.split('\n');
    expect(payload.embeds[0]!.title).toBe('🏆 Dojo leaderboard');
    expect(lines[0]).toBe('🥇 <@1000> · Level 10 · 5,000 XP');
    expect(lines[3]).toStartWith('`#4` <@1003>');
    expect(lines.filter((line) => line.includes('<@'))).toHaveLength(5);
    expect(lines.at(-1)).toBe('Updated <t:1767225600:R>');
    expect(payload.components![0]!.components[0]!.custom_id).toBe(RANK_BUTTON_ID);
    expect(payload.allowedMentions).toEqual({ users: [], roles: [], parse: [] });
  });

  test('empty leaderboard invites people to chat', () => {
    const payload = buildLeaderboardPanel({ color: null, leaderboardSize: 10 }, { locale: 'hu', server: { name: 'Dojo' }, entries: [], updatedAt: new Date() });
    expect(payload.embeds[0]!.description).toStartWith('Még senkinek sincs XP-je.');
  });

  test('rank message shows place, progress and what is left', () => {
    const payload = buildRankMessage(
      { color: null },
      { locale: 'en', member, stats: { position: 3, xp: 150, messages: 7, voiceMinutes: 4 } },
    );
    const body = payload.embeds[0]!.description!;
    expect(body).toContain('**Rank:** #3');
    expect(body).toContain('**Level:** 1');
    expect(body).toContain('50 / 155');
    expect(body).toContain('105 XP to the next level');
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

describe('migrations', () => {
  test('create the tables with a working rank index', () => {
    const db = new Database(':memory:');
    migrate(db, levelingFeature.migrations, { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as never);
    db.query("INSERT INTO leveling_members (guild_id, user_id, xp, updated_at) VALUES ('g', 'a', 10, 0), ('g', 'b', 30, 0)").run();
    expect(db.query("SELECT user_id FROM leveling_members WHERE guild_id = 'g' AND left_at IS NULL ORDER BY xp DESC").all()).toEqual([
      { user_id: 'b' },
      { user_id: 'a' },
    ]);
  });
});
