const logger = require('../utils/logger');
const { safeExecute } = require('../utils/security');

module.exports = (client) => {
  client.on('interactionCreate', async (interaction) => {
    await safeExecute(async () => {
      if (interaction.isChatInputCommand()) {
        const command = client.commands.get(interaction.commandName);
        if (!command) return;
        client.stats.commandsExecuted++;
        await command.execute(interaction, client);
      } else if (interaction.isButton()) {
        const [type, ...args] = interaction.customId.split('_');
        const panel = require(`../dashboard/panels/${args[0]}`);
        if (panel && panel.button) await panel.button(interaction, client, args);
      } else if (interaction.isStringSelectMenu()) {
        const [type, panel, action] = interaction.customId.split('_');
        const mod = require(`../dashboard/panels/${panel}`);
        if (mod && mod.menu) await mod.menu(interaction, client, action);
      } else if (interaction.isModalSubmit()) {
        const [type, panel, action] = interaction.customId.split('_');
        const mod = require(`../dashboard/modals/${panel}`);
        if (mod && mod.submit) await mod.submit(interaction, client, action);
      }
    }, 'interactionHandler');
  });
};
