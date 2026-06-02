import type { Client } from 'discord.js';
import type { SqliteDatabase } from '../../../../lib/database/types.js';

export function registerGtaNewsCommand(client: Client, _database: SqliteDatabase) {
  client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) {
      return;
    }

    if (interaction.commandName !== 'gta-news') {
      return;
    }

    await interaction.reply({
      content: 'GTA News feature is wired up. Settings will be loaded from SQLite.',
      ephemeral: true
    });
  });
}
