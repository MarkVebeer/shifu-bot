import { ChannelType, EmbedBuilder, type Client } from 'discord.js';

type ForumLikeChannel = {
  id: string;
  type: ChannelType.GuildForum | ChannelType.GuildMedia;
  threads: {
    create: (options: {
      name: string;
      message: {
        content?: string;
        embeds?: EmbedBuilder[];
      };
    }) => Promise<unknown>;
  };
};

export function isForumLikeChannel(channel: { type?: ChannelType } | null | undefined): channel is ForumLikeChannel {
  if (!channel) {
    return false;
  }

  return channel.type === ChannelType.GuildForum || channel.type === ChannelType.GuildMedia;
}

export async function createGtaNewsForumPost({
  client,
  forumChannelId,
  title,
  summary,
  authorName,
  authorId
}: {
  client: Client;
  forumChannelId: string;
  title: string;
  summary: string;
  authorName?: string;
  authorId?: string;
}) {
  const channel = await client.channels.fetch(forumChannelId);

  if (!isForumLikeChannel(channel)) {
    throw new Error('Selected channel is not a forum channel');
  }

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setDescription(summary)
    .setColor(0x4f6fff)
    .setTimestamp();

  if (authorName || authorId) {
    embed.addFields([
      {
        name: 'Posted by',
        value: authorId ? `<@${authorId}>` : authorName ?? 'Unknown',
        inline: true
      }
    ]);
  }

  return channel.threads.create({
    name: title,
    message: {
      content: summary,
      embeds: [embed]
    }
  });
}