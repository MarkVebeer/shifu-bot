/**
 * Goon counter: bot side. Panel message, +1 and Undo buttons, nickname updates and API routes.
 */
import { emoji, renderPlaceholders, type BotPermission, type Locale, type PermissionIssue } from '@shifubot/shared';
import {
  Events,
  MessageFlags,
  PermissionFlagsBits,
  type ButtonInteraction,
  type Guild,
  type GuildMember,
  type Interaction,
} from 'discord.js';
import { defineServerFeature, type AppContext } from '../../apps/bot/src/core/feature';
import { syncPanelMessage } from '../../apps/bot/src/core/panel';
import { isPostableChannel, missingSendPermissions } from '../../apps/bot/src/core/permissions';
import { WindowLimiter } from '../../apps/bot/src/core/send-queue';
import { ApiError, parseJsonBody } from '../../apps/bot/src/http/errors';
import {
  buildGoonPanel,
  GOON_IDS,
  goonManifest,
  goonSettingsSchema,
  LEADERBOARD_SIZE,
  type GoonSettings,
} from './manifest';
import { resolveBaseName, targetNickname } from './nickname';
import { GOON_MIGRATIONS, GOON_TABLES, GoonStore, type GoonErrorCode, type GoonTopEntry } from './store';

export interface GoonStatus {
  channelExists: boolean;
  missingPermissions: string[];
  panel: { channelId: string; channelName: string; url: string } | null;
  lastError: { code: GoonErrorCode; at: number } | null;
  /** False when ShifuBot cannot change nicknames on this server. */
  canManageNicknames: boolean;
  total: number;
  top: GoonTopEntry[];
}

export interface GoonResponse {
  settings: GoonSettings;
  status: GoonStatus;
  /** Set by PUT when the settings were saved but the panel could not be updated. */
  panelError?: GoonErrorCode;
}

const BASE_PERMISSIONS: BotPermission[] = ['ViewChannel', 'SendMessages', 'EmbedLinks'];

/** The panel is redrawn at most this often, so many presses do not hit Discord's edit limit. */
const PANEL_REFRESH_MS = 15_000;

type RenameProblem = 'renameOwner' | 'renameTooHigh' | 'renameNoPermission' | 'renameError';

export default defineServerFeature({
  manifest: goonManifest,
  permissions: BASE_PERMISSIONS,
  tables: GOON_TABLES,
  migrations: GOON_MIGRATIONS,

  setup(ctx: AppContext) {
    const { db, logger, queue, guildSettings, client } = ctx;
    const store = new GoonStore(db);
    const lastRefresh = new Map<string, number>();
    const timers = new Map<string, ReturnType<typeof setTimeout>>();

    const texts = (locale: Locale) => goonManifest.messages[locale];

    function panelPayload(guild: Guild, settings: GoonSettings) {
      return buildGoonPanel(settings, {
        locale: guildSettings.locale(guild.id),
        server: { name: guild.name },
        entries: store.top(guild.id, LEADERBOARD_SIZE),
        total: store.total(guild.id),
      });
    }

    /** Post, update or remove the panel so it matches the settings and the current counts. */
    async function syncPanel(guild: Guild, options: { forceNew?: boolean; scheduled?: boolean } = {}) {
      const settings = store.get(guild.id);
      const result = await syncPanelMessage({
        guild,
        queue,
        queueKey: `goon:${guild.id}`,
        existing: store.panel(guild.id),
        target: settings.enabled ? { channelId: settings.channelId, payload: panelPayload(guild, settings) } : null,
        forceNew: options.forceNew,
        // A scheduled refresh never brings back a panel someone deleted on purpose.
        repostIfDeleted: !options.scheduled,
      });
      lastRefresh.set(guild.id, Date.now());
      if (!result.ok) {
        logger.warn('Goon panel update failed', { guildId: guild.id, code: result.error });
        if (result.error === 'panel_deleted') {
          store.setPanel(guild.id, null);
          return { ok: false as const, error: 'send_failed' as const };
        }
        return { ok: false as const, error: result.error };
      }
      store.setPanel(guild.id, result.panel);
      return { ok: true as const, channel: result.channel };
    }

    /** Redraw the panel soon, at most once per PANEL_REFRESH_MS per server. */
    function schedulePanel(guildId: string) {
      if (!store.get(guildId).showLeaderboard || timers.has(guildId)) return;
      const wait = Math.max(0, PANEL_REFRESH_MS - (Date.now() - (lastRefresh.get(guildId) ?? 0)));
      timers.set(
        guildId,
        setTimeout(() => {
          timers.delete(guildId);
          const guild = client.guilds.cache.get(guildId);
          if (!guild || !store.panel(guildId)) return;
          void syncPanel(guild, { scheduled: true }).catch((error) => logger.warn('Goon panel refresh failed', { guildId, error }));
        }, wait),
      );
    }

    /** Write the count after the member's nickname. Returns why it was not possible, or null. */
    async function updateNickname(member: GuildMember, count: number, settings: GoonSettings): Promise<RenameProblem | null> {
      if (!settings.renameMembers) return null;
      const { guild } = member;
      if (member.id === guild.ownerId) return 'renameOwner';
      if (!guild.members.me?.permissions.has(PermissionFlagsBits.ManageNicknames)) return 'renameNoPermission';
      if (!member.manageable) return 'renameTooHigh';

      const ownName = member.user.globalName ?? member.user.username;
      const base = resolveBaseName({
        nickname: member.nickname,
        ownName,
        stored: store.storedName(guild.id, member.id),
        format: settings.nameFormat,
      });
      const nick = targetNickname({ base, count, format: settings.nameFormat, ownName });
      try {
        if (member.nickname !== nick) await member.setNickname(nick, 'ShifuBot goon counter');
        store.saveName(guild.id, member.id, { baseName: base, lastNick: nick, lastFormat: settings.nameFormat });
        return null;
      } catch (error) {
        logger.warn('Goon nickname update failed', { guildId: guild.id, userId: member.id, error });
        return 'renameError';
      }
    }

    const time = (ms: number) => `<t:${Math.ceil(ms / 1000)}:R>`;

    async function onButton(interaction: ButtonInteraction<'cached'>, action: 'add' | 'undo') {
      const { guild, member } = interaction;
      const t = texts(guildSettings.locale(guild.id)).replies;
      const settings = store.get(guild.id);
      if (!settings.enabled) {
        await interaction.reply({ content: `${emoji.info} ${t.disabled}`, flags: MessageFlags.Ephemeral });
        return;
      }

      const now = Date.now();
      let count: number;
      let text: string;
      if (action === 'add') {
        const result = store.press(guild.id, member.id, {
          now,
          cooldownMs: settings.cooldownMinutes * 60_000,
          displayName: member.displayName,
          avatarUrl: member.displayAvatarURL({ size: 64 }),
        });
        if (!result.ok) {
          await interaction.reply({
            content: `${emoji.warning} ${renderPlaceholders(t.cooldown, { time: time(result.nextAt) })}`,
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        count = result.count;
        text = `${emoji.goon} ${renderPlaceholders(t.counted, { count, time: time(now + settings.undoMinutes * 60_000) })}`;
      } else {
        const result = store.undo(guild.id, member.id, { now, windowMs: settings.undoMinutes * 60_000 });
        if (result === null) {
          await interaction.reply({
            content: `${emoji.info} ${renderPlaceholders(t.nothingToUndo, { minutes: settings.undoMinutes })}`,
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        count = result;
        text = `${emoji.success} ${renderPlaceholders(t.undone, { count })}`;
      }

      // Renaming can take a moment: answer within Discord's 3 seconds first.
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      schedulePanel(guild.id);
      const problem = await updateNickname(member, count, settings);
      if (problem) text += `\n${emoji.warning} ${renderPlaceholders(t.renameFailed, { reason: t[problem] })}`;
      await interaction.editReply(text);
    }

    function status(guild: Guild, settings: GoonSettings): GoonStatus {
      const channel = settings.channelId ? guild.channels.cache.get(settings.channelId) : undefined;
      const postable = isPostableChannel(channel) ? channel : null;
      const panel = store.panel(guild.id);
      const panelChannel = panel ? guild.channels.cache.get(panel.channelId) : undefined;
      return {
        channelExists: Boolean(postable),
        missingPermissions: postable ? missingSendPermissions(guild, postable) : [],
        panel:
          panel && panelChannel
            ? {
                channelId: panel.channelId,
                channelName: panelChannel.name,
                url: `https://discord.com/channels/${guild.id}/${panel.channelId}/${panel.messageId}`,
              }
            : null,
        lastError: store.lastError(guild.id),
        canManageNicknames: Boolean(guild.members.me?.permissions.has(PermissionFlagsBits.ManageNicknames)),
        total: store.total(guild.id),
        top: store.top(guild.id, LEADERBOARD_SIZE),
      };
    }

    const response = (guild: Guild, settings: GoonSettings, panelError?: GoonErrorCode): GoonResponse => ({
      settings,
      status: status(guild, settings),
      ...(panelError ? { panelError } : {}),
    });

    return {
      isEnabled: (guildId) => store.get(guildId).enabled,

      requiredPermissions: (guildId) =>
        store.get(guildId).renameMembers ? [...BASE_PERMISSIONS, 'ManageNicknames'] : BASE_PERMISSIONS,

      health: (guild) => {
        const settings = store.get(guild.id);
        const issues: Omit<PermissionIssue, 'feature'>[] = [];
        const channel = settings.channelId ? guild.channels.cache.get(settings.channelId) : undefined;
        if (settings.channelId && !isPostableChannel(channel)) issues.push({ code: 'channel_missing' });
        if (isPostableChannel(channel)) {
          const missing = missingSendPermissions(guild, channel) as BotPermission[];
          if (missing.length) issues.push({ code: 'missing_permissions', channel: { id: channel.id, name: channel.name }, permissions: missing });
        }
        return issues;
      },

      events: {
        [Events.InteractionCreate]: async (interaction: Interaction) => {
          if (!interaction.inCachedGuild() || !interaction.isButton()) return;
          if (interaction.customId === GOON_IDS.add) await onButton(interaction, 'add');
          else if (interaction.customId === GOON_IDS.undo) await onButton(interaction, 'undo');
        },
      },

      routes(router) {
        router.get('/', (c) => {
          const guild = c.get('guild');
          return c.json(response(guild, store.get(guild.id)));
        });

        router.put('/', async (c) => {
          const guild = c.get('guild');
          const settings = await parseJsonBody(c.req.raw, goonSettingsSchema);
          store.save(guild.id, settings);
          logger.info('Goon counter settings saved', { guildId: guild.id, userId: c.get('session').userId });
          const result = await syncPanel(guild);
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
          const result = await syncPanel(guild, { forceNew: true });
          if (!result.ok) {
            store.setError(guild.id, result.error);
            throw new ApiError(409, result.error, `Cannot post the panel: ${result.error.replaceAll('_', ' ')}`);
          }
          store.setError(guild.id, null);
          return c.json({ ...response(guild, store.get(guild.id)), channel: result.channel && { id: result.channel.id, name: result.channel.name } });
        });
      },
    };
  },
});
