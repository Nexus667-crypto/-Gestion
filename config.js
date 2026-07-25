require('dotenv').config();

// Debug : afficher les variables chargées
console.log('🔍 Variables d\'environnement chargées :');
console.log('  TOKEN:', process.env.TOKEN ? '✅ Défini' : '❌ MANQUANT');
console.log('  MONGO_URI:', process.env.MONGO_URI ? '✅ Défini' : '❌ MANQUANT');
console.log('  CLIENT_ID:', process.env.CLIENT_ID ? '✅ Défini' : '❌ MANQUANT');
console.log('  CREATOR_ID:', process.env.CREATOR_ID ? '✅ Défini' : '❌ MANQUANT');

module.exports = {
  token: process.env.TOKEN,
  mongoUri: process.env.MONGO_URI,
  clientId: process.env.CLIENT_ID,
  creatorId: process.env.CREATOR_ID,

  levels: {
    MEMBER: 1,
    STAFF_TEST: 2,
    STAFF: 3,
    OWNER: 4,
    CREATOR: 5,
  },

  levelNames: {
    1: 'Membre',
    2: 'Staff Test',
    3: 'Staff',
    4: 'Owner',
    5: 'Créateur',
  },

  colors: {
    primary: 0x5865F2,
    success: 0x57F287,
    warning: 0xFEE75C,
    error: 0xED4245,
  },

  emojis: {
    home: '🏠',
    profile: '👤',
    moderation: '🔨',
    staff: '👑',
    settings: '⚙️',
    logs: '📜',
    creator: '🤖',
  },
};
