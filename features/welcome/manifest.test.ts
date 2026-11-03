import { describe, expect, test } from 'bun:test';
import { colors, EMBED_LIMITS, hexToInt } from '@shifubot/shared';
import { buildWelcomeMessage, defaultWelcomeSettings, welcomeSettingsSchema, type WelcomeContext } from './manifest';

const ctx: WelcomeContext = {
  locale: 'en',
  member: { id: '123456789012345678', username: 'mei', displayName: 'Mei', avatarUrl: 'https://cdn.example/a.png' },
  server: { name: 'Shifu Dojo', memberCount: 128 },
  now: new Date('2026-01-01T12:00:00Z'),
};

describe('buildWelcomeMessage', () => {
  test('uses the English defaults with the shared title style and footer', () => {
    const { embeds, content, allowedMentions } = buildWelcomeMessage(defaultWelcomeSettings, ctx);
    const embed = embeds[0]!;
    expect(embed.title).toBe('👋 Welcome to Shifu Dojo');
    expect(embed.description).toBe(
      'Hey <@123456789012345678>, glad you joined. You are member number 128. Read the rules, say hi and make yourself at home.',
    );
    expect(embed.footer?.text).toBe('ShifuBot • Welcome');
    expect(embed.color).toBe(hexToInt(colors.primary));
    expect(embed.thumbnail?.url).toBe('https://cdn.example/a.png');
    expect(embed.image).toBeUndefined();
    expect(embed.timestamp).toBe('2026-01-01T12:00:00.000Z');
    expect(content).toBe('<@123456789012345678>');
    expect(allowedMentions).toEqual({ users: ['123456789012345678'], roles: [], parse: [] });
  });

  test('uses the Hungarian defaults when the server language is Hungarian', () => {
    const embed = buildWelcomeMessage(defaultWelcomeSettings, { ...ctx, locale: 'hu' }).embeds[0]!;
    expect(embed.title).toBe('👋 Üdv a(z) Shifu Dojo szerveren');
    expect(embed.description).toContain('Te vagy a(z) 128. tag.');
    expect(embed.footer?.text).toBe('ShifuBot • Üdvözlés');
  });

  test('applies custom texts, color, banner and footer', () => {
    const embed = buildWelcomeMessage(
      {
        ...defaultWelcomeSettings,
        title: 'Hello {user}',
        description: '{username} joined {server}',
        color: '#9BE8C0',
        bannerUrl: 'https://img.example/banner.png',
        footer: '{server} crew',
        showAvatar: false,
      },
      ctx,
    ).embeds[0]!;
    expect(embed.title).toBe('👋 Hello Mei');
    expect(embed.description).toBe('Mei joined Shifu Dojo');
    expect(embed.color).toBe(0x9be8c0);
    expect(embed.image?.url).toBe('https://img.example/banner.png');
    expect(embed.footer?.text).toBe('Shifu Dojo crew');
    expect(embed.thumbnail).toBeUndefined();
  });

  test('does not mention the member when the toggle is off', () => {
    const payload = buildWelcomeMessage({ ...defaultWelcomeSettings, mentionUser: false }, ctx);
    expect(payload.content).toBeUndefined();
    expect(payload.allowedMentions.users).toEqual([]);
  });

  test('respects Discord length limits', () => {
    const embed = buildWelcomeMessage(
      { ...defaultWelcomeSettings, title: '{server}' },
      { ...ctx, server: { name: 'x'.repeat(400), memberCount: 1 } },
    ).embeds[0]!;
    expect(embed.title!.length).toBeLessThanOrEqual(EMBED_LIMITS.title);
  });
});

describe('welcomeSettingsSchema', () => {
  test('accepts the defaults', () => {
    expect(welcomeSettingsSchema.parse(defaultWelcomeSettings)).toEqual(defaultWelcomeSettings);
  });

  test('rejects banner URLs that are not http or https', () => {
    for (const bannerUrl of ['javascript:alert(1)', 'data:image/png;base64,AAAA', 'ftp://x.org/a.png', 'not a url']) {
      expect(welcomeSettingsSchema.safeParse({ ...defaultWelcomeSettings, bannerUrl }).success).toBe(false);
    }
  });

  test('turns an empty banner URL into null', () => {
    expect(welcomeSettingsSchema.parse({ ...defaultWelcomeSettings, bannerUrl: '' }).bannerUrl).toBeNull();
  });

  test('rejects invalid colors and channel ids', () => {
    expect(welcomeSettingsSchema.safeParse({ ...defaultWelcomeSettings, color: 'red' }).success).toBe(false);
    expect(welcomeSettingsSchema.safeParse({ ...defaultWelcomeSettings, channelId: '12' }).success).toBe(false);
  });
});
