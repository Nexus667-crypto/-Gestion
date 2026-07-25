const fs = require('fs');
const path = require('path');
const { REST, Routes } = require('discord.js');
const config = require('../config/config');
const logger = require('../utils/logger');

module.exports = async (client) => {
  const commandsPath = path.join(__dirname, '..', 'commands');
  const files = fs.readdirSync(commandsPath).filter((f) => f.endsWith('.js'));
  const commands = [];

  for (const file of files) {
    try {
      const command = require(path.join(commandsPath, file));
      client.commands.set(command.data.name, command);
      commands.push(command.data.toJSON());
      logger.info(`📝 Commande chargée: ${command.data.name}`);
    } catch (err) {
      logger.error(`❌ Erreur commande ${file}:`, err);
    }
  }

  const rest = new REST({ version: '10' }).setToken(config.token);
  try {
    await rest.put(Routes.applicationCommands(config.clientId), { body: commands });
    logger.success(`✅ ${commands.length} commande(s) slash enregistrée(s)`);
  } catch (err) {
    logger.error('❌ Erreur enregistrement commandes:', err);
  }
};
