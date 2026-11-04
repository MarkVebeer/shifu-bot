import { Client, GatewayIntentBits, Options, Partials } from 'discord.js';

/**
 * A discord.js client tuned for low memory on hundreds of servers.
 * Only guilds, channels and roles are cached: they are needed to compute the
 * bot's permissions. Members and users are not cached except the bot itself,
 * and full member lists are never fetched. The GuildMember partial lets
 * guildMemberRemove fire for members that are not in the cache (all of them).
 *
 * Sharding later: wrap this file's entry point with a ShardingManager. Nothing
 * here assumes one process sees every guild.
 */
export function createDiscordClient(): Client {
  return new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
    partials: [Partials.GuildMember],
    makeCache: Options.cacheWithLimits({
      ...Options.DefaultMakeCacheSettings,
      MessageManager: 0,
      GuildMessageManager: 0,
      DMMessageManager: 0,
      ReactionManager: 0,
      ReactionUserManager: 0,
      PresenceManager: 0,
      VoiceStateManager: 0,
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
        keepOverLimit: (member) => member.id === member.client.user.id,
      },
      UserManager: {
        maxSize: 0,
        keepOverLimit: (user) => user.id === user.client.user.id,
      },
    }),
    sweepers: {
      ...Options.DefaultSweeperSettings,
      users: { interval: 3_600, filter: () => (user) => user.id !== user.client.user.id },
      guildMembers: { interval: 3_600, filter: () => (member) => member.id !== member.client.user.id },
    },
    rest: { timeout: 15_000, retries: 3 },
    failIfNotExists: false,
  });
}
