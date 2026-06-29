import type { Client } from 'discord.js';
import type { SqliteDatabase } from '../../../../lib/database/types.js';
import { createGtaNewsForumPost } from '../forum.js';
import { getGtaNewsSettings } from '../../db/schema.js';

export function registerGtaNewsCommand(client: Client, database: SqliteDatabase) {
  client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) {
      return;
    }

    if (interaction.commandName !== 'gta-news') {
      return;
    }

    const guildId = interaction.guildId;

    if (!guildId) {
      await interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
      return;
    }

    const settings = getGtaNewsSettings(database, guildId);

    if (!settings?.channelId) {
      await interaction.reply({ content: 'No forum channel is configured for GTA News yet.', ephemeral: true });
      return;
    }

    try {
      await createGtaNewsForumPost({
        client,
        forumChannelId: settings.channelId,
        title: 'GTA Online Weekly Update',
        summary: 'This is a sample GTA News post published through the forum workflow. Future weekly updates can call the same helper.'
      });

      await interaction.reply({
        content: 'Posted a GTA News forum thread in the configured channel.',
        ephemeral: true
      });
    } catch (error) {
      console.error('Failed to publish GTA News forum post', error);
      await interaction.reply({
        content: 'Could not create the forum post. Make sure the configured channel is a forum channel and the bot can post there.',
        ephemeral: true
      });
    }
  });
}
