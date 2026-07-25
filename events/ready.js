const { ActivityType } = require('discord.js');
const logger = require('../utils/logger');

module.exports = {
  name: 'ready',
  once: true,
  execute(client) {
    logger.success(`🚀 ${client.user.tag} est en ligne !`);
    logger.info(`📊 ${client.guilds.cache.size} serveur(s)`);
    client.user.setActivity('/dashboard', { type: ActivityType.Watching });
  },
};
