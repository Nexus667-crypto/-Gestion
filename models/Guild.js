const { Schema, model } = require('mongoose');

const guildSchema = new Schema({
  guildId: { type: String, required: true, unique: true },
  configured: { type: Boolean, default: false },
  language: { type: String, default: 'fr' },
  primaryColor: { type: Number, default: 0x5865F2 },
  logsChannelId: { type: String, default: null },
  ticketsChannelId: { type: String, default: null },
  staff: [{
    userId: String,
    level: { type: Number, default: 1 },
    addedAt: { type: Date, default: Date.now },
  }],
  stats: {
    commandsExecuted: { type: Number, default: 0 },
  },
}, { timestamps: true });

module.exports = model('Guild', guildSchema);
