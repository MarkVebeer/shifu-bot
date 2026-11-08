/**
 * Verification feature: bot side. Panel message, button and modal interactions,
 * captcha challenges, role assignment, database tables and API routes.
 */
import type { Database } from 'bun:sqlite';
import {
  buildEmbed,
  emoji,
  renderPlaceholders,
  snowflake,
  type BotPermission,
  type Locale,
  type MessagePayload,
  type PermissionIssue,
} from '@shifubot/shared';
import {
  DiscordAPIError,
  Events,
  MessageFlags,
  type ButtonInteraction,
  type Guild,
  type GuildMember,
  type Interaction,
  type ModalSubmitInteraction,
  type NewsChannel,
  type Role,
  type TextChannel,
} from 'discord.js';
import { z } from 'zod';
import { defineServerFeature, type AppContext } from '../../apps/bot/src/core/feature';
import { LruCache } from '../../apps/bot/src/core/lru-cache';
import { syncPanelMessage, type PanelRef } from '../../apps/bot/src/core/panel';
import { isPostableChannel, missingSendPermissions, roleProblem, type RoleProblem } from '../../apps/bot/src/core/permissions';
import { WindowLimiter } from '../../apps/bot/src/core/send-queue';
import { ApiError, parseInput, parseJsonBody } from '../../apps/bot/src/http/errors';
import { sessionName } from '../../apps/bot/src/http/session';
import { CAPTCHA_LENGTH, randomCaptchaCode, renderCaptcha } from './captcha';
import {
  accountAgeDays,
  buildVerificationPanel,
  CAPTCHA_RULES,
  defaultVerificationSettings,
  FAIL_ACTIONS,
  needsCaptcha,
  verificationManifest,
  verificationSettingsSchema,
  VERIFY_IDS,
  type FailAction,
  type VerificationSettings,
} from './manifest';

export type VerificationErrorCode =
  | 'no_channel'
  | 'channel_missing'
  | 'missing_permissions'
  | 'send_failed'
  | 'no_role'
  | RoleProblem
  | 'role_failed'
  | 'fail_action_failed';

export interface VerificationStatus {
  channelExists: boolean;
  missingPermissions: string[];
  /** Why the role cannot be given, or null when it is fine. */
  roleProblem: 'no_role' | RoleProblem | null;
  panel: { channelId: string; channelName: string; url: string } | null;
  lastError: { code: VerificationErrorCode; at: number } | null;
  verifiedCount: number;
}

export interface VerificationResponse {
  settings: VerificationSettings;
  status: VerificationStatus;
  /** Set by PUT when the settings were saved but the panel could not be updated. */
  panelError?: VerificationErrorCode;
}

/** Why adding or removing a verified member failed. */
export type VerifiedMemberErrorCode = 'no_role' | RoleProblem | 'role_failed' | 'role_remove_failed' | 'already_verified' | 'unknown_user' | 'is_bot';

/** One row of the verified members tab. Names come live from Discord. */
export interface VerifiedMember {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  verifiedAt: number;
  onServer: boolean;
  hasRole: boolean;
}

export interface VerifiedMembersResponse {
  /** Everyone on the list, whatever the search. */
  members: number;
  matches: number;
  entries: VerifiedMember[];
}

export interface AddVerifiedResponse {
  displayName: string;
  onServer: boolean;
}

export interface RemoveVerifiedResponse {
  removedRole: boolean;
}

const VERIFIED_PAGE_MAX = 100;

const verifiedQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  offset: z.coerce.number().int().min(0).max(1_000_000).optional(),
  limit: z.coerce.number().int().min(1).max(VERIFIED_PAGE_MAX).optional(),
});
const addVerifiedSchema = z.object({ userId: snowflake });
const removeVerifiedSchema = z.object({ removeRole: z.boolean() });

/** Discord's "this user or member does not exist" answers. */
const isUnknownMember = (error: unknown) => error instanceof DiscordAPIError && (error.code === 10007 || error.code === 10013);

interface VerifiedRow {
  user_id: string;
  verified_at: number;
}

interface SettingsRow {
  guild_id: string;
  enabled: number;
  channel_id: string | null;
  role_id: string | null;
  mode: string;
  title: string;
  description: string;
  button_label: string;
  color: string | null;
  min_account_age_days: number;
  max_attempts: number;
  fail_action: string;
  timeout_minutes: number;
  panel_channel_id: string | null;
  panel_message_id: string | null;
  last_error: string | null;
  last_error_at: number | null;
}

export class VerificationStore {
  private readonly cache = new LruCache<string, VerificationSettings>(10_000);

  constructor(private readonly db: Database) {}

  get(guildId: string): VerificationSettings {
    const cached = this.cache.get(guildId);
    if (cached) return cached;
    const row = this.row(guildId);
    const settings: VerificationSettings = row
      ? {
          enabled: row.enabled === 1,
          channelId: row.channel_id,
          roleId: row.role_id,
          mode: row.mode === 'button' ? 'button' : 'captcha',
          title: row.title,
          description: row.description,
          buttonLabel: row.button_label,
          color: row.color,
          minAccountAgeDays: row.min_account_age_days,
          maxAttempts: row.max_attempts,
          failAction: (FAIL_ACTIONS as readonly string[]).includes(row.fail_action) ? (row.fail_action as FailAction) : 'retry',
          timeoutMinutes: row.timeout_minutes,
        }
      : defaultVerificationSettings;
    this.cache.set(guildId, settings);
    return settings;
  }

  save(guildId: string, s: VerificationSettings): void {
    this.db
      .query(
        `INSERT INTO verification_settings
           (guild_id, enabled, channel_id, role_id, mode, title, description, button_label, color,
            min_account_age_days, max_attempts, fail_action, timeout_minutes, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (guild_id) DO UPDATE SET
           enabled = excluded.enabled, channel_id = excluded.channel_id, role_id = excluded.role_id,
           mode = excluded.mode, title = excluded.title, description = excluded.description,
           button_label = excluded.button_label, color = excluded.color,
           min_account_age_days = excluded.min_account_age_days,
           max_attempts = excluded.max_attempts, fail_action = excluded.fail_action, timeout_minutes = excluded.timeout_minutes,
           updated_at = excluded.updated_at, last_error = NULL, last_error_at = NULL`,
      )
      .run(
        guildId,
        Number(s.enabled),
        s.channelId,
        s.roleId,
        s.mode,
        s.title,
        s.description,
        s.buttonLabel,
        s.color,
        s.minAccountAgeDays,
        s.maxAttempts,
        s.failAction,
        s.timeoutMinutes,
        Date.now(),
      );
    this.cache.delete(guildId);
  }

  ensureDefaults(guildId: string): void {
    this.db
      .query('INSERT OR IGNORE INTO verification_settings (guild_id, updated_at) VALUES (?, ?)')
      .run(guildId, Date.now());
    this.cache.delete(guildId);
  }

  panel(guildId: string): PanelRef | null {
    const row = this.row(guildId);
    return row?.panel_channel_id && row.panel_message_id
      ? { channelId: row.panel_channel_id, messageId: row.panel_message_id }
      : null;
  }

  setPanel(guildId: string, panel: PanelRef | null): void {
    this.ensureDefaults(guildId);
    this.db
      .query('UPDATE verification_settings SET panel_channel_id = ?, panel_message_id = ? WHERE guild_id = ?')
      .run(panel?.channelId ?? null, panel?.messageId ?? null, guildId);
  }

  setError(guildId: string, code: VerificationErrorCode | null): void {
    this.db
      .query('UPDATE verification_settings SET last_error = ?, last_error_at = ? WHERE guild_id = ?')
      .run(code, code ? Date.now() : null, guildId);
  }

  lastError(guildId: string): VerificationStatus['lastError'] {
    const row = this.row(guildId);
    return row?.last_error && row.last_error_at
      ? { code: row.last_error as VerificationErrorCode, at: row.last_error_at }
      : null;
  }

  markVerified(guildId: string, userId: string): void {
    this.db
      .query('INSERT OR REPLACE INTO verification_members (guild_id, user_id, verified_at) VALUES (?, ?, ?)')
      .run(guildId, userId, Date.now());
  }

  isVerified(guildId: string, userId: string): boolean {
    return Boolean(
      this.db.query('SELECT 1 FROM verification_members WHERE guild_id = ? AND user_id = ?').get(guildId, userId),
    );
  }

  verifiedCount(guildId: string): number {
    return (
      this.db
        .query<{ count: number }, [string]>('SELECT COUNT(*) AS count FROM verification_members WHERE guild_id = ?')
        .get(guildId)?.count ?? 0
    );
  }

  /** Newest first. `ids` limits the list to those users, `idPrefix` to ids that start with it. */
  listVerified(guildId: string, options: { ids?: string[]; idPrefix?: string; offset?: number; limit: number }) {
    const filter = `guild_id = ?1
      AND (?2 IS NULL OR user_id IN (SELECT value FROM json_each(?2)))
      AND (?3 IS NULL OR user_id LIKE ?3)`;
    const params: [string, string | null, string | null] = [guildId, options.ids ? JSON.stringify(options.ids) : null, options.idPrefix ? `${options.idPrefix}%` : null];
    return {
      matches: this.db.query<{ count: number }, typeof params>(`SELECT COUNT(*) AS count FROM verification_members WHERE ${filter}`).get(...params)?.count ?? 0,
      rows: this.db
        .query<VerifiedRow, [...typeof params, number, number]>(
          `SELECT user_id, verified_at FROM verification_members WHERE ${filter}
           ORDER BY verified_at DESC, user_id LIMIT ?4 OFFSET ?5`,
        )
        .all(...params, options.limit, options.offset ?? 0),
    };
  }

  /** True when the member was on the list. */
  removeVerified(guildId: string, userId: string): boolean {
    return this.db.query('DELETE FROM verification_members WHERE guild_id = ? AND user_id = ?').run(guildId, userId).changes > 0;
  }

  private row(guildId: string) {
    return this.db
      .query<SettingsRow, [string]>('SELECT * FROM verification_settings WHERE guild_id = ?')
      .get(guildId);
  }
}

interface Challenge {
  code: string;
}

/** Extra permission each fail action needs. */
const FAIL_ACTION_PERMISSION: Record<FailAction, BotPermission | null> = {
  retry: null,
  timeout: 'ModerateMembers',
  kick: 'KickMembers',
  ban: 'BanMembers',
};

const BASE_PERMISSIONS: BotPermission[] = ['ViewChannel', 'SendMessages', 'EmbedLinks', 'ManageRoles'];

type PanelResult = { ok: true; channel: TextChannel | NewsChannel | null } | { ok: false; error: VerificationErrorCode };

/** Uppercase, without spaces: people often type "ac3 xkp". */
export function normalizeAnswer(input: string): string {
  return input.replace(/\s+/g, '').toUpperCase();
}

export default defineServerFeature({
  manifest: verificationManifest,
  permissions: BASE_PERMISSIONS,
  tables: ['verification_settings', 'verification_members'],
  migrations: [
    {
      id: 'verification_001_init',
      sql: `
        CREATE TABLE verification_settings (
          guild_id TEXT PRIMARY KEY,
          enabled INTEGER NOT NULL DEFAULT 0,
          channel_id TEXT,
          role_id TEXT,
          mode TEXT NOT NULL DEFAULT 'captcha',
          title TEXT NOT NULL DEFAULT '',
          description TEXT NOT NULL DEFAULT '',
          button_label TEXT NOT NULL DEFAULT '',
          color TEXT,
          min_account_age_days INTEGER NOT NULL DEFAULT 0,
          restore_on_rejoin INTEGER NOT NULL DEFAULT 1,
          panel_channel_id TEXT,
          panel_message_id TEXT,
          last_error TEXT,
          last_error_at INTEGER,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE verification_members (
          guild_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          verified_at INTEGER NOT NULL,
          PRIMARY KEY (guild_id, user_id)
        );
      `,
    },
    {
      id: 'verification_002_fail_action',
      sql: `
        ALTER TABLE verification_settings ADD COLUMN max_attempts INTEGER NOT NULL DEFAULT 3;
        ALTER TABLE verification_settings ADD COLUMN fail_action TEXT NOT NULL DEFAULT 'retry';
        ALTER TABLE verification_settings ADD COLUMN timeout_minutes INTEGER NOT NULL DEFAULT 10;
      `,
    },
    {
      // Members who verified before no longer get the role on joining: they press the button, without a captcha.
      id: 'verification_003_drop_restore_on_rejoin',
      sql: `ALTER TABLE verification_settings DROP COLUMN restore_on_rejoin;`,
    },
    {
      id: 'verification_004_members_by_date',
      sql: `CREATE INDEX idx_verification_members_date ON verification_members (guild_id, verified_at DESC);`,
    },
  ],

  setup(ctx: AppContext) {
    const { client, db, logger, queue, guildSettings } = ctx;
    const store = new VerificationStore(db);
    /** Open captchas per member. Memory only: a restart just asks for a new picture. */
    const challenges = new LruCache<string, Challenge>(50_000, CAPTCHA_RULES.expiresMinutes * 60_000);
    /**
     * Wrong answers per member. Kept apart from the picture so "New picture"
     * cannot be used to get unlimited tries.
     */
    const failures = new LruCache<string, number>(50_000, CAPTCHA_RULES.attemptsWindowMinutes * 60_000);
    /** New pictures per member per minute. Rendering costs CPU, so this also protects the bot. */
    const captchaLimiter = new WindowLimiter(5);
    const sampleLimiter = new WindowLimiter(20);
    const verifiedListLimiter = new WindowLimiter(60);
    const verifiedChangeLimiter = new WindowLimiter(30);
    /** Names of people who left the server: those need a Discord call per person. */
    const leftProfiles = new LruCache<string, { displayName: string; avatarUrl: string }>(10_000, 10 * 60_000);

    const texts = (locale: Locale) => verificationManifest.messages[locale];

    function resolveRole(guild: Guild, settings: VerificationSettings): { role: Role } | { error: 'no_role' | RoleProblem } {
      if (!settings.roleId) return { error: 'no_role' };
      const role = guild.roles.cache.get(settings.roleId);
      const problem = roleProblem(guild, role);
      return problem ? { error: problem } : { role: role! };
    }

    /** Post, update or remove the panel message so it matches the settings. */
    async function syncPanel(guild: Guild, settings: VerificationSettings, forceNew = false): Promise<PanelResult> {
      const result = await syncPanelMessage({
        guild,
        queue,
        queueKey: `verification:${guild.id}`,
        existing: store.panel(guild.id),
        target: settings.enabled
          ? {
              channelId: settings.channelId,
              payload: buildVerificationPanel(settings, { locale: guildSettings.locale(guild.id), server: { name: guild.name } }),
            }
          : null,
        forceNew,
      });
      if (!result.ok) {
        logger.warn('Verification panel update failed', { guildId: guild.id, code: result.error });
        // The panel is reposted when deleted, so "panel_deleted" cannot happen here.
        return { ok: false, error: result.error === 'panel_deleted' ? 'send_failed' : result.error };
      }
      store.setPanel(guild.id, result.panel);
      return { ok: true, channel: result.channel };
    }

    function status(guild: Guild, settings: VerificationSettings): VerificationStatus {
      const channel = settings.channelId ? guild.channels.cache.get(settings.channelId) : undefined;
      const postable = isPostableChannel(channel) ? channel : null;
      const role = resolveRole(guild, settings);
      const panel = store.panel(guild.id);
      const panelChannel = panel ? guild.channels.cache.get(panel.channelId) : undefined;
      return {
        channelExists: Boolean(postable),
        missingPermissions: postable ? missingSendPermissions(guild, postable) : [],
        roleProblem: 'error' in role ? role.error : null,
        panel:
          panel && panelChannel
            ? {
                channelId: panel.channelId,
                channelName: panelChannel.name,
                url: `https://discord.com/channels/${guild.id}/${panel.channelId}/${panel.messageId}`,
              }
            : null,
        lastError: store.lastError(guild.id),
        verifiedCount: store.verifiedCount(guild.id),
      };
    }

    function captchaMessage(locale: Locale, code: string, attemptsLeft: number): MessagePayload & { files: { attachment: Buffer; name: string }[] } {
      const t = texts(locale);
      return {
        embeds: [
          {
            ...buildEmbed({
              emoji: verificationManifest.emoji,
              title: t.replies.captchaTitle,
              description: renderPlaceholders(t.replies.captchaBody, {
                length: CAPTCHA_LENGTH,
                minutes: CAPTCHA_RULES.expiresMinutes,
                attempts: attemptsLeft,
              }),
              footer: t.name,
            }),
            image: { url: 'attachment://captcha.png' },
          },
        ],
        components: [
          {
            type: 1,
            components: [
              { type: 2, style: 3, label: t.replies.answerButton, custom_id: VERIFY_IDS.answer, emoji: { name: '⌨️' } },
              { type: 2, style: 2, label: t.replies.refreshButton, custom_id: VERIFY_IDS.refresh, emoji: { name: '🔄' } },
            ],
          },
        ],
        files: [{ attachment: renderCaptcha(code), name: 'captcha.png' }],
        allowedMentions: { users: [], roles: [], parse: [] },
      };
    }

    async function grantRole(member: GuildMember, role: Role): Promise<boolean> {
      try {
        await member.roles.add(role, 'ShifuBot verification');
        store.markVerified(member.guild.id, member.id);
        return true;
      } catch (error) {
        logger.warn('Could not give the verified role', { guildId: member.guild.id, roleId: role.id, error });
        store.setError(member.guild.id, 'role_failed');
        return false;
      }
    }

    /** Null only when Discord says the member is not there, so an outage never looks like everyone left. */
    async function fetchMember(guild: Guild, userId: string): Promise<GuildMember | null> {
      try {
        return await guild.members.fetch({ user: userId, cache: false });
      } catch (error) {
        if (isUnknownMember(error)) return null;
        throw error;
      }
    }

    async function leftProfile(userId: string) {
      const cached = leftProfiles.get(userId);
      if (cached) return cached;
      try {
        const user = await client.users.fetch(userId, { cache: false });
        const profile = { displayName: user.displayName, avatarUrl: user.displayAvatarURL({ size: 128, extension: 'png' }) };
        leftProfiles.set(userId, profile);
        return profile;
      } catch {
        return null;
      }
    }

    async function verifiedEntries(guild: Guild, rows: VerifiedRow[]): Promise<VerifiedMember[]> {
      if (!rows.length) return []; // An empty user list would ask Discord for every member.
      const members = await guild.members.fetch({ user: rows.map((row) => row.user_id), time: 10_000 });
      const { roleId } = store.get(guild.id);
      return Promise.all(
        rows.map(async (row) => {
          const member = members.get(row.user_id);
          const profile = member
            ? { displayName: member.displayName, avatarUrl: member.displayAvatarURL({ size: 128, extension: 'png' }) }
            : await leftProfile(row.user_id);
          return {
            userId: row.user_id,
            displayName: profile?.displayName ?? row.user_id,
            avatarUrl: profile?.avatarUrl ?? null,
            verifiedAt: row.verified_at,
            onServer: Boolean(member),
            hasRole: Boolean(member && roleId && member.roles.cache.has(roleId)),
          };
        }),
      );
    }

    const takeVerifiedChange = (guildId: string) => {
      if (!verifiedChangeLimiter.tryTake(guildId)) throw new ApiError(429, 'rate_limited', 'Too many changes to the verified list');
    };

    const reply = (interaction: ButtonInteraction | ModalSubmitInteraction, icon: keyof typeof emoji, text: string) =>
      interaction.reply({ content: `${emoji[icon]} ${text}`, flags: MessageFlags.Ephemeral });

    /** Panel button and "New picture" button. */
    async function onStart(interaction: ButtonInteraction<'cached'>, refresh: boolean) {
      const { guild, member } = interaction;
      const locale = guildSettings.locale(guild.id);
      const t = texts(locale).replies;
      const settings = store.get(guild.id);

      if (!settings.enabled) return reply(interaction, 'info', t.disabled);
      const role = resolveRole(guild, settings);
      if ('error' in role) {
        store.setError(guild.id, role.error);
        return reply(interaction, 'error', t.notConfigured);
      }
      if (member.roles.cache.has(role.role.id)) return reply(interaction, 'success', t.alreadyVerified);
      if (member.isCommunicationDisabled()) {
        const until = Math.floor(member.communicationDisabledUntilTimestamp / 1000);
        return reply(interaction, 'warning', renderPlaceholders(t.timedOut, { time: `<t:${until}:R>` }));
      }
      if (settings.minAccountAgeDays > 0 && accountAgeDays(interaction.user.createdAt) < settings.minAccountAgeDays) {
        logger.info('Verification refused: account too new', { guildId: guild.id, userId: member.id });
        ctx.audit.record(guild.id, {
          type: 'shifubot.verificationRefused',
          actorId: member.id,
          targetId: member.id,
          targetKind: 'user',
          data: { reason: `Account younger than ${settings.minAccountAgeDays} days` },
        });
        return reply(interaction, 'warning', renderPlaceholders(t.tooYoung, { days: settings.minAccountAgeDays }));
      }

      const verifiedBefore = store.isVerified(guild.id, member.id);
      if (!needsCaptcha(settings.mode, verifiedBefore)) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const ok = await grantRole(member, role.role);
        if (ok) ctx.audit.record(guild.id, { type: 'shifubot.verified', actorId: member.id, targetId: member.id, targetKind: 'user', data: { mode: verifiedBefore ? 'returning' : 'button' } });
        const done = verifiedBefore ? t.restored : renderPlaceholders(t.success, { server: guild.name });
        await interaction.editReply(ok ? `${emoji.success} ${done}` : `${emoji.error} ${t.roleFailed}`);
        return;
      }

      const key = `${guild.id}:${member.id}`;
      if (!captchaLimiter.tryTake(key)) return reply(interaction, 'warning', t.slowDown);
      const code = randomCaptchaCode();
      challenges.set(key, { code });
      const message = captchaMessage(locale, code, settings.maxAttempts - (failures.get(key) ?? 0));
      if (refresh) await interaction.update({ ...message, attachments: [] });
      else await interaction.reply({ ...message, flags: MessageFlags.Ephemeral });
    }

    /** "Enter code" button: open the answer form. */
    async function onAnswer(interaction: ButtonInteraction<'cached'>) {
      const t = texts(guildSettings.locale(interaction.guild.id)).replies;
      if (!challenges.get(`${interaction.guild.id}:${interaction.user.id}`)) return reply(interaction, 'warning', t.expired);
      await interaction.showModal({
        custom_id: VERIFY_IDS.modal,
        title: t.modalTitle,
        components: [
          {
            type: 1,
            components: [
              {
                type: 4,
                custom_id: VERIFY_IDS.codeInput,
                label: t.modalLabel,
                placeholder: t.modalPlaceholder,
                style: 1,
                min_length: CAPTCHA_LENGTH,
                max_length: CAPTCHA_LENGTH + 4,
                required: true,
              },
            ],
          },
        ],
      });
    }

    /** The answer form was sent. */
    async function onModal(interaction: ModalSubmitInteraction<'cached'>) {
      const { guild, member } = interaction;
      const t = texts(guildSettings.locale(guild.id)).replies;
      const key = `${guild.id}:${member.id}`;
      const challenge = challenges.get(key);
      if (!challenge) return reply(interaction, 'warning', t.expired);

      const settings = store.get(guild.id);
      if (normalizeAnswer(interaction.fields.getTextInputValue(VERIFY_IDS.codeInput)) !== challenge.code) {
        const attempts = (failures.get(key) ?? 0) + 1;
        if (attempts >= settings.maxAttempts) {
          challenges.delete(key);
          failures.delete(key);
          return applyFailAction(interaction, settings);
        }
        failures.set(key, attempts);
        return reply(interaction, 'warning', renderPlaceholders(t.wrong, { left: settings.maxAttempts - attempts }));
      }

      challenges.delete(key);
      failures.delete(key);
      const role = resolveRole(guild, settings);
      if (!settings.enabled || 'error' in role) return reply(interaction, 'error', t.notConfigured);
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const ok = await grantRole(member, role.role);
      logger.info('Member verified', { guildId: guild.id, userId: member.id, ok });
      if (ok) ctx.audit.record(guild.id, { type: 'shifubot.verified', actorId: member.id, targetId: member.id, targetKind: 'user', data: { mode: 'captcha' } });
      await interaction.editReply(
        ok ? `${emoji.success} ${renderPlaceholders(t.success, { server: guild.name })}` : `${emoji.error} ${t.roleFailed}`,
      );
    }

    /** The member used up every try: run the action chosen on the dashboard. */
    async function applyFailAction(interaction: ModalSubmitInteraction<'cached'>, settings: VerificationSettings) {
      const { guild, member } = interaction;
      const t = texts(guildSettings.locale(guild.id)).replies;
      const action = settings.failAction;
      const reason = 'ShifuBot verification: too many wrong captcha answers';
      logger.info('Verification failed, running fail action', { guildId: guild.id, userId: member.id, action });
      ctx.audit.record(guild.id, {
        type: 'shifubot.verificationFailed',
        actorId: member.id,
        targetId: member.id,
        targetKind: 'user',
        data: { action, attempts: settings.maxAttempts },
      });
      if (action === 'retry') return reply(interaction, 'error', t.tooManyAttempts);

      // Owners, admins and members above ShifuBot's role cannot be punished by the bot.
      const allowed = action === 'timeout' ? member.moderatable : action === 'kick' ? member.kickable : member.bannable;
      if (!allowed) {
        logger.warn('Verification fail action not possible', { guildId: guild.id, userId: member.id, action });
        store.setError(guild.id, 'fail_action_failed');
        return reply(interaction, 'error', t.tooManyAttempts);
      }

      try {
        if (action === 'timeout') {
          await member.timeout(settings.timeoutMinutes * 60_000, reason);
          await reply(interaction, 'warning', renderPlaceholders(t.failedTimeout, { minutes: settings.timeoutMinutes }));
        } else {
          // Answer first: after a kick or ban the reply could no longer reach them.
          await reply(interaction, 'error', action === 'kick' ? t.failedKick : t.failedBan);
          if (action === 'kick') await member.kick(reason);
          else await member.ban({ reason });
        }
      } catch (error) {
        logger.warn('Verification fail action failed', { guildId: guild.id, userId: member.id, action, error });
        store.setError(guild.id, 'fail_action_failed');
        if (!interaction.replied) await reply(interaction, 'error', t.tooManyAttempts);
      }
    }

    const response = (guild: Guild, settings: VerificationSettings, panelError?: VerificationErrorCode): VerificationResponse => ({
      settings,
      status: status(guild, settings),
      ...(panelError ? { panelError } : {}),
    });

    return {
      isEnabled: (guildId) => store.get(guildId).enabled,

      onGuildCreate: (guild) => store.ensureDefaults(guild.id),

      requiredPermissions: (guildId) => {
        const settings = store.get(guildId);
        const extra = settings.mode === 'captcha' ? FAIL_ACTION_PERMISSION[settings.failAction] : null;
        return extra ? [...BASE_PERMISSIONS, extra] : BASE_PERMISSIONS;
      },

      health: (guild) => {
        const settings = store.get(guild.id);
        const issues: Omit<PermissionIssue, 'feature'>[] = [];
        const channel = settings.channelId ? guild.channels.cache.get(settings.channelId) : undefined;
        if (settings.channelId && !isPostableChannel(channel)) issues.push({ code: 'channel_missing' });
        if (isPostableChannel(channel)) {
          const missing = missingSendPermissions(guild, channel) as BotPermission[];
          if (missing.length) issues.push({ code: 'missing_permissions', channel: { id: channel.id, name: channel.name }, permissions: missing });
        }
        const role = resolveRole(guild, settings);
        if ('error' in role && role.error !== 'no_role') issues.push({ code: role.error });
        return issues;
      },

      events: {
        [Events.InteractionCreate]: async (interaction: Interaction) => {
          if (!interaction.inCachedGuild()) return;
          if (interaction.isButton()) {
            if (interaction.customId === VERIFY_IDS.start) await onStart(interaction, false);
            else if (interaction.customId === VERIFY_IDS.refresh) await onStart(interaction, true);
            else if (interaction.customId === VERIFY_IDS.answer) await onAnswer(interaction);
          } else if (interaction.isModalSubmit() && interaction.customId === VERIFY_IDS.modal) {
            await onModal(interaction);
          }
        },
      },

      routes(router) {
        router.get('/', (c) => {
          const guild = c.get('guild');
          return c.json(response(guild, store.get(guild.id)));
        });

        router.put('/', async (c) => {
          const guild = c.get('guild');
          const settings = await parseJsonBody(c.req.raw, verificationSettingsSchema);
          store.save(guild.id, settings);
          logger.info('Verification settings saved', { guildId: guild.id, userId: c.get('session').userId });
          const result = await syncPanel(guild, settings);
          if (!result.ok) store.setError(guild.id, result.error);
          return c.json(response(guild, store.get(guild.id), result.ok ? undefined : result.error));
        });

        const repostLimiter = new WindowLimiter(5);
        /** Post a fresh panel, e.g. after someone deleted it. Uses the saved settings. */
        router.post('/panel', async (c) => {
          const guild = c.get('guild');
          if (!repostLimiter.tryTake(guild.id)) {
            throw new ApiError(429, 'rate_limited', 'You can post the panel at most 5 times per minute');
          }
          const settings = store.get(guild.id);
          const result = await syncPanel(guild, settings, true);
          if (!result.ok) {
            store.setError(guild.id, result.error);
            throw new ApiError(409, result.error, `Cannot post the panel: ${result.error.replaceAll('_', ' ')}`);
          }
          store.setError(guild.id, null);
          return c.json({ ...response(guild, settings), channel: result.channel && { id: result.channel.id, name: result.channel.name } });
        });

        router.get('/members', async (c) => {
          const guild = c.get('guild');
          const query = parseInput(verifiedQuerySchema, c.req.query(), 'List query');
          if (!verifiedListLimiter.tryTake(guild.id)) throw new ApiError(429, 'rate_limited', 'Too many requests for the verified list');
          const q = query.q ?? '';
          const idPrefix = /^\d{5,20}$/.test(q) ? q : undefined;
          // Names live on Discord, so a name search asks Discord who matches.
          const ids = q && !idPrefix ? [...(await guild.members.search({ query: q, limit: 1000, cache: false })).keys()] : undefined;
          const { matches, rows } = store.listVerified(guild.id, { ids, idPrefix, offset: query.offset, limit: query.limit ?? 50 });
          return c.json({ members: store.verifiedCount(guild.id), matches, entries: await verifiedEntries(guild, rows) } satisfies VerifiedMembersResponse);
        });

        /** Add someone by user id. Members on the server get the role now, others when they press Verify after joining. */
        router.post('/members', async (c) => {
          const guild = c.get('guild');
          const session = c.get('session');
          takeVerifiedChange(guild.id);
          const { userId } = await parseJsonBody(c.req.raw, addVerifiedSchema);
          if (store.isVerified(guild.id, userId)) throw new ApiError(409, 'already_verified', 'This member is already on the list');

          const member = await fetchMember(guild, userId);
          const user =
            member?.user ??
            (await client.users.fetch(userId, { cache: false }).catch((error: unknown) => {
              if (isUnknownMember(error)) return null;
              throw error;
            }));
          if (!user) throw new ApiError(404, 'unknown_user', 'There is no Discord user with this id');
          if (user.bot) throw new ApiError(400, 'is_bot', 'Bots cannot be verified');

          if (member) {
            const role = resolveRole(guild, store.get(guild.id));
            if ('error' in role) throw new ApiError(409, role.error, `Cannot give the role: ${role.error.replaceAll('_', ' ')}`);
            if (!(await grantRole(member, role.role))) throw new ApiError(409, 'role_failed', 'Discord refused to give the role');
          } else {
            store.markVerified(guild.id, userId);
          }

          const displayName = member?.displayName ?? user.displayName;
          logger.info('Member added to the verified list', { guildId: guild.id, targetId: userId, userId: session.userId });
          ctx.audit.record(guild.id, {
            type: 'shifubot.verified',
            actorId: session.userId,
            targetId: userId,
            targetKind: 'user',
            data: { mode: 'manual', actorName: sessionName(session), targetName: displayName },
          });
          return c.json({ displayName, onServer: Boolean(member) } satisfies AddVerifiedResponse);
        });

        /** The role goes first: if Discord refuses, the member stays on the list and it can be tried again. */
        router.post('/members/:userId/remove', async (c) => {
          const guild = c.get('guild');
          const session = c.get('session');
          takeVerifiedChange(guild.id);
          const userId = parseInput(snowflake, c.req.param('userId'), 'User id');
          const { removeRole } = await parseJsonBody(c.req.raw, removeVerifiedSchema);
          if (!store.isVerified(guild.id, userId)) throw new ApiError(404, 'not_found', 'This member is not on the list');

          // Without the role step a Discord outage must not block taking someone off the list.
          const member = await fetchMember(guild, userId).catch((error: unknown) => {
            if (removeRole) throw error;
            return null;
          });
          const settings = store.get(guild.id);
          let removedRole = false;
          if (removeRole && member && settings.roleId && member.roles.cache.has(settings.roleId)) {
            const role = resolveRole(guild, settings);
            if ('error' in role) throw new ApiError(409, role.error, `Cannot take the role: ${role.error.replaceAll('_', ' ')}`);
            try {
              await member.roles.remove(role.role, 'ShifuBot verification: removed from the verified list');
              removedRole = true;
            } catch (error) {
              logger.warn('Could not take the verified role', { guildId: guild.id, roleId: role.role.id, error });
              throw new ApiError(409, 'role_remove_failed', 'Discord refused to take the role');
            }
          }

          store.removeVerified(guild.id, userId);
          logger.info('Member removed from the verified list', { guildId: guild.id, targetId: userId, removedRole, userId: session.userId });
          ctx.audit.record(guild.id, {
            type: 'shifubot.verificationRemoved',
            actorId: session.userId,
            targetId: userId,
            targetKind: 'user',
            data: { removedRole, actorName: sessionName(session), ...(member ? { targetName: member.displayName } : {}) },
          });
          return c.json({ removedRole } satisfies RemoveVerifiedResponse);
        });

        /** A sample captcha for the dashboard preview. */
        router.get('/captcha.png', (c) => {
          if (!sampleLimiter.tryTake(c.get('guild').id)) throw new ApiError(429, 'rate_limited', 'Too many sample images');
          return c.body(new Uint8Array(renderCaptcha(randomCaptchaCode())), 200, {
            'Content-Type': 'image/png',
            'Cache-Control': 'no-store',
          });
        });
      },
    };
  },
});
