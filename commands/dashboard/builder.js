const { getUserLevel } = require('../utils/permissions');
const { buildSidebar } = require('../utils/components');
const { errorEmbed } = require('../utils/embeds');

async function openPanel(interaction, client, panelName) {
  const level = await getUserLevel(interaction.user.id, interaction.guildId);
  const requiredLevels = {
    home: 1, profile: 1, moderation: 2,
    staff: 4, settings: 4, logs: 3, creator: 5,
  };

  if (level < requiredLevels[panelName]) {
    return await interaction.editReply({
      embeds: [errorEmbed('❌ Tu n\'as pas la permission d\'accéder à cette section.')],
      components: [],
      ephemeral: true,
    });
  }

  const panel = require(`./panels/${panelName}`);
  const content = await panel.render(interaction, client, level);

  await interaction.editReply({
    embeds: [content.embed],
    components: [...buildSidebar(level), ...(content.rows || [])],
    ephemeral: true,
  });
}

module.exports = { openPanel };
