import {
  ChannelType,
  PermissionFlagsBits,
  type Guild,
  type GuildBasedChannel,
  type GuildTextBasedChannel,
  type NewsChannel,
  type Role,
  type TextChannel,
} from 'discord.js';

/** Permissions ShifuBot needs to post an embed in a channel. */
export const SEND_EMBED_PERMISSIONS = {
  ViewChannel: PermissionFlagsBits.ViewChannel,
  SendMessages: PermissionFlagsBits.SendMessages,
  EmbedLinks: PermissionFlagsBits.EmbedLinks,
} as const;

/** Permissions requested in the invite link. Manage Roles is for the verification feature. */
export const INVITE_PERMISSIONS =
  PermissionFlagsBits.ViewChannel |
  PermissionFlagsBits.SendMessages |
  PermissionFlagsBits.EmbedLinks |
  PermissionFlagsBits.ManageRoles;

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

export type RoleProblem = 'role_missing' | 'role_managed' | 'no_manage_roles' | 'role_too_high';

/** Why ShifuBot cannot give a role to members, or null when it can. */
export function roleProblem(guild: Guild, role: Role | undefined | null): RoleProblem | null {
  if (!role || role.id === guild.id) return 'role_missing';
  if (role.managed) return 'role_managed';
  const me = guild.members.me;
  if (!me?.permissions.has(PermissionFlagsBits.ManageRoles)) return 'no_manage_roles';
  if (me.roles.highest.comparePositionTo(role) <= 0) return 'role_too_high';
  return null;
}
