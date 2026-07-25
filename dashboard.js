const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const config = require('./config');
const { Guild, Sanction, Ticket, getUserLevel, canSanction, validateDuration, safeExecute } = require('./database');

// ═══════════════════════════════════════════
// UTILITAIRES DASHBOARD
// ═══════════════════════════════════════════

function createEmbed({ title, description, color, fields, thumbnail, image }) {
  const embed = new EmbedBuilder()
    .setColor(color || config.colors.primary)
    .setTimestamp();
  if (title) embed.setTitle(title);
  if (description) embed.setDescription(description);
  if (fields) embed.addFields(fields);
  if (thumbnail) embed.setThumbnail(thumbnail);
  if (image) embed.setImage(image);
  return embed;
}

function buildSidebar(level) {
  const buttons = [
    { id: 'home', label: 'Dashboard', emoji: config.emojis.home, minLevel: 1 },
    { id: 'profile', label: 'Profil', emoji: config.emojis.profile, minLevel: 1 },
    { id: 'moderation', label: 'Modération', emoji: config.emojis.moderation, minLevel: 2 },
    { id: 'staff', label: 'Gestion Staff', emoji: config.emojis.staff, minLevel: 4 },
    { id: 'settings', label: 'Paramètres', emoji: config.emojis.settings, minLevel: 4 },
    { id: 'logs', label: 'Logs', emoji: config.emojis.logs, minLevel: 3 },
    { id: 'creator', label: 'Créateur', emoji: config.emojis.creator, minLevel: 5 },
  ];

  const visible = buttons.filter((b) => level >= b.minLevel);
  const rows = [];

  for (let i = 0; i < visible.length; i += 5) {
    const row = new ActionRowBuilder();
    visible.slice(i, i + 5).forEach((b) => {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`nav_${b.id}`)
          .setLabel(b.label)
          .setEmoji(b.emoji)
          .setStyle(ButtonStyle.Secondary)
      );
    });
    rows.push(row);
  }
  return rows;
}

function memberSelectMenu(members, customId) {
  const options = members.slice(0, 25).map((m) => ({
    label: m.user?.tag || m.user?.username || 'Inconnu',
    value: m.id || m.user?.id,
    description: `ID: ${m.id || m.user?.id}`,
  }));

  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(customId)
      .setPlaceholder('Sélectionner un membre...')
      .addOptions(options)
  );
}

// ═══════════════════════════════════════════
// PANELS
// ═══════════════════════════════════════════

async function renderPanel(panelName, interaction, client, level) {
  const panels = {
    home: renderHome,
    profile: renderProfile,
    moderation: renderModeration,
    staff: renderStaff,
    settings: renderSettings,
    logs: renderLogs,
    creator: renderCreator,
  };

  const panel = panels[panelName];
  if (!panel) return { embed: createEmbed({ title: '❌ Panel introuvable' }), rows: [] };

  return await panel(interaction, client);
}

async function renderHome(interaction) {
  const guild = interaction.guild;
  await guild.members.fetch();

  const sanctions = await Sanction.countDocuments({ guildId: guild.id, active: true });
  const tickets = await Ticket.countDocuments({ guildId: guild.id, status: 'open' });

  const members = guild.members.cache
    .filter((m) => !m.user.bot)
    .sort((a, b) => b.joinedTimestamp - a.joinedTimestamp);

  const embed = createEmbed({
    title: '🏠 Dashboard — ' + guild.name,
    description: 'Vue d\'ensemble de ton serveur.',
    fields: [
      { name: '👥 Membres', value: `\`${guild.memberCount}\``, inline: true },
      { name: '💬 Salons', value: `\`${guild.channels.cache.size}\``, inline: true },
      { name: '🎭 Rôles', value: `\`${guild.roles.cache.size}\``, inline: true },
      { name: '🎟️ Tickets ouverts', value: `\`${tickets}\``, inline: true },
      { name: '⚖️ Sanctions actives', value: `\`${sanctions}\``, inline: true },
      { name: '👑 Owner', value: `<@${guild.ownerId}>`, inline: true },
    ],
    thumbnail: guild.iconURL({ dynamic: true }),
  });

  const rows = members.size > 0 ? [memberSelectMenu(Array.from(members.values()), 'select_home_member')] : [];
  return { embed, rows };
}

async function renderProfile(interaction) {
  const member = await interaction.guild.members.fetch(interaction.user.id);
  const embed = await buildMemberEmbed(member, interaction.guild);
  return { embed, rows: [] };
}

async function buildMemberEmbed(target, guild) {
  const sanctions = await Sanction.find({ guildId: guild.id, targetId: target.id });
  const warns = sanctions.filter((s) => s.type === 'warn' && s.active).length;
  const kicks = sanctions.filter((s) => s.type === 'kick').length;
  const bans = sanctions.filter((s) => s.type === 'ban').length;

  const roles = target.roles?.cache
    ?.filter((r) => r.id !== guild.id)
    .map((r) => r.toString())
    .join(', ') || 'Aucun';

  const history = sanctions
    .slice(-10)
    .reverse()
    .map((s) => `• \`${s.type.toUpperCase()}\` — ${s.reason} *(<t:${Math.floor(s.createdAt.getTime()/1000)}:R>)*`)
    .join('\n') || 'Aucune sanction';

  const banner = await target.user.bannerURL({ size: 512, dynamic: true }).catch(() => null);

  return createEmbed({
    title: `👤 Profil — ${target.user?.tag || 'Inconnu'}`,
    description: `**Pseudo:** ${target.user?.username || 'Inconnu'}\n**ID:** \`${target.id}\``,
    thumbnail: target.user?.displayAvatarURL({ dynamic: true, size: 512 }),
    image: banner,
    fields: [
      { name: '📅 Compte créé', value: `<t:${Math.floor(target.user?.createdTimestamp/1000)}:R>`, inline: true },
      { name: '📥 Arrivé le', value: target.joinedTimestamp ? `<t:${Math.floor(target.joinedTimestamp/1000)}:R>` : 'Inconnu', inline: true },
      { name: '🎭 Rôles', value: roles.slice(0, 1000), inline: false },
      { name: '⚠️ Warns', value: `\`${warns}\``, inline: true },
      { name: '👢 Kicks', value: `\`${kicks}\``, inline: true },
      { name: '🔨 Bans', value: `\`${bans}\``, inline: true },
      { name: '📜 Historique récent', value: history.slice(0, 1000), inline: false },
    ],
  });
}

async function renderModeration() {
  const embed = createEmbed({
    title: '🔨 Modération',
    description: 'Choisis une action de modération.',
  });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('mod_warn').setLabel('Warn').setEmoji('⚠️').setStyle(ButtonStyle.Warning),
    new ButtonBuilder().setCustomId('mod_kick').setLabel('Kick').setEmoji('👢').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('mod_timeout').setLabel('Timeout').setEmoji('⏰').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('mod_ban').setLabel('Ban').setEmoji('🔨').setStyle(ButtonStyle.Danger),
  );

  return { embed, rows: [row] };
}

async function renderStaff() {
  return { embed: createEmbed({ title: '👑 Gestion Staff', description: 'Module en développement.' }), rows: [] };
}

async function renderSettings() {
  return { embed: createEmbed({ title: '⚙️ Paramètres', description: 'Module en développement.' }), rows: [] };
}

async function renderLogs() {
  return { embed: createEmbed({ title: '📜 Logs', description: 'Module en développement.' }), rows: [] };
}

async function renderCreator() {
  return { embed: createEmbed({ title: '🤖 Créateur', description: 'Module réservé au créateur.' }), rows: [] };
}

// ═══════════════════════════════════════════
// HANDLERS
// ═══════════════════════════════════════════

async function handleButton(interaction, client, panel) {
  await safeExecute(async () => {
    const level = await getUserLevel(interaction.user.id, interaction.guildId);

    if (interaction.customId.startsWith('nav_')) {
      const panelName = interaction.customId.replace('nav_', '');
      const content = await renderPanel(panelName, interaction, client, level);
      await interaction.update({
        embeds: [content.embed],
        components: [...buildSidebar(level), ...(content.rows || [])],
      });
      return;
    }

    if (interaction.customId.startsWith('mod_')) {
      const action = interaction.customId.replace('mod_', '');
      await interaction.deferUpdate();
      const members = Array.from((await interaction.guild.members.fetch()).values()).filter((m) => !m.user.bot);
      const embed = createEmbed({
        title: `🎯 ${action.toUpperCase()} — Sélectionne un membre`,
        description: 'Utilise le menu ci-dessous.',
      });
      await interaction.editReply({
        embeds: [embed],
        components: [memberSelectMenu(members, `select_mod_${action}`)],
      });
    }
  }, 'handleButton');
}

async function handleMenu(interaction, client) {
  await safeExecute(async () => {
    const customId = interaction.customId;
    const targetId = interaction.values[0];

    if (customId.startsWith('select_home_')) {
      await interaction.deferUpdate();
      const target = await interaction.guild.members.fetch(targetId).catch(() => null);
      if (!target) return await interaction.editReply({ embeds: [createEmbed({ title: '❌ Membre introuvable' })], components: [] });
      const embed = await buildMemberEmbed(target, interaction.guild);
      await interaction.editReply({ embeds: [embed], components: [] });
      return;
    }

    if (customId.startsWith('select_mod_')) {
      const action = customId.replace('select_mod_', '');
      const target = await interaction.guild.members.fetch(targetId).catch(() => null);

      if (!target) {
        return await interaction.reply({ content: '❌ Membre introuvable.', ephemeral: true });
      }

      if (action === 'timeout') {
        const modal = new ModalBuilder().setCustomId(`modal_timeout_${targetId}`).setTitle(`Timeout — ${target.user.tag}`);
        const durationInput = new TextInputBuilder()
          .setCustomId('duration')
          .setLabel('Durée en minutes (max 2880 = 2j)')
          .setStyle(TextInputStyle.Short)
          .setRequired(true);
        const reasonInput = new TextInputBuilder()
          .setCustomId('reason')
          .setLabel('Raison')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true);
        modal.addComponents(
          new ActionRowBuilder().addComponents(durationInput),
          new ActionRowBuilder().addComponents(reasonInput),
        );
        return await interaction.showModal(modal);
      }

      const modal = new ModalBuilder().setCustomId(`modal_${action}_${targetId}`).setTitle(`${action.toUpperCase()} — ${target.user.tag}`);
      const reasonInput = new TextInputBuilder()
        .setCustomId('reason')
        .setLabel('Raison de la sanction')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true);
      modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
      await interaction.showModal(modal);
    }
  }, 'handleMenu');
}

async function handleModal(interaction, client) {
  await safeExecute(async () => {
    const customId = interaction.customId;

    // Setup initial
    if (customId === 'setup_initial') {
      const logsChannel = interaction.fields.getTextInputValue('logs_channel');
      const ticketsChannel = interaction.fields.getTextInputValue('tickets_channel') || null;
      const language = interaction.fields.getTextInputValue('language');
      const color = parseInt(interaction.fields.getTextInputValue('color'), 16);

      await Guild.findOneAndUpdate(
        { guildId: interaction.guildId },
        {
          configured: true,
          logsChannelId: logsChannel,
          ticketsChannelId: ticketsChannel,
          language: language,
          primaryColor: color || config.colors.primary,
        }
      );

      // Ajouter l'owner comme niveau 4
      await Guild.findOneAndUpdate(
        { guildId: interaction.guildId },
        { $push: { staff: { userId: interaction.guild.ownerId, level: config.levels.OWNER } } }
      );

      await interaction.reply({
        embeds: [createEmbed({ title: '✅ Configuration terminée !', description: 'Utilise /dashboard pour accéder au panneau de contrôle.', color: config.colors.success })],
        ephemeral: true,
      });
      return;
    }

    // Sanctions
    if (customId.startsWith('modal_')) {
      const parts = customId.split('_');
      const action = parts[1];
      const targetId = parts[2];

      const guild = interaction.guild;
      const executor = interaction.member;
      const target = await guild.members.fetch(targetId).catch(() => null);

      if (!target) {
        return await interaction.reply({ embeds: [createEmbed({ title: '❌ Cible introuvable', color: config.colors.error })], ephemeral: true });
      }

      const check = await canSanction(executor, target, guild);
      if (!check.ok) {
        return await interaction.reply({ embeds: [createEmbed({ title: '❌ ' + check.reason, color: config.colors.error })], ephemeral: true });
      }

      const executorLevel = await getUserLevel(executor.id, guild.id);

      if (action === 'timeout') {
        const durationMin = parseInt(interaction.fields.getTextInputValue('duration'));
        const reason = interaction.fields.getTextInputValue('reason');
        const maxDays = executorLevel === config.levels.STAFF_TEST ? 2 : 28;
        const v = validateDuration(durationMin * 60, maxDays);
        if (!v.ok) return await interaction.reply({ embeds: [createEmbed({ title: '❌ ' + v.reason, color: config.colors.error })], ephemeral: true });

        await target.timeout(durationMin * 60 * 1000, reason).catch(() => null);
        await Sanction.create({ guildId: guild.id, targetId, executorId: executor.id, type: 'timeout', reason, duration: durationMin * 60 });
        return await interaction.reply({ embeds: [createEmbed({ title: `✅ ${target.user.tag} mis en timeout pour ${durationMin} min.`, color: config.colors.success })], ephemeral: true });
      }

      const reason = interaction.fields.getTextInputValue('reason');

      if (action === 'warn') {
        await Sanction.create({ guildId: guild.id, targetId, executorId: executor.id, type: 'warn', reason });
        return await interaction.reply({ embeds: [createEmbed({ title: `✅ ${target.user.tag} a reçu un avertissement.`, color: config.colors.success })], ephemeral: true });
      }

      if (action === 'kick') {
        await target.kick(reason).catch(() => null);
        await Sanction.create({ guildId: guild.id, targetId, executorId: executor.id, type: 'kick', reason });
        return await interaction.reply({ embeds: [createEmbed({ title: `✅ ${target.user.tag} a été expulsé.`, color: config.colors.success })], ephemeral: true });
      }

      if (action === 'ban') {
        if (executorLevel === config.levels.STAFF_TEST) {
          await guild.bans.create(target.id, { reason, deleteMessageSeconds: 2 * 24 * 60 * 60 }).catch(() => null);
          await Sanction.create({ guildId: guild.id, targetId, executorId: executor.id, type: 'ban', reason, duration: 2 * 24 * 60 * 60 });
          return await interaction.reply({ embeds: [createEmbed({ title: `✅ ${target.user.tag} banni pour 2 jours.`, color: config.colors.success })], ephemeral: true });
        }
        await guild.bans.create(target.id, { reason, deleteMessageSeconds: 7 * 24 * 60 * 60 }).catch(() => null);
        await Sanction.create({ guildId: guild.id, targetId, executorId: executor.id, type: 'ban', reason, duration: 30 * 24 * 60 * 60 });
        return await interaction.reply({ embeds: [createEmbed({ title: `✅ ${target.user.tag} a été banni.`, color: config.colors.success })], ephemeral: true });
      }
    }
  }, 'handleModal');
}

module.exports = {
  renderPanel,
  buildSidebar,
  handleButton,
  handleMenu,
  handleModal,
};
