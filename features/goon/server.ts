/**
 * Goon counter: bot side. Panel message, +1 and Undo buttons, API routes and
 * the member routes behind the full list page.
 */
import { emoji, renderPlaceholders, type BotPermission, type Locale, type PermissionIssue } from '@shifubot/shared';
import { Events, MessageFlags, type ButtonInteraction, type Guild, type Interaction } from 'discord.js';
import { z } from 'zod';
import { defineServerFeature, type AppContext } from '../../apps/bot/src/core/feature';
import { syncPanelMessage } from '../../apps/bot/src/core/panel';
import { isPostableChannel, missingSendPermissions } from '../../apps/bot/src/core/permissions';
import { WindowLimiter } from '../../apps/bot/src/core/send-queue';
import { ApiError, parseInput, parseJsonBody } from '../../apps/bot/src/http/errors';
import { buildGoonPanel, GOON_IDS, goonManifest, goonSettingsSchema, LEADERBOARD_SIZE, listPath, type GoonSettings } from './manifest';
import { GOON_MIGRATIONS, GOON_TABLES, GoonStore, LIST_PAGE_MAX, type GoonErrorCode, type GoonListEntry, type GoonTopEntry } from './store';

export interface GoonStatus {
  channelExists: boolean;
  missingPermissions: string[];
  panel: { channelId: string; channelName: string; url: string } | null;
  lastError: { code: GoonErrorCode; at: number } | null;
  total: number;
  top: GoonTopEntry[];
}

export interface GoonResponse {
  settings: GoonSettings;
  status: GoonStatus;
  /** Set by PUT when the settings were saved but the panel could not be updated. */
  panelError?: GoonErrorCode;
}

/** The full list page (member route). */
export interface GoonListResponse {
  total: number;
  /** Members with at least one goon. */
  members: number;
  /** Members matching the search (equal to members without a search). */
  matches: number;
  entries: GoonListEntry[];
  me: { rank: number; count: number } | null;
}

const BASE_PERMISSIONS: BotPermission[] = ['ViewChannel', 'SendMessages', 'EmbedLinks'];

/** The panel is redrawn at most this often, so many presses do not hit Discord's edit limit. */
const PANEL_REFRESH_MS = 15_000;

const listQuerySchema = z.object({
  q: z.string().max(100).optional(),
  offset: z.coerce.number().int().min(0).max(1_000_000).optional(),
  limit: z.coerce.number().int().min(1).max(LIST_PAGE_MAX).optional(),
});

export default defineServerFeature({
  manifest: goonManifest,
  permissions: BASE_PERMISSIONS,
  tables: GOON_TABLES,
  migrations: GOON_MIGRATIONS,

  setup(ctx: AppContext) {
    const { db, logger, queue, guildSettings, client, config } = ctx;
    const store = new GoonStore(db);
    const lastRefresh = new Map<string, number>();
    const timers = new Map<string, ReturnType<typeof setTimeout>>();

    const texts = (locale: Locale) => goonManifest.messages[locale];
    const listUrl = (guildId: string) => `${config.publicUrl.replace(/\/+$/, '')}${listPath(guildId)}`;

    function panelPayload(guild: Guild, settings: GoonSettings) {
      return buildGoonPanel(settings, {
        locale: guildSettings.locale(guild.id),
        server: { name: guild.name },
        entries: store.top(guild.id, LEADERBOARD_SIZE),
        total: store.total(guild.id),
        listUrl: listUrl(guild.id),
        updatedAt: new Date(),
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

    const time = (ms: number) => `<t:${Math.ceil(ms / 1000)}:R>`;

    async function onButton(interaction: ButtonInteraction<'cached'>, action: 'add' | 'undo') {
      const { guild, member } = interaction;
      const t = texts(guildSettings.locale(guild.id)).replies;
      const settings = store.get(guild.id);
      const reply = (content: string) => interaction.reply({ content, flags: MessageFlags.Ephemeral });
      if (!settings.enabled) return reply(`${emoji.info} ${t.disabled}`);

      const now = Date.now();
      if (action === 'add') {
        const result = store.press(guild.id, member.id, {
          now,
          cooldownMs: settings.cooldownMinutes * 60_000,
          displayName: member.displayName,
          avatarUrl: member.displayAvatarURL({ size: 64 }),
        });
        if (!result.ok) return reply(`${emoji.warning} ${renderPlaceholders(t.cooldown, { time: time(result.nextAt) })}`);
        schedulePanel(guild.id);
        return reply(`${emoji.goon} ${renderPlaceholders(t.counted, { count: result.count, time: time(now + settings.undoMinutes * 60_000) })}`);
      }

      const count = store.undo(guild.id, member.id, { now, windowMs: settings.undoMinutes * 60_000 });
      if (count === null) return reply(`${emoji.info} ${renderPlaceholders(t.nothingToUndo, { minutes: settings.undoMinutes })}`);
      schedulePanel(guild.id);
      return reply(`${emoji.success} ${renderPlaceholders(t.undone, { count })}`);
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

      memberRoutes(router) {
        /** The full list for the member page, with search and paging. */
        router.get('/', (c) => {
          const guild = c.get('guild');
          const query = parseInput(listQuerySchema, c.req.query(), 'List query');
          const list = store.list(guild.id, query);
          const members = query.q?.trim() ? store.list(guild.id, { limit: 1 }).matches : list.matches;
          const body: GoonListResponse = {
            total: store.total(guild.id),
            members,
            matches: list.matches,
            entries: list.entries,
            me: store.rankOf(guild.id, c.get('session').userId),
          };
          return c.json(body);
        });
      },
    };
  },
});
