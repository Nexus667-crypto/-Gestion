// ═══════════════════════════════════════════
// CONNEXION
// ═══════════════════════════════════════════

(async () => {
  // Vérifier les variables critiques
  if (!config.mongoUri) {
    logger.error('❌ MONGO_URI est manquant ! Vérifie les variables d\'environnement sur Railway.');
    process.exit(1);
  }

  if (!config.token) {
    logger.error('❌ TOKEN est manquant ! Vérifie les variables d\'environnement sur Railway.');
    process.exit(1);
  }

  try {
    logger.info('🔄 Connexion à MongoDB...');
    await mongoose.connect(config.mongoUri);
    logger.success('✅ Connecté à MongoDB');
  } catch (err) {
    logger.error('❌ Erreur MongoDB:', err.message);
    if (err.message.includes('bad auth')) {
      logger.error('💡 Vérifie que ton URL MongoDB est correcte et que l\'IP Railway est autorisée dans MongoDB Atlas.');
    }
    process.exit(1);
  }

  try {
    logger.info('🔄 Connexion à Discord...');
    await client.login(config.token);
  } catch (err) {
    logger.error('❌ Erreur de connexion Discord:', err.message);
    if (err.message.includes('token')) {
      logger.error('💡 Vérifie que ton TOKEN est correct.');
    }
  }
})();

process.on('unhandledRejection', (err) => logger.error('Unhandled Rejection:', err));
process.on('uncaughtException', (err) => logger.error('Uncaught Exception:', err));
