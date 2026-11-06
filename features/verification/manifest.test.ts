import { describe, expect, test } from 'bun:test';
import { inflateSync } from 'node:zlib';
import { colors, hexToInt } from '@shifubot/shared';
import { CAPTCHA_ALPHABET, CAPTCHA_LENGTH, encodePng, randomCaptchaCode, renderCaptcha } from './captcha';
import {
  accountAgeDays,
  needsCaptcha,
  buildVerificationPanel,
  defaultVerificationSettings,
  verificationSettingsSchema,
  VERIFY_IDS,
} from './manifest';
import verificationFeature, { normalizeAnswer } from './server';
import { Database } from 'bun:sqlite';
import { migrate } from '../../apps/bot/src/db/database';

const ctx = { locale: 'en' as const, server: { name: 'Shifu Dojo' } };

describe('buildVerificationPanel', () => {
  test('uses the English captcha defaults and one Verify button', () => {
    const { embeds, components, allowedMentions } = buildVerificationPanel(defaultVerificationSettings, ctx);
    const embed = embeds[0]!;
    expect(embed.title).toBe('🛡️ Verify to enter Shifu Dojo');
    expect(embed.description).toContain('type the code from the picture');
    expect(embed.footer?.text).toBe('ShifuBot • Verification');
    expect(embed.color).toBe(hexToInt(colors.primary));
    expect(components).toEqual([
      { type: 1, components: [{ type: 2, style: 3, label: 'Verify', custom_id: VERIFY_IDS.start, emoji: { name: '✅' } }] },
    ]);
    expect(allowedMentions).toEqual({ users: [], roles: [], parse: [] });
  });

  test('describes the one click flow in button mode', () => {
    const embed = buildVerificationPanel({ ...defaultVerificationSettings, mode: 'button' }, ctx).embeds[0]!;
    expect(embed.description).toContain('Click the button below to confirm');
  });

  test('uses the Hungarian defaults when the server language is Hungarian', () => {
    const payload = buildVerificationPanel(defaultVerificationSettings, { ...ctx, locale: 'hu' });
    expect(payload.embeds[0]!.footer?.text).toBe('ShifuBot • Hitelesítés');
    expect(payload.components![0]!.components[0]!.label).toBe('Hitelesítés');
  });

  test('applies custom texts, button label and color', () => {
    const payload = buildVerificationPanel(
      { ...defaultVerificationSettings, title: 'Gate of {server}', description: 'Prove it', buttonLabel: "I'm human", color: '#9BE8C0' },
      ctx,
    );
    expect(payload.embeds[0]!.title).toBe('🛡️ Gate of Shifu Dojo');
    expect(payload.embeds[0]!.description).toBe('Prove it');
    expect(payload.embeds[0]!.color).toBe(0x9be8c0);
    expect(payload.components![0]!.components[0]!.label).toBe("I'm human");
  });
});

describe('verificationSettingsSchema', () => {
  test('accepts the defaults', () => {
    expect(verificationSettingsSchema.parse(defaultVerificationSettings)).toEqual(defaultVerificationSettings);
  });

  test('rejects unknown modes, bad ids and out of range account ages', () => {
    const bad = [
      { mode: 'math' },
      { roleId: '12' },
      { channelId: 'abc' },
      { minAccountAgeDays: -1 },
      { minAccountAgeDays: 400 },
      { minAccountAgeDays: 1.5 },
      { buttonLabel: 'x'.repeat(81) },
      { maxAttempts: 0 },
      { maxAttempts: 11 },
      { failAction: 'explode' },
      { timeoutMinutes: 0 },
      { timeoutMinutes: 40_321 },
    ];
    for (const patch of bad) {
      expect(verificationSettingsSchema.safeParse({ ...defaultVerificationSettings, ...patch }).success).toBe(false);
    }
  });
});

describe('accountAgeDays', () => {
  test('counts whole days', () => {
    const now = new Date('2026-01-10T12:00:00Z');
    expect(accountAgeDays(new Date('2026-01-10T00:00:00Z'), now)).toBe(0);
    expect(accountAgeDays(new Date('2026-01-03T11:00:00Z'), now)).toBe(7);
  });
});

describe('normalizeAnswer', () => {
  test('ignores case and spaces', () => {
    expect(normalizeAnswer(' ac3 xkp ')).toBe('AC3XKP');
  });
});

describe('captcha', () => {
  test('codes use only the unambiguous alphabet', () => {
    for (let i = 0; i < 200; i++) {
      const code = randomCaptchaCode();
      expect(code).toHaveLength(CAPTCHA_LENGTH);
      for (const char of code) expect(CAPTCHA_ALPHABET).toContain(char);
    }
    for (const confusing of ['O', '0', 'I', '1', 'S', '5', 'B', '8']) expect(CAPTCHA_ALPHABET).not.toContain(confusing);
  });

  test('renders every letter into a valid PNG', () => {
    for (let i = 0; i < CAPTCHA_ALPHABET.length; i += CAPTCHA_LENGTH) {
      const code = CAPTCHA_ALPHABET.slice(i, i + CAPTCHA_LENGTH).padEnd(CAPTCHA_LENGTH, 'A');
      const png = renderCaptcha(code);
      expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      expect(png.readUInt32BE(16)).toBe(360);
      expect(png.readUInt32BE(20)).toBe(120);
    }
  });

  test('the PNG encoder stores rows with a filter byte and the exact pixels', () => {
    const pixels = new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255, 10, 20, 30]);
    const png = encodePng(2, 2, pixels);
    const idatLength = png.readUInt32BE(33);
    expect(png.subarray(37, 41).toString('ascii')).toBe('IDAT');
    const raw = inflateSync(png.subarray(41, 41 + idatLength));
    expect([...raw]).toEqual([0, 255, 0, 0, 0, 255, 0, 0, 0, 0, 255, 10, 20, 30]);
  });
});

describe('migrations', () => {
  test('a database created before fail actions existed gets the new columns with safe defaults', () => {
    const db = new Database(':memory:');
    const logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as never;
    const [first, ...rest] = verificationFeature.migrations;
    migrate(db, [first!], logger);
    db.query("INSERT INTO verification_settings (guild_id, updated_at) VALUES ('1', 0)").run();
    migrate(db, [first!, ...rest], logger);
    expect(db.query('SELECT max_attempts, fail_action, timeout_minutes FROM verification_settings').get()).toEqual({
      max_attempts: 3,
      fail_action: 'retry',
      timeout_minutes: 10,
    });
  });
});

describe('needsCaptcha', () => {
  test('only a new member in captcha mode solves a captcha', () => {
    expect(needsCaptcha('captcha', false)).toBe(true);
    expect(needsCaptcha('captcha', true)).toBe(false);
    expect(needsCaptcha('button', false)).toBe(false);
    expect(needsCaptcha('button', true)).toBe(false);
  });
});

describe('verification_003_drop_restore_on_rejoin', () => {
  test('removes the setting and keeps settings and verified members', () => {
    const silent = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as never;
    const db = new Database(':memory:');
    const last = verificationFeature.migrations.findIndex((migration) => migration.id === 'verification_003_drop_restore_on_rejoin');
    expect(last).toBeGreaterThan(0);
    migrate(db, verificationFeature.migrations.slice(0, last), silent);
    db.query("INSERT INTO verification_settings (guild_id, enabled, role_id, restore_on_rejoin, updated_at) VALUES ('g', 1, 'r', 0, 1)").run();
    db.query("INSERT INTO verification_members (guild_id, user_id, verified_at) VALUES ('g', 'u', 1)").run();

    migrate(db, verificationFeature.migrations, silent);

    const row = db.query('SELECT * FROM verification_settings WHERE guild_id = ?').get('g') as Record<string, unknown>;
    expect(row.enabled).toBe(1);
    expect(row.role_id).toBe('r');
    expect('restore_on_rejoin' in row).toBe(false);
    expect(db.query('SELECT user_id FROM verification_members').get()).toEqual({ user_id: 'u' });
  });
});
