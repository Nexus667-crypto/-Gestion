const { EmbedBuilder } = require('discord.js');
const config = require('../config/config');

function createEmbed({ title, description, color, fields, footer, thumbnail, image }) {
  const embed = new EmbedBuilder()
    .setColor(color || config.colors.primary)
    .setTimestamp();
  if (title) embed.setTitle(title);
  if (description) embed.setDescription(description);
  if (fields) embed.addFields(fields);
  if (footer) embed.setFooter({ text: footer });
  if (thumbnail) embed.setThumbnail(thumbnail);
  if (image) embed.setImage(image);
  return embed;
}

function errorEmbed(message) {
  return createEmbed({ title: '❌ Erreur', description: message, color: config.colors.error });
}

function successEmbed(message) {
  return createEmbed({ title: '✅ Succès', description: message, color: config.colors.success });
}

module.exports = { createEmbed, errorEmbed, successEmbed };
