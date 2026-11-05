/**
 * Counters: bot side. Panel messages, +1 and Undo buttons, API routes and the
 * member routes behind the full list page.
 */
import { emoji, renderPlaceholders, type BotPermission, type Locale, type PermissionIssue } from '@shifubot/shared';
import { Events, MessageFlags, type ButtonInteraction, type Guild, type Interaction } from 'discord.js';
import type { Context } from 'hono';
import { z } from 'zod';
import { defineServerFeature, type AppContext, type GuildRouteEnv } from '../../apps/bot/src/core/feature';
import { deletePanelMessage, syncPanelMessage } from '../../apps/bot/src/core/panel';
import { isPostableChannel, missingSendPermissions } from '../../apps/bot/src/core/permissions';
import { WindowLimiter } from '../../apps/bot/src/core/send-queue';
import { ApiError, parseInput, parseJsonBody } from '../../apps/bot/src/http/errors';
import { settingsChanges } from '../../apps/bot/src/http/guild-routes';
import {
  buildCounterPanel,
  COUNTER_IDS,
  counterManifest,
  counterSettingsSchema,
  defaultCounterSettings,
  LEADERBOARD_SIZE,
  listPath,
  unitOf,
  type CounterSettings,
} from './manifest';
import { COUNTER_MIGRATIONS, COUNTER_TABLES, CounterStore, LIST_PAGE_MAX, type Counter, type CounterErrorCode, type CounterListEntry, type CounterTopEntry } from './store';

export interface CounterStatus {
  channelExists: boolean;
  missingPermissions: string[];
  panel: { channelId: string; channelName: string; url: string } | null;
  lastError: { code: CounterErrorCode; at: number } | null;
  total: number;
  top: CounterTopEntry[];
}

export interface CounterView {
  id: number;
  settings: CounterSettings;
  status: CounterStatus;
}

export interface CountersResponse {
  counters: CounterView[];
  /** The most counters a server can have (COUNTER_MAX_PER_GUILD). */
  limit: number;
}

/** PUT answer. panelError is set when the settings were saved but the panel could not be updated. */
export interface CounterResponse {
  counter: CounterView;
  panelError?: CounterErrorCode;
}

/** The full list page (member route). */
export interface CounterListResponse {
  /** Enabled counters of the server, for the tabs on the page. */
  counters: { id: number; name: string; emoji: string; unit: string }[];
  /** The counter this list belongs to. */
  counterId: number;
  total: number;
  /** Members with at least one count. */
  members: number;
  /** Members matching the search (equal to members without a search). */
  matches: number;
  entries: CounterListEntry[];
  me: { rank: number; count: number } | null;
}

const BASE_PERMISSIONS: BotPermission[] = ['ViewChannel', 'SendMessages', 'EmbedLinks'];

/** A panel is redrawn at most this often, so many presses do not hit Discord's edit limit. */
const PANEL_REFRESH_MS = 15_000;

const counterIdSchema = z.coerce.number().int().positive();

const listQuerySchema = z.object({
  counter: counterIdSchema.optional(),
  q: z.string().max(100).optional(),
  offset: z.coerce.number().int().min(0).max(1_000_000).optional(),
  limit: z.coerce.number().int().min(1).max(LIST_PAGE_MAX).optional(),
});

export default defineServerFeature({
  manifest: counterManifest,
  permissions: BASE_PERMISSIONS,
  tables: COUNTER_TABLES,
  migrations: COUNTER_MIGRATIONS,

  setup(ctx: AppContext) {
    const { db, logger, queue, guildSettings, client, config, audit } = ctx;
    const store = new CounterStore(db);
    const lastRefresh = new Map<number, number>();
    const timers = new Map<number, ReturnType<typeof setTimeout>>();

    const texts = (locale: Locale) => counterManifest.messages[locale];
    const listUrl = (guildId: string, counterId: number) => `${config.publicUrl.replace(/\/+$/, '')}${listPath(guildId, counterId)}`;

    function panelPayload(guild: Guild, counter: Counter) {
      return buildCounterPanel(counter.id, counter.settings, {
        locale: guildSettings.locale(guild.id),
        server: { name: guild.name },
        entries: store.top(counter.id, LEADERBOARD_SIZE),
        total: store.total(counter.id),
        listUrl: listUrl(guild.id, counter.id),
        updatedAt: new Date(),
      });
    }

    /** Post, update or remove the panel so it matches the settings and the current counts. */
    async function syncPanel(guild: Guild, counter: Counter, options: { forceNew?: boolean; scheduled?: boolean } = {}) {
      const result = await syncPanelMessage({
        guild,
        queue,
        queueKey: `counter:${guild.id}`,
        existing: store.panel(counter.id),
        target: counter.settings.enabled ? { channelId: counter.settings.channelId, payload: panelPayload(guild, counter) } : null,
        forceNew: options.forceNew,
        // A scheduled refresh never brings back a panel someone deleted on purpose.
        repostIfDeleted: !options.scheduled,
      });
      lastRefresh.set(counter.id, Date.now());
      if (!result.ok) {
        logger.warn('Counter panel update failed', { guildId: guild.id, counterId: counter.id, code: result.error });
        if (result.error === 'panel_deleted') {
          store.setPanel(counter.id, null);
          return { ok: false as const, error: 'send_failed' as const };
        }
        return { ok: false as const, error: result.error };
      }
      store.setPanel(counter.id, result.panel);
      return { ok: true as const, channel: result.channel };
    }

    /** Redraw the panel soon, at most once per PANEL_REFRESH_MS per counter. */
    function schedulePanel(guildId: string, counter: Counter) {
      if (!counter.settings.showLeaderboard || timers.has(counter.id)) return;
      const wait = Math.max(0, PANEL_REFRESH_MS - (Date.now() - (lastRefresh.get(counter.id) ?? 0)));
      timers.set(
        counter.id,
        setTimeout(() => {
          timers.delete(counter.id);
          const guild = client.guilds.cache.get(guildId);
          // Read it again: it may have been changed or deleted while waiting.
          const current = store.getCounter(guildId, counter.id);
          if (!guild || !current || !store.panel(counter.id)) return;
          void syncPanel(guild, current, { scheduled: true }).catch((error) =>
            logger.warn('Counter panel refresh failed', { guildId, counterId: counter.id, error }),
          );
        }, wait),
      );
    }

    const time = (ms: number) => `<t:${Math.ceil(ms / 1000)}:R>`;

    async function onButton(interaction: ButtonInteraction<'cached'>, action: 'add' | 'undo', counterId: number) {
      const { guild, member } = interaction;
      const locale = guildSettings.locale(guild.id);
      const t = texts(locale).replies;
      const reply = (content: string) => interaction.reply({ content, flags: MessageFlags.Ephemeral });
      const counter = store.getCounter(guild.id, counterId);
      if (!counter?.settings.enabled) return reply(`${emoji.info} ${t.disabled}`);
      const { settings } = counter;
      const unit = unitOf(settings, locale);

      const now = Date.now();
      if (action === 'add') {
        const result = store.press(counter.id, guild.id, member.id, {
          now,
          cooldownMs: settings.cooldownMinutes * 60_000,
          displayName: member.displayName,
          avatarUrl: member.displayAvatarURL({ size: 64 }),
        });
        if (!result.ok) return reply(`${emoji.warning} ${renderPlaceholders(t.cooldown, { time: time(result.nextAt) })}`);
        schedulePanel(guild.id, counter);
        return reply(`${settings.emoji} ${renderPlaceholders(t.counted, { count: result.count, unit, time: time(now + settings.undoMinutes * 60_000) })}`);
      }

      const count = store.undo(counter.id, member.id, { now, windowMs: settings.undoMinutes * 60_000 });
      if (count === null) return reply(`${emoji.info} ${renderPlaceholders(t.nothingToUndo, { minutes: settings.undoMinutes })}`);
      schedulePanel(guild.id, counter);
      return reply(`${emoji.success} ${renderPlaceholders(t.undone, { count, unit })}`);
    }

    function status(guild: Guild, counter: Counter): CounterStatus {
      const { settings } = counter;
      const channel = settings.channelId ? guild.channels.cache.get(settings.channelId) : undefined;
      const postable = isPostableChannel(channel) ? channel : null;
      const panel = store.panel(counter.id);
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
        lastError: store.lastError(counter.id),
        total: store.total(counter.id),
        top: store.top(counter.id, LEADERBOARD_SIZE),
      };
    }

    const view = (guild: Guild, counter: Counter): CounterView => ({ id: counter.id, settings: counter.settings, status: status(guild, counter) });

    /** The counter in the URL, or a 404 when it is not this server's. */
    function counterFromRoute(c: Context<GuildRouteEnv>): Counter {
      const parsed = counterIdSchema.safeParse(c.req.param('counterId'));
      const counter = parsed.success ? store.getCounter(c.get('guild').id, parsed.data) : null;
      if (!counter) throw new ApiError(404, 'not_found', 'This counter does not exist');
      return counter;
    }

    /** Counters live below the feature root, so the automatic settings audit in guild-routes does not see them. */
    function auditSettings(c: Context<GuildRouteEnv>, data: Record<string, unknown>) {
      audit.record(c.get('guild').id, {
        type: 'shifubot.settings',
        actorId: c.get('session').userId,
        targetId: counterManifest.id,
        targetKind: 'feature',
        data: { feature: counterManifest.id, ...data },
      });
    }

    /** The old goon counter's panels have dead buttons now: remove them once, then its tables. */
    async function removeLegacyGoon() {
      if (!store.hasLegacyGoonTables()) return;
      for (const { guildId, panel } of store.legacyGoonPanels()) {
        const guild = client.guilds.cache.get(guildId);
        if (guild) await deletePanelMessage(guild, panel);
      }
      store.dropLegacyGoonTables();
      logger.info('Removed the old goon counter');
    }

    client.once(Events.ClientReady, () => {
      void removeLegacyGoon().catch((error) => logger.warn('Removing the old goon counter failed', { error }));
    });

    return {
      isEnabled: (guildId) => store.listCounters(guildId).some((counter) => counter.settings.enabled),

      health: (guild) => {
        const issues = new Map<string, Omit<PermissionIssue, 'feature'>>();
        for (const { settings } of store.listCounters(guild.id)) {
          if (!settings.enabled || !settings.channelId) continue;
          const channel = guild.channels.cache.get(settings.channelId);
          if (!isPostableChannel(channel)) {
            issues.set('channel_missing', { code: 'channel_missing' });
            continue;
          }
          const missing = missingSendPermissions(guild, channel) as BotPermission[];
          // Counters sharing a channel are one problem, not several.
          if (missing.length) issues.set(channel.id, { code: 'missing_permissions', channel: { id: channel.id, name: channel.name }, permissions: missing });
        }
        return [...issues.values()];
      },

      events: {
        [Events.InteractionCreate]: async (interaction: Interaction) => {
          if (!interaction.inCachedGuild() || !interaction.isButton()) return;
          const parsed = COUNTER_IDS.parse(interaction.customId);
          if (parsed) await onButton(interaction, parsed.action, parsed.counterId);
        },
      },

      routes(router) {
        router.get('/', (c) => {
          const guild = c.get('guild');
          const body: CountersResponse = {
            counters: store.listCounters(guild.id).map((counter) => view(guild, counter)),
            limit: config.counter.maxPerGuild,
          };
          return c.json(body);
        });

        router.post('/', (c) => {
          const guild = c.get('guild');
          if (store.count(guild.id) >= config.counter.maxPerGuild) {
            throw new ApiError(409, 'limit_reached', `A server can have at most ${config.counter.maxPerGuild} counters`);
          }
          const name = texts(guildSettings.locale(guild.id)).defaults.name;
          const counter = store.create(guild.id, { ...defaultCounterSettings, name });
          logger.info('Counter created', { guildId: guild.id, counterId: counter.id, userId: c.get('session').userId });
          auditSettings(c, { after: { name } });
          const body: CounterResponse = { counter: view(guild, counter) };
          return c.json(body, 201);
        });

        router.put('/:counterId', async (c) => {
          const guild = c.get('guild');
          const before = counterFromRoute(c);
          const settings = await parseJsonBody(c.req.raw, counterSettingsSchema);
          store.save(before.id, settings);
          logger.info('Counter settings saved', { guildId: guild.id, counterId: before.id, userId: c.get('session').userId });
          const changes = settingsChanges(before.settings, settings);
          if (changes.length) auditSettings(c, { counter: settings.name, changes });
          const counter = { id: before.id, settings };
          const result = await syncPanel(guild, counter);
          if (!result.ok) store.setError(counter.id, result.error);
          const body: CounterResponse = { counter: view(guild, counter), ...(result.ok ? {} : { panelError: result.error }) };
          return c.json(body);
        });

        router.delete('/:counterId', async (c) => {
          const guild = c.get('guild');
          const counter = counterFromRoute(c);
          const panel = store.panel(counter.id);
          if (panel) await deletePanelMessage(guild, panel);
          clearTimeout(timers.get(counter.id));
          timers.delete(counter.id);
          lastRefresh.delete(counter.id);
          store.delete(guild.id, counter.id);
          logger.info('Counter deleted', { guildId: guild.id, counterId: counter.id, userId: c.get('session').userId });
          auditSettings(c, { counter: counter.settings.name, changes: [{ key: 'deleted', old: false, new: true }] });
          return c.json({ ok: true });
        });

        const repostLimiter = new WindowLimiter(5);
        /** Post a fresh panel, e.g. after someone deleted it. Uses the saved settings. */
        router.post('/:counterId/panel', async (c) => {
          const guild = c.get('guild');
          const counter = counterFromRoute(c);
          if (!repostLimiter.tryTake(String(counter.id))) {
            throw new ApiError(429, 'rate_limited', 'You can post the panel at most 5 times per minute');
          }
          const result = await syncPanel(guild, counter, { forceNew: true });
          if (!result.ok) {
            store.setError(counter.id, result.error);
            throw new ApiError(409, result.error, `Cannot post the panel: ${result.error.replaceAll('_', ' ')}`);
          }
          store.setError(counter.id, null);
          return c.json({ counter: view(guild, counter), channel: result.channel && { id: result.channel.id, name: result.channel.name } });
        });
      },

      memberRoutes(router) {
        /** The full list for the member page, with search and paging. */
        router.get('/', (c) => {
          const guild = c.get('guild');
          const query = parseInput(listQuerySchema, c.req.query(), 'List query');
          const enabled = store.listCounters(guild.id).filter((counter) => counter.settings.enabled);
          const counter = enabled.find((item) => item.id === query.counter) ?? enabled[0];
          // The member route guard already checked that at least one counter is on.
          if (!counter) throw new ApiError(404, 'not_found', 'This page does not exist');
          const locale = guildSettings.locale(guild.id);
          const list = store.list(counter.id, query);
          const members = query.q?.trim() ? store.list(counter.id, { limit: 1 }).matches : list.matches;
          const body: CounterListResponse = {
            counters: enabled.map(({ id, settings }) => ({ id, name: settings.name, emoji: settings.emoji, unit: unitOf(settings, locale) })),
            counterId: counter.id,
            total: store.total(counter.id),
            members,
            matches: list.matches,
            entries: list.entries,
            me: store.rankOf(counter.id, c.get('session').userId),
          };
          return c.json(body);
        });
      },
    };
  },
});
