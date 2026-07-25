const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { getUserLevel } = require('../utils/permissions');
const { buildSidebar } = require('../utils/components');
const { createEmbed, errorEmbed } = require('../utils/embeds');
const { safeExecute } = require('../utils/security');
const Guild = require('../models/Guild');
const config = require('../config/config');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('dashboard')
    .setDescription('Ouvrir le dashboard Helpy')
    .setDefaultMemberPermissions(PermissionFlagsBits.UseApplicationCommands),

  async execute(interaction, client) {
    await safeExecute(async () => {
      await interaction.deferReply({ ephemeral: true });

      let guildData = await Guild.findOne({ guildId: interaction.guildId });
      if (!guildData) {
        guildData = await Guild.create({ guildId: interaction.guildId });
      }

      if (!guildData.configured) {
        return await startSetup(interaction, guildData);
      }

      const level = await getUserLevel(interaction.user.id, interaction.guildId);
      const panel = require('../dashboard/panels/home');
      const content = await panel.render(interaction, client, level);

      await interaction.editReply({
        embeds: [content.embed],
        components: [...buildSidebar(level), ...(content.rows || [])],
        ephemeral: true,
      });
    }, 'dashboard command');
  },
};

async function startSetup(interaction, guildData) {
  const embed = createEmbed({
    title: '🎉 Bienvenue sur Helpy !',
    description: 'Commençons la configuration initiale de ton serveur.\n\nRéponds aux questions suivantes dans l\'ordre.',
    color: config.colors.primary,
  });

  const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');

  const modal = new ModalBuilder()
    .setCustomId('setup_initial')
    .setTitle('Configuration Helpy');

  const logsInput = new TextInputBuilder()
    .setCustomId('logs_channel')
    .setLabel('ID du salon Logs')
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  const ticketsInput = new TextInputBuilder()
    .setCustomId('tickets_channel')
    .setLabel('ID du salon Tickets (optionnel)')
    .setStyle(TextInputStyle.Short)
    .setRequired(false);

  const langInput = new TextInputBuilder()
    .setCustomId('language')
    .setLabel('Langue (fr/en)')
    .setStyle(TextInputStyle.Short)
    .setValue('fr')
    .setRequired(true);

  const colorInput = new TextInputBuilder()
    .setCustomId('color')
    .setLabel('Couleur principale (hex, ex: 5865F2)')
    .setStyle(TextInputStyle.Short)
    .setValue('5865F2')
    .setRequired(true);

  modal.addComponents(
    new ActionRowBuilder().addComponents(logsInput),
    new ActionRowBuilder().addComponents(ticketsInput),
    new ActionRowBuilder().addComponents(langInput),
    new ActionRowBuilder().addComponents(colorInput),
  );

  await interaction.editReply({ embeds: [embed], components: [] });
  await interaction.showModal(modal);

  // Le modal est géré dans dashboard/modals/setup.js
}
