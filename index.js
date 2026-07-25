const { Client, GatewayIntentBits, Partials, Collection, ActivityType, REST, Routes, SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const mongoose = require('mongoose');
const config = require('./config');
const { logger, Guild, getUserLevel, safeExecute } = require('./database');
const dashboard = require('./dashboard');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.User, Partials.Channel, Partials.GuildMember],
});

client.commands = new Collection();
client.stats = { commandsExecuted: 0, startTime: Date.now() };

// ═══════════════════════════════════════════
// COMMANDE /dashboard
// ═══════════════════════════════════════════

const dashboardCommand = {
  data: new SlashCommandBuilder()
    .setName('dashboard')
    .setDescription('Ouvrir le dashboard Helpy')
    .setDefaultMemberPermissions(PermissionFlagsBits.UseApplicationCommands),

  async execute(interaction) {
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
      const content = await dashboard.renderPanel('home', interaction, client, level);

      await interaction.editReply({
        embeds: [content.embed],
        components: [...dashboard.buildSidebar(level), ...(content.rows || [])],
        ephemeral: true,
      });
    }, 'dashboard command');
  },
};

async function startSetup(interaction, guildData) {
  const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, EmbedBuilder } = require('discord.js');

  const embed = new EmbedBuilder()
    .setColor(config.colors.primary)
    .setTitle('🎉 Bienvenue sur Helpy !')
    .setDescription('Commençons la configuration initiale de ton serveur.');

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
}

client.commands.set('dashboard', dashboardCommand);

// ═══════════════════════════════════════════
// EVENTS
// ═══════════════════════════════════════════

client.once('ready', async () => {
  logger.success(`🚀 ${client.user.tag} est en ligne !`);
  logger.info(`📊 ${client.guilds.cache.size} serveur(s)`);
  client.user.setActivity('/dashboard', { type: ActivityType.Watching });

  // Enregistrer les commandes slash
  const rest = new REST({ version: '10' }).setToken(config.token);
  try {
    await rest.put(Routes.applicationCommands(config.clientId), {
      body: [dashboardCommand.data.toJSON()],
    });
    logger.success('✅ Commande slash enregistrée');
  } catch (err) {
    logger.error('❌ Erreur enregistrement commandes:', err);
  }
});

client.on('interactionCreate', async (interaction) => {
  await safeExecute(async () => {
    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);
      if (!command) return;
      client.stats.commandsExecuted++;
      await command.execute(interaction, client);
    } else if (interaction.isButton()) {
      const [, panel] = interaction.customId.split('_');
      await dashboard.handleButton(interaction, client, panel);
    } else if (interaction.isStringSelectMenu()) {
      await dashboard.handleMenu(interaction, client);
    } else if (interaction.isModalSubmit()) {
      await dashboard.handleModal(interaction, client);
    }
  }, 'interactionCreate');
});

// ═══════════════════════════════════════════
// CONNEXION
// ═══════════════════════════════════════════

(async () => {
  try {
    await mongoose.connect(config.mongoUri);
    logger.success('✅ Connecté à MongoDB');
  } catch (err) {
    logger.error('❌ Erreur MongoDB:', err);
    process.exit(1);
  }

  try {
    await client.login(config.token);
  } catch (err) {
    logger.error('❌ Erreur de connexion Discord:', err);
  }
})();

process.on('unhandledRejection', (err) => logger.error('Unhandled Rejection:', err));
process.on('uncaughtException', (err) => logger.error('Uncaught Exception:', err));
