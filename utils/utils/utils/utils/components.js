const { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const config = require('../config/config');

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
      .setPlaceholder('Rechercher un membre...')
      .addOptions(options)
  );
}

module.exports = { buildSidebar, memberSelectMenu };
