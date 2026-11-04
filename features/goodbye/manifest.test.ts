import { describe, expect, test } from 'bun:test';
import { colors, EMBED_LIMITS, hexToInt } from '@shifubot/shared';
import { buildGoodbyeMessage, defaultGoodbyeSettings, goodbyeSettingsSchema, type GoodbyeContext } from './manifest';

const ctx: GoodbyeContext = {
  locale: 'en',
  member: { id: '123456789012345678', username: 'mei', displayName: 'Mei', avatarUrl: 'https://cdn.example/a.png' },
  server: { name: 'Shifu Dojo', memberCount: 127 },
  now: new Date('2026-01-01T12:00:00Z'),
};

describe('buildGoodbyeMessage', () => {
  test('uses the English defaults with the shared title style and footer', () => {
    const { embeds, content, allowedMentions } = buildGoodbyeMessage(defaultGoodbyeSettings, ctx);
    const embed = embeds[0]!;
    expect(embed.title).toBe('🚪 Goodbye, Mei');
    expect(embed.description).toBe('Mei has left Shifu Dojo. We are now 127 members. Hope to see you again!');
    expect(embed.footer?.text).toBe('ShifuBot • Goodbye');
    expect(embed.color).toBe(hexToInt(colors.primary));
    expect(embed.thumbnail?.url).toBe('https://cdn.example/a.png');
    expect(embed.image).toBeUndefined();
    expect(embed.timestamp).toBe('2026-01-01T12:00:00.000Z');
    expect(content).toBeUndefined();
    expect(allowedMentions).toEqual({ users: [], roles: [], parse: [] });
  });

  test('uses the Hungarian defaults when the server language is Hungarian', () => {
    const embed = buildGoodbyeMessage(defaultGoodbyeSettings, { ...ctx, locale: 'hu' }).embeds[0]!;
    expect(embed.title).toBe('🚪 Viszlát, Mei');
    expect(embed.description).toContain('Most 127 tagunk van.');
    expect(embed.footer?.text).toBe('ShifuBot • Búcsúzás');
  });

  test('applies custom texts, color, banner and footer', () => {
    const embed = buildGoodbyeMessage(
      {
        ...defaultGoodbyeSettings,
        title: 'Bye {username}',
        description: '{username} left {server}',
        color: '#9BE8C0',
        bannerUrl: 'https://img.example/banner.png',
        footer: '{server} crew',
        showAvatar: false,
      },
      ctx,
    ).embeds[0]!;
    expect(embed.title).toBe('🚪 Bye Mei');
    expect(embed.description).toBe('Mei left Shifu Dojo');
    expect(embed.color).toBe(0x9be8c0);
    expect(embed.image?.url).toBe('https://img.example/banner.png');
    expect(embed.footer?.text).toBe('Shifu Dojo crew');
    expect(embed.thumbnail).toBeUndefined();
  });

  test('never pings anyone, even if a mention is typed', () => {
    const payload = buildGoodbyeMessage({ ...defaultGoodbyeSettings, description: '<@123456789012345678> left' }, ctx);
    expect(payload.allowedMentions).toEqual({ users: [], roles: [], parse: [] });
  });

  test('respects Discord length limits', () => {
    const embed = buildGoodbyeMessage(
      { ...defaultGoodbyeSettings, title: '{server}' },
      { ...ctx, server: { name: 'x'.repeat(400), memberCount: 1 } },
    ).embeds[0]!;
    expect(embed.title!.length).toBeLessThanOrEqual(EMBED_LIMITS.title);
  });
});

describe('goodbyeSettingsSchema', () => {
  test('accepts the defaults', () => {
    expect(goodbyeSettingsSchema.parse(defaultGoodbyeSettings)).toEqual(defaultGoodbyeSettings);
  });

  test('rejects banner URLs that are not http or https', () => {
    for (const bannerUrl of ['javascript:alert(1)', 'data:image/png;base64,AAAA', 'ftp://x.org/a.png', 'not a url']) {
      expect(goodbyeSettingsSchema.safeParse({ ...defaultGoodbyeSettings, bannerUrl }).success).toBe(false);
    }
  });

  test('rejects invalid colors and channel ids', () => {
    expect(goodbyeSettingsSchema.safeParse({ ...defaultGoodbyeSettings, color: 'red' }).success).toBe(false);
    expect(goodbyeSettingsSchema.safeParse({ ...defaultGoodbyeSettings, channelId: '12' }).success).toBe(false);
  });
});
