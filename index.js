const { Client, GatewayIntentBits, Partials, Collection } = require('discord.js');
const mongoose = require('mongoose');
const config = require('./config/config');
const logger = require('./utils/logger');

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
client.buttons = new Collection();
client.menus = new Collection();
client.modals = new Collection();
client.cooldowns = new Collection();
client.stats = { commandsExecuted: 0, startTime: Date.now() };

(async () => {
  try {
    await mongoose.connect(config.mongoUri);
    logger.success('✅ Connecté à MongoDB');
  } catch (err) {
    logger.error('❌ Erreur MongoDB:', err);
    process.exit(1);
  }

  require('./handlers/commandHandler')(client);
  require('./handlers/eventHandler')(client);
  require('./handlers/interactionHandler')(client);

  try {
    await client.login(config.token);
  } catch (err) {
    logger.error('❌ Erreur de connexion Discord:', err);
  }
})();

process.on('unhandledRejection', (err) => logger.error('Unhandled Rejection:', err));
process.on('uncaughtException', (err) => logger.error('Uncaught Exception:', err));
