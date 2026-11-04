import { Client, GatewayIntentBits, Options, Partials } from 'discord.js';

export interface DiscordClientOptions {
  /** Privileged Message Content intent, for message text in the audit log. Must be on in the Developer Portal. */
  messageContent?: boolean;
  /** Privileged Presence intent, for status and activity changes in the audit log. Must be on in the Developer Portal. */
  presences?: boolean;
}

/**
 * A discord.js client tuned for low memory on hundreds of servers.
 * Only guilds, channels, roles and voice states are cached: the first three to
 * compute the bot's permissions, voice states (only members currently in a
 * voice channel) for leveling voice XP. Members and users are not cached except
 * the bot itself, and full member lists are never fetched.
 *
 * The extra intents and partials feed the audit log: events about messages,
 * reactions, threads and members arrive even though none of them are cached.
 * Message Content and Presences are privileged, so they are only requested when
 * the operator turned them on (DISCORD_MESSAGE_CONTENT, DISCORD_PRESENCES).
 *
 * Sharding later: wrap this file's entry point with a ShardingManager. Nothing
 * here assumes one process sees every guild.
 */
export function createDiscordClient(options: DiscordClientOptions = {}): Client {
  return new Client({
    intents: discordIntents(options),
    partials: [
      Partials.GuildMember,
      Partials.Message,
      Partials.Channel,
      Partials.Reaction,
      Partials.User,
      Partials.ThreadMember,
      Partials.GuildScheduledEvent,
      Partials.Poll,
      Partials.PollAnswer,
    ],
    makeCache: Options.cacheWithLimits({
      ...Options.DefaultMakeCacheSettings,
      MessageManager: 0,
      GuildMessageManager: 0,
      DMMessageManager: 0,
      ReactionManager: 0,
      ReactionUserManager: 0,
      PresenceManager: 0,
      GuildEmojiManager: 0,
      BaseGuildEmojiManager: 0,
      GuildStickerManager: 0,
      GuildScheduledEventManager: 0,
      GuildInviteManager: 0,
      GuildBanManager: 0,
      StageInstanceManager: 0,
      ApplicationCommandManager: 0,
      AutoModerationRuleManager: 0,
      ThreadManager: 0,
      ThreadMemberManager: 0,
      GuildForumThreadManager: 0,
      GuildTextThreadManager: 0,
      GuildMemberManager: {
        maxSize: 0,
        // The bot itself, and members in a voice channel (for leveling voice XP: bot flag and name).
        keepOverLimit: (member) => member.id === member.client.user.id || Boolean(member.guild.voiceStates.cache.get(member.id)?.channelId),
      },
      UserManager: {
        maxSize: 0,
        keepOverLimit: (user) => user.id === user.client.user.id,
      },
    }),
    sweepers: {
      ...Options.DefaultSweeperSettings,
      users: { interval: 3_600, filter: () => (user) => user.id !== user.client.user.id },
      guildMembers: {
        interval: 3_600,
        filter: () => (member) => member.id !== member.client.user.id && !member.guild.voiceStates.cache.get(member.id)?.channelId,
      },
    },
    rest: { timeout: 15_000, retries: 3 },
    failIfNotExists: false,
  });
}

export function discordIntents(options: DiscordClientOptions = {}): GatewayIntentBits[] {
  return [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
    // Audit log: moderation (bans and the audit log stream), expressions, integrations, webhooks,
    // invites, reactions, typing, polls, scheduled events and AutoMod.
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildExpressions,
    GatewayIntentBits.GuildIntegrations,
    GatewayIntentBits.GuildWebhooks,
    GatewayIntentBits.GuildInvites,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildMessageTyping,
    GatewayIntentBits.GuildMessagePolls,
    GatewayIntentBits.GuildScheduledEvents,
    GatewayIntentBits.AutoModerationConfiguration,
    GatewayIntentBits.AutoModerationExecution,
    ...(options.messageContent ? [GatewayIntentBits.MessageContent] : []),
    ...(options.presences ? [GatewayIntentBits.GuildPresences] : []),
  ];
}
