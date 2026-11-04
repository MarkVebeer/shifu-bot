import { Client, GatewayIntentBits, Options, Partials } from 'discord.js';

/**
 * A discord.js client tuned for low memory on hundreds of servers.
 * Only guilds, channels, roles and voice states are cached: the first three to
 * compute the bot's permissions, voice states (only members currently in a
 * voice channel) for leveling voice XP. Message content is never read, so the
 * privileged Message Content intent is not needed. Members and users are not cached except the bot itself,
 * and full member lists are never fetched. The GuildMember partial lets
 * guildMemberRemove fire for members that are not in the cache (all of them).
 *
 * Sharding later: wrap this file's entry point with a ShardingManager. Nothing
 * here assumes one process sees every guild.
 */
export function createDiscordClient(): Client {
  return new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildVoiceStates,
    ],
    partials: [Partials.GuildMember],
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
