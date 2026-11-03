import {
  ChannelType,
  PermissionFlagsBits,
  type Guild,
  type GuildBasedChannel,
  type GuildTextBasedChannel,
  type NewsChannel,
  type TextChannel,
} from 'discord.js';

/** Permissions ShifuBot needs to post an embed in a channel. */
export const SEND_EMBED_PERMISSIONS = {
  ViewChannel: PermissionFlagsBits.ViewChannel,
  SendMessages: PermissionFlagsBits.SendMessages,
  EmbedLinks: PermissionFlagsBits.EmbedLinks,
} as const;

/** Permissions requested in the invite link. */
export const INVITE_PERMISSIONS =
  PermissionFlagsBits.ViewChannel | PermissionFlagsBits.SendMessages | PermissionFlagsBits.EmbedLinks;

export function isPostableChannel(channel: GuildBasedChannel | undefined | null): channel is TextChannel | NewsChannel {
  return channel?.type === ChannelType.GuildText || channel?.type === ChannelType.GuildAnnouncement;
}

/** Names of the permissions the bot is missing in a channel. Empty means it can post. */
export function missingSendPermissions(guild: Guild, channel: GuildTextBasedChannel): string[] {
  const me = guild.members.me;
  if (!me) return Object.keys(SEND_EMBED_PERMISSIONS);
  const permissions = channel.permissionsFor(me);
  return Object.entries(SEND_EMBED_PERMISSIONS)
    .filter(([, flag]) => !permissions.has(flag))
    .map(([name]) => name);
}
