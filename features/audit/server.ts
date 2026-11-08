/**
 * Audit log feature: bot side. Listens to Discord's audit log stream and to the gateway events the
 * audit log does not cover, filters them by the server's settings, and writes them in batches.
 * The API serves them to the dashboard with filters, paging and export.
 */
import type { BotPermission } from '@shifubot/shared';
import {
  ChannelType,
  Events,
  PermissionFlagsBits,
  type Guild,
  type GuildBasedChannel,
  type GuildMember,
  type Message,
  type PartialGuildMember,
  type PartialMessage,
  type PartialUser,
  type User,
} from 'discord.js';
import type { AuditRecord } from '../../apps/bot/src/core/audit-sink';
import { defineServerFeature, type AppContext } from '../../apps/bot/src/core/feature';
import { LruCache } from '../../apps/bot/src/core/lru-cache';
import { WindowLimiter } from '../../apps/bot/src/core/send-queue';
import { ApiError, parseInput, parseJsonBody } from '../../apps/bot/src/http/errors';
import { auditEntryRecord, csvCell, daysBetween, memberChangeRecords, NEW_ACCOUNT_DAYS, voiceRecords, type AuditEntryLike, type VoiceLike } from './collect';
import {
  auditFilterSchema,
  auditManifest,
  auditSettingsSchema,
  isTypeEnabled,
  MAX_EXPORT,
  type AuditCapabilities,
  type AuditEvent,
  type AuditEventsResponse,
  type AuditFilter,
  type AuditResponse,
} from './manifest';
import { AUDIT_TABLES, auditMigrations, AuditStore, AuditWriter, displayName, usedInvite, type InviteRow, type UserSnapshot } from './store';

interface RecentMessage {
  authorId: string;
  content: string | null;
  attachments: ReturnType<typeof attachmentsOf> | null;
  createdAt: number;
}

const MAX_ATTACHMENTS = 10;
const MAX_CONTENT = 4_000;

function memberSnapshot(member: GuildMember): UserSnapshot {
  return {
    id: member.id,
    username: member.user.username,
    globalName: member.user.globalName,
    nick: member.nickname,
    avatar: member.user.avatar,
    guildAvatar: member.avatar,
    avatarUrl: member.displayAvatarURL({ size: 64, extension: 'png' }),
    bot: member.user.bot,
    joinedAt: member.joinedTimestamp,
    pending: member.pending,
    premiumSince: member.premiumSinceTimestamp,
    full: true,
  };
}

function userSnapshot(user: User): UserSnapshot {
  return {
    id: user.id,
    username: user.username,
    globalName: user.globalName,
    nick: null,
    avatar: user.avatar,
    guildAvatar: null,
    avatarUrl: user.displayAvatarURL({ size: 64, extension: 'png' }),
    bot: user.bot,
    joinedAt: null,
    pending: null,
    premiumSince: null,
    full: false,
  };
}

interface Place {
  /** The channel used for the visibility filter: the channel itself, or a thread's parent. */
  channelId: string;
  threadId?: string;
  threadName?: string;
  /** Channel, parent and category, for the ignore list. */
  chain: (string | null | undefined)[];
}

/** Where something happened. Threads are not cached, so their parent comes from the event's channel object. */
function placeOf(guild: Guild, channelId: string, channel?: unknown): Place {
  const cached = guild.channels.cache.get(channelId);
  if (cached && !cached.isThread()) return { channelId, chain: [channelId, cached.parentId] };
  const thread = (channel ?? cached) as { isThread?: () => boolean; parentId?: string | null; name?: string | null } | undefined;
  if (thread?.isThread?.() && thread.parentId) {
    return {
      channelId: thread.parentId,
      threadId: channelId,
      threadName: thread.name ?? undefined,
      chain: [channelId, thread.parentId, guild.channels.cache.get(thread.parentId)?.parentId],
    };
  }
  return { channelId, chain: [channelId] };
}

function attachmentsOf(message: Message | PartialMessage) {
  return [...message.attachments.values()].slice(0, MAX_ATTACHMENTS).map((file) => ({
    name: file.name,
    url: file.url,
    size: file.size,
    contentType: file.contentType ?? null,
  }));
}

function channelKind(channel: GuildBasedChannel | undefined): AuditEventsResponse['channels'][string]['kind'] {
  if (!channel) return 'other';
  if (channel.isThread()) return 'thread';
  if (channel.type === ChannelType.GuildCategory) return 'category';
  if (channel.isVoiceBased()) return 'voice';
  if (channel.isTextBased()) return 'text';
  return 'other';
}

export default defineServerFeature({
  manifest: auditManifest,
  // Everything it needs depends on the settings, see requiredPermissions.
  permissions: [],
  tables: AUDIT_TABLES,
  migrations: auditMigrations,

  setup(ctx: AppContext) {
    const { db, logger, client, config } = ctx;
    const store = new AuditStore(db);
    const writer = new AuditWriter(store, config.audit.maxEventsPerMinute, (error) => logger.error('Could not write audit events', { error }));
    /**
     * Recent messages of servers that log edits or deletes, kept only in memory (never written to
     * the log), so an edit or delete can show the earlier text. Lost on restart.
     */
    const recentMessages = new LruCache<string, RecentMessage>(50_000, 24 * 3_600_000);
    /** Invite lookups run one at a time per server, so two quick joins compare the right snapshots. */
    const inviteChains = new Map<string, Promise<unknown>>();

    const wants = (guildId: string, type: string) => isTypeEnabled(store.get(guildId), type);

    /**
     * Queue a record if the server records this type. `activity` marks member activity (messages,
     * reactions, voice) that the ignore list and the bot filter apply to.
     */
    function emit(guildId: string, record: AuditRecord, options: { activity?: { bot?: boolean; chain?: Place['chain'] }; searchText?: string } = {}) {
      const settings = store.get(guildId);
      if (!isTypeEnabled(settings, record.type)) return;
      if (options.activity) {
        if (options.activity.bot && settings.ignoreBots) return;
        const chain = options.activity.chain ?? [];
        if (chain.some((id) => id && settings.ignoredChannelIds.includes(id))) return;
      }
      writer.push({ ...record, guildId, searchText: options.searchText });
    }

    ctx.audit.attach((guildId, record) => emit(guildId, record));

    const nameOf = (guildId: string, userId: string | null | undefined) => {
      if (!userId) return '';
      const user = store.user(guildId, userId);
      return user ? `${displayName(user)} ${user.username}` : '';
    };

    function remember(guildId: string, user: User | PartialUser | null | undefined) {
      if (user && !user.partial) store.rememberUser(guildId, userSnapshot(user));
    }

    // ── Invites ───────────────────────────────────────────────────────────

    async function fetchInvites(guild: Guild): Promise<InviteRow[] | null> {
      if (!guild.members.me?.permissions.has(PermissionFlagsBits.ManageGuild)) return null;
      const invites = await guild.invites.fetch({ cache: false });
      const rows: InviteRow[] = invites.map((invite) => ({
        code: invite.code,
        uses: invite.uses ?? 0,
        inviterId: invite.inviterId,
        maxUses: invite.maxUses,
      }));
      if (guild.vanityURLCode) {
        const vanity = await guild.fetchVanityData().catch(() => null);
        if (vanity?.code) rows.push({ code: vanity.code, uses: vanity.uses, inviterId: null, maxUses: null });
      }
      return rows;
    }

    function inviteTask<T>(guildId: string, task: () => Promise<T>): Promise<T> {
      const previous = inviteChains.get(guildId) ?? Promise.resolve();
      const next = previous.catch(() => undefined).then(task);
      inviteChains.set(guildId, next);
      void next.finally(() => {
        if (inviteChains.get(guildId) === next) inviteChains.delete(guildId);
      });
      return next;
    }

    function refreshInvites(guild: Guild) {
      return inviteTask(guild.id, async () => {
        const rows = await fetchInvites(guild).catch((error) => {
          logger.warn('Could not load invites', { guildId: guild.id, error });
          return null;
        });
        if (rows) store.replaceInvites(guild.id, rows);
      });
    }

    /** Which invite a new member used, by comparing use counts before and after. */
    function findUsedInvite(guild: Guild): Promise<InviteRow | null> {
      return inviteTask(guild.id, async () => {
        const before = store.invites(guild.id);
        const after = await fetchInvites(guild).catch(() => null);
        if (!after) return null;
        store.replaceInvites(guild.id, after);
        return usedInvite(before, after);
      });
    }

    // ── Timers ────────────────────────────────────────────────────────────

    function prune() {
      const now = Date.now();
      for (const { guildId, days } of store.retentions()) {
        try {
          const old = store.pruneOlderThan(guildId, now - days * 86_400_000);
          const over = store.capRows(guildId, config.audit.maxRowsPerGuild);
          if (old || over) logger.info('Audit log pruned', { guildId, old, over });
        } catch (error) {
          logger.error('Audit log prune failed', { guildId, error });
        }
      }
    }

    const timers = [setInterval(() => writer.flush(), 1_000), setInterval(prune, 3_600_000), setTimeout(prune, 60_000)];
    for (const timer of timers) timer.unref();
    process.once('beforeExit', () => writer.flush());

    client.once(Events.ClientReady, () => {
      // Invite snapshots for servers that track invites, spread out to stay far from rate limits.
      const guilds = store
        .enabledGuildIds()
        .filter((guildId) => store.get(guildId).trackInvites)
        .map((guildId) => client.guilds.cache.get(guildId))
        .filter((guild): guild is Guild => Boolean(guild));
      guilds.forEach((guild, index) => setTimeout(() => void refreshInvites(guild), index * 2_000).unref());
    });

    // ── API helpers ───────────────────────────────────────────────────────

    function capabilities(guild: Guild): AuditCapabilities {
      const me = guild.members.me;
      return {
        messageContent: config.discord.messageContent,
        viewAuditLog: Boolean(me?.permissions.has(PermissionFlagsBits.ViewAuditLog)),
        manageGuild: Boolean(me?.permissions.has(PermissionFlagsBits.ManageGuild)),
      };
    }

    const response = (guild: Guild): AuditResponse => ({
      settings: store.get(guild.id),
      capabilities: capabilities(guild),
      stats: store.stats(guild.id),
    });

    /** Channels the viewer can see, or null for administrators and the owner (no limit). */
    function visibleChannels(guild: Guild, member: GuildMember): string[] | null {
      if (guild.ownerId === member.id || member.permissions.has(PermissionFlagsBits.Administrator)) return null;
      return guild.channels.cache.filter((channel) => Boolean(channel.permissionsFor(member)?.has(PermissionFlagsBits.ViewChannel))).map((channel) => channel.id);
    }

    function eventsResponse(guild: Guild, events: AuditEvent[], nextBefore: number | null): AuditEventsResponse {
      const userIds = new Set<string>();
      const channelIds = new Set<string>();
      const roleIds = new Set<string>();
      for (const event of events) {
        if (event.actorId) userIds.add(event.actorId);
        if (event.targetId && event.targetKind === 'user') userIds.add(event.targetId);
        if (event.targetId && event.targetKind === 'channel') channelIds.add(event.targetId);
        if (event.targetId && event.targetKind === 'role') roleIds.add(event.targetId);
        if (event.channelId) channelIds.add(event.channelId);
        for (const key of ['inviterId', 'authorId']) if (typeof event.data[key] === 'string') userIds.add(event.data[key] as string);
        for (const key of ['fromChannelId', 'toChannelId']) if (typeof event.data[key] === 'string') channelIds.add(event.data[key] as string);
      }
      const users = store.usersByIds(guild.id, [...userIds]);
      for (const id of userIds) {
        if (users[id]) continue;
        const user = client.users.cache.get(id);
        if (user) users[id] = { id, name: user.displayName, username: user.username, avatarUrl: user.displayAvatarURL({ size: 64, extension: 'png' }) };
      }
      const channels: AuditEventsResponse['channels'] = {};
      for (const id of channelIds) {
        const channel = guild.channels.cache.get(id);
        if (channel) channels[id] = { name: channel.name, kind: channelKind(channel) };
      }
      const roles: AuditEventsResponse['roles'] = {};
      for (const id of roleIds) {
        const role = guild.roles.cache.get(id);
        if (role) roles[id] = { name: role.name, color: role.color ? role.hexColor : null };
      }
      return { events, users, channels, roles, nextBefore };
    }

    return {
      isEnabled: (guildId) => store.get(guildId).enabled,

      requiredPermissions: (guildId): BotPermission[] => {
        const settings = store.get(guildId);
        return settings.enabled ? ['ViewAuditLog', ...(settings.trackInvites ? (['ManageGuild'] as const) : [])] : [];
      },

      events: {
        // Discord's own audit log: every moderator and admin action, with who did it and why.
        [Events.GuildAuditLogEntryCreate]: (entry, guild) => {
          const record = auditEntryRecord(entry as unknown as AuditEntryLike);
          if (!wants(guild.id, record.type)) return;
          if (entry.executor && !entry.executor.partial) remember(guild.id, entry.executor);
          if (entry.target && typeof entry.target === 'object' && 'username' in entry.target) remember(guild.id, entry.target as User);
          emit(guild.id, record, { searchText: `${nameOf(guild.id, record.actorId)} ${nameOf(guild.id, record.targetId)}` });
        },

        // ── Members ──
        [Events.GuildMemberAdd]: async (member: GuildMember) => {
          const guild = member.guild;
          const settings = store.get(guild.id);
          if (!settings.enabled) return;
          store.upsertUser(guild.id, memberSnapshot(member));
          const invite = settings.trackInvites ? await findUsedInvite(guild).catch(() => null) : null;
          const ageDays = daysBetween(member.user.createdTimestamp, Date.now());
          const search = `${displayName(memberSnapshot(member))} ${member.user.username}`;
          emit(
            guild.id,
            {
              type: 'member.join',
              actorId: member.id,
              targetId: member.id,
              targetKind: 'user',
              data: {
                accountCreatedAt: member.user.createdTimestamp,
                accountAgeDays: ageDays,
                newAccount: ageDays < NEW_ACCOUNT_DAYS,
                memberCount: guild.memberCount,
                bot: member.user.bot,
                ...(invite ? { code: invite.code, inviterId: invite.inviterId, uses: invite.uses } : {}),
              },
            },
            { searchText: search },
          );
          if (invite) {
            emit(
              guild.id,
              { type: 'invite.used', actorId: member.id, targetId: invite.inviterId, targetKind: 'user', data: { code: invite.code, inviterId: invite.inviterId, uses: invite.uses } },
              { searchText: `${search} ${invite.code}` },
            );
          }
        },

        [Events.GuildMemberRemove]: (member: GuildMember | PartialGuildMember) => {
          const guild = member.guild;
          if (!wants(guild.id, 'member.leave')) return;
          const known = store.user(guild.id, member.id);
          const joinedAt = member.joinedTimestamp ?? known?.joinedAt ?? null;
          emit(
            guild.id,
            {
              type: 'member.leave',
              actorId: member.id,
              targetId: member.id,
              targetKind: 'user',
              data: {
                ...(joinedAt ? { joinedAt, daysOnServer: daysBetween(joinedAt, Date.now()) } : {}),
                memberCount: guild.memberCount,
                ...(!member.partial ? { roles: member.roles.cache.filter((role) => role.id !== guild.id).map((role) => ({ id: role.id, name: role.name })) } : {}),
              },
            },
            { searchText: nameOf(guild.id, member.id) },
          );
        },

        [Events.GuildMemberUpdate]: (_old, member: GuildMember) => {
          const guildId = member.guild.id;
          if (!store.get(guildId).enabled) return;
          const now = memberSnapshot(member);
          const before = store.upsertUser(guildId, now);
          for (const record of memberChangeRecords(before, now)) emit(guildId, record, { searchText: `${displayName(now)} ${now.username}` });
        },

        // ── Messages ──
        // Sent messages are not logged, only remembered for a while so edits and deletes can show
        // what the message said before.
        [Events.MessageCreate]: (message: Message) => {
          if (!message.inGuild()) return;
          const settings = store.get(message.guildId);
          if (!isTypeEnabled(settings, 'message.edited') && !isTypeEnabled(settings, 'message.deleted')) return;
          remember(message.guildId, message.author);
          recentMessages.set(message.id, {
            authorId: message.author.id,
            content: message.content ? message.content.slice(0, MAX_CONTENT) : null,
            attachments: message.attachments.size ? attachmentsOf(message) : null,
            createdAt: message.createdTimestamp,
          });
        },

        [Events.MessageUpdate]: (old, message) => {
          if (!message.guildId || !message.guild || !wants(message.guildId, 'message.edited')) return;
          // Link previews and embeds also update messages; only real edits have an edit time.
          if (!message.editedTimestamp || (old.editedTimestamp && old.editedTimestamp === message.editedTimestamp)) return;
          const stored = recentMessages.get(message.id);
          const before = (!old.partial ? old.content : null) ?? stored?.content ?? null;
          const after = message.partial ? null : message.content;
          if (before !== null && after !== null && before === after) return;
          if (stored && after !== null) recentMessages.set(message.id, { ...stored, content: after.slice(0, MAX_CONTENT) });
          const authorId = message.author?.id ?? stored?.authorId ?? null;
          const place = placeOf(message.guild, message.channelId, message.channel);
          emit(
            message.guildId,
            {
              type: 'message.edited',
              actorId: authorId,
              targetId: message.id,
              targetKind: 'message',
              channelId: place.channelId,
              data: {
                ...(before !== null ? { before: before.slice(0, MAX_CONTENT) } : {}),
                ...(after !== null ? { after: after.slice(0, MAX_CONTENT) } : {}),
                ...(place.threadId ? { threadId: place.threadId, threadName: place.threadName } : {}),
                url: message.url,
              },
            },
            { activity: { bot: Boolean(message.author?.bot || message.webhookId), chain: place.chain }, searchText: nameOf(message.guildId, authorId) },
          );
        },

        [Events.MessageDelete]: (message) => {
          if (!message.guildId || !message.guild || !wants(message.guildId, 'message.deleted')) return;
          const stored = recentMessages.get(message.id);
          recentMessages.delete(message.id);
          const authorId = message.author?.id ?? stored?.authorId ?? null;
          const content = (!message.partial ? message.content : null) || stored?.content || null;
          const place = placeOf(message.guild, message.channelId, message.channel);
          emit(
            message.guildId,
            {
              type: 'message.deleted',
              // Who deleted it is unknown here: the author, or a moderator (then Discord's audit log adds a row).
              actorId: null,
              targetId: authorId,
              targetKind: 'user',
              channelId: place.channelId,
              data: {
                messageId: message.id,
                ...(authorId ? { authorId } : {}),
                ...(content ? { content: content.slice(0, MAX_CONTENT) } : {}),
                ...(stored?.attachments ? { attachments: stored.attachments } : message.attachments?.size ? { attachments: attachmentsOf(message) } : {}),
                ...(stored ? { sentAt: stored.createdAt } : {}),
                ...(place.threadId ? { threadId: place.threadId, threadName: place.threadName } : {}),
              },
            },
            { activity: { bot: Boolean(message.author?.bot || message.webhookId), chain: place.chain }, searchText: nameOf(message.guildId, authorId) },
          );
        },

        [Events.MessageBulkDelete]: (messages, channel) => {
          const guild = channel.guild;
          if (!wants(guild.id, 'message.bulkDeleted')) return;
          const place = placeOf(guild, channel.id, channel);
          emit(
            guild.id,
            {
              type: 'message.bulkDeleted',
              channelId: place.channelId,
              data: { count: messages.size, messageIds: [...messages.keys()].slice(0, 100) },
            },
            { activity: { chain: place.chain } },
          );
        },

        // ── Reactions cleared (by a moderator or a bot; single reactions are not logged) ──
        [Events.MessageReactionRemoveAll]: (message) => {
          if (!message.guildId || !message.guild || !wants(message.guildId, 'reaction.cleared')) return;
          const place = placeOf(message.guild, message.channelId, message.channel);
          emit(message.guildId, { type: 'reaction.cleared', channelId: place.channelId, data: { messageId: message.id, url: message.url } }, { activity: { chain: place.chain } });
        },

        [Events.MessageReactionRemoveEmoji]: (reaction) => {
          const message = reaction.message;
          if (!message.guildId || !message.guild || !wants(message.guildId, 'reaction.cleared')) return;
          const place = placeOf(message.guild, message.channelId, message.channel);
          emit(
            message.guildId,
            { type: 'reaction.cleared', channelId: place.channelId, data: { emoji: reaction.emoji.toString(), messageId: message.id, url: message.url } },
            { activity: { chain: place.chain } },
          );
        },

        // ── Voice ──
        [Events.VoiceStateUpdate]: (old, state) => {
          const guild = state.guild;
          if (!store.get(guild.id).enabled) return;
          const snapshot = (voice: typeof state): VoiceLike => ({
            channelId: voice.channelId,
            streaming: voice.streaming,
            selfVideo: voice.selfVideo,
          });
          const bot = Boolean(state.member?.user.bot);
          if (state.member) store.rememberUser(guild.id, memberSnapshot(state.member));
          for (const record of voiceRecords(state.id, snapshot(old), snapshot(state))) {
            const channel = record.channelId ? guild.channels.cache.get(record.channelId) : undefined;
            emit(guild.id, record, { activity: { bot, chain: [record.channelId, channel?.parentId] }, searchText: nameOf(guild.id, state.id) });
          }
        },

        [Events.VoiceChannelEffectSend]: (effect) => {
          const guild = effect.guild;
          if (!wants(guild.id, 'voice.effect')) return;
          const channel = guild.channels.cache.get(effect.channelId);
          emit(
            guild.id,
            {
              type: 'voice.effect',
              actorId: effect.userId,
              targetId: effect.userId,
              targetKind: 'user',
              channelId: effect.channelId,
              data: {
                ...(effect.emoji ? { emoji: effect.emoji.toString() } : {}),
                ...(effect.soundId ? { soundId: String(effect.soundId) } : {}),
              },
            },
            { activity: { chain: [effect.channelId, channel?.parentId] }, searchText: nameOf(guild.id, effect.userId) },
          );
        },

        // ── Invites (snapshot for invite tracking; creating and deleting is in Discord's audit log) ──
        [Events.InviteCreate]: (invite) => {
          if (!invite.guild || !store.get(invite.guild.id).trackInvites) return;
          store.upsertInvite(invite.guild.id, { code: invite.code, uses: invite.uses ?? 0, inviterId: invite.inviterId, maxUses: invite.maxUses });
        },
        [Events.InviteDelete]: (invite) => {
          if (invite.guild) store.deleteInvite(invite.guild.id, invite.code);
        },

        // ── AutoMod ──
        [Events.AutoModerationActionExecution]: (execution) => {
          const guild = execution.guild;
          if (!wants(guild.id, 'automod.action')) return;
          emit(
            guild.id,
            {
              type: 'automod.action',
              actorId: execution.userId,
              targetId: execution.userId,
              targetKind: 'user',
              channelId: execution.channelId,
              data: {
                ruleId: execution.ruleId,
                ...(execution.autoModerationRule?.name ? { ruleName: execution.autoModerationRule.name } : {}),
                action: execution.action.type,
                ...(execution.content ? { content: execution.content.slice(0, MAX_CONTENT) } : {}),
                ...(execution.matchedKeyword ? { keyword: execution.matchedKeyword } : {}),
                ...(execution.matchedContent ? { matchedContent: execution.matchedContent } : {}),
              },
            },
            { searchText: nameOf(guild.id, execution.userId) },
          );
        },
      },

      routes(router) {
        router.get('/', (c) => c.json(response(c.get('guild'))));

        router.put('/', async (c) => {
          const guild = c.get('guild');
          const settings = await parseJsonBody(c.req.raw, auditSettingsSchema);
          const before = store.get(guild.id);
          store.save(guild.id, settings);
          logger.info('Audit log settings saved', { guildId: guild.id, userId: c.get('session').userId, enabled: settings.enabled });
          if (settings.enabled && settings.trackInvites && !(before.enabled && before.trackInvites)) void refreshInvites(guild);
          if (before.enabled && !settings.enabled) {
            // The last event before recording stops: who turned it off.
            writer.flush();
            store.insert([
              { guildId: guild.id, type: 'shifubot.settings', actorId: c.get('session').userId, targetId: 'audit', targetKind: 'feature', data: { feature: 'audit', changes: [{ key: 'enabled', old: true, new: false }] } },
            ]);
          }
          return c.json(response(guild));
        });

        router.get('/events', (c) => {
          const guild = c.get('guild');
          const filter = parseInput(auditFilterSchema, c.req.query(), 'Filters');
          const events = store.query(guild.id, { ...filter, limit: filter.limit + 1 }, visibleChannels(guild, c.get('member')));
          const more = events.length > filter.limit;
          const page = more ? events.slice(0, filter.limit) : events;
          // Asking for newer events (after=) never pages backwards.
          const nextBefore = more && filter.after === undefined ? page[page.length - 1]!.id : null;
          c.header('Cache-Control', 'no-store');
          return c.json(eventsResponse(guild, page, nextBefore));
        });

        router.get('/users', (c) => {
          const guild = c.get('guild');
          const q = (c.req.query('q') ?? '').trim().slice(0, 100);
          return c.json({ users: store.searchUsers(guild.id, q, 10) });
        });

        const exportLimiter = new WindowLimiter(5);
        router.get('/export', (c) => {
          const guild = c.get('guild');
          if (!exportLimiter.tryTake(guild.id)) throw new ApiError(429, 'rate_limited', 'You can export at most 5 times per minute');
          const format = c.req.query('format') === 'json' ? 'json' : 'csv';
          const filter: AuditFilter = parseInput(auditFilterSchema, { ...c.req.query(), limit: undefined }, 'Filters');
          const events = store.query(guild.id, { ...filter, limit: MAX_EXPORT }, visibleChannels(guild, c.get('member')));
          const names = eventsResponse(guild, events, null);
          const stamp = new Date().toISOString().slice(0, 10);
          c.header('Cache-Control', 'no-store');
          c.header('Content-Disposition', `attachment; filename="audit-log-${guild.id}-${stamp}.${format}"`);
          if (format === 'json') {
            c.header('Content-Type', 'application/json; charset=utf-8');
            return c.body(JSON.stringify(names, null, 2));
          }
          const header = ['id', 'time', 'category', 'type', 'actor_id', 'actor', 'target_id', 'target', 'channel_id', 'channel', 'details'];
          const lines = events.map((event) =>
            [
              event.id,
              new Date(event.at).toISOString(),
              event.category,
              event.type,
              event.actorId,
              event.actorId ? names.users[event.actorId]?.name : '',
              event.targetId,
              event.targetId ? (names.users[event.targetId]?.name ?? names.channels[event.targetId]?.name ?? names.roles[event.targetId]?.name ?? event.data.targetName) : '',
              event.channelId,
              event.channelId ? names.channels[event.channelId]?.name : '',
              event.data,
            ]
              .map(csvCell)
              .join(','),
          );
          c.header('Content-Type', 'text/csv; charset=utf-8');
          // BOM so Excel opens accented names correctly.
          return c.body(`﻿${[header.join(','), ...lines].join('\r\n')}`);
        });

        router.post('/purge', (c) => {
          const guild = c.get('guild');
          writer.flush();
          const deleted = store.purge(guild.id);
          const userId = c.get('session').userId;
          logger.info('Audit log purged', { guildId: guild.id, userId, deleted });
          // Always kept, even when ShifuBot events are turned off: a cleared log must say who cleared it.
          store.insert([{ guildId: guild.id, type: 'shifubot.logsPurged', actorId: userId, data: { count: deleted } }]);
          return c.json(response(guild));
        });
      },
    };
  },
});
