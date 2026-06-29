import type { Express } from 'express';
import type { SqliteDatabase } from '../../../lib/database/types.js';
import type { Client } from 'discord.js';
import { getGtaNewsSettings, setGtaNewsSettings } from '../db/schema.js';
import { createGtaNewsForumPost, isForumLikeChannel } from '../bot/forum.js';

export function registerGtaNewsRoutes(app: Express, database: SqliteDatabase, client: Client) {
  app.get('/api/features/gta-news/:guildId', (request, response) => {
    const guildId = request.params.guildId;
    const settings = getGtaNewsSettings(database, guildId);

    client.guilds
      .fetch(guildId)
      .then((guild) => {
        response.json({
          guildId,
          guildName: guild.name,
          settings: settings ?? null
        });
      })
      .catch((error) => {
        console.warn('Failed to fetch guild metadata for guild', guildId, error);
        response.json({
          guildId,
          guildName: null,
          settings: settings ?? null
        });
      });
  });

  app.get('/api/features/gta-news/:guildId/channels', async (request, response) => {
    const guildId = request.params.guildId;

    try {
      const guild = await client.guilds.fetch(guildId);
      const channels = await guild.channels.fetch();

      const items = Array.from(channels.values())
        .filter((channel): channel is NonNullable<typeof channel> => channel !== null)
        .filter((channel): channel is NonNullable<typeof channel> => isForumLikeChannel(channel))
        .map((channel) => ({ id: channel.id, name: channel.name, type: channel.type }));

      response.json({ guildId, channels: items });
    } catch (error) {
      console.warn('Failed to fetch channels for guild', guildId, error);
      response.status(500).json({ error: 'failed to fetch channels' });
    }
  });

  app.post('/api/features/gta-news/:guildId', async (request, response) => {
    const guildId = request.params.guildId;
    const { channelId, setterId, setterName } = request.body as { channelId?: string; setterId?: string; setterName?: string };

    if (!channelId) {
      response.status(400).json({ error: 'channelId is required' });
      return;
    }

    try {
      console.log('gta-news: save request', { guildId, channelId, setterId, setterName });

      const channel = await client.channels.fetch(channelId);

      if (!isForumLikeChannel(channel)) {
        response.status(400).json({ error: 'channel must be a forum channel' });
        return;
      }

      setGtaNewsSettings(database, guildId, channelId, true);

      const bodySetterId = (request.body && (request.body as any).setterId) as string | undefined;
      const bodySetterName = (request.body && (request.body as any).setterName) as string | undefined;

      let setBy = 'Unknown';
      if (bodySetterId) {
        setBy = `<@${bodySetterId}>`;
      } else {
        const requester = (request as any).user as { id?: string; username?: string; displayName?: string } | undefined;
        setBy = requester?.id ? `<@${requester.id}>` : requester?.displayName ?? requester?.username ?? 'Unknown';
      }

      try {
        await createGtaNewsForumPost({
          client,
          forumChannelId: channelId,
          title: 'GTA News configured',
          summary: 'This forum will receive GTA Online weekly updates. A new post will be created for each update.',
          authorId: bodySetterId ?? request.user?.id,
          authorName: bodySetterName ?? request.user?.username ?? undefined
        });
      } catch (error) {
        console.warn('Failed to create configuration forum post', channelId, error);
      }

      response.json({ guildId, channelId });
    } catch (error) {
      console.error('Failed to save gta-news settings', error);
      response.status(500).json({ error: 'failed to save settings' });
    }
  });
}
