const { Schema, model } = require('mongoose');

const sanctionSchema = new Schema({
  guildId: { type: String, required: true },
  targetId: { type: String, required: true },
  executorId: { type: String, required: true },
  type: { type: String, enum: ['warn', 'kick', 'ban', 'timeout', 'mute', 'unmute', 'unban', 'remove_warn'], required: true },
  reason: { type: String, default: 'Aucune raison' },
  duration: { type: Number, default: null },
  active: { type: Boolean, default: true },
}, { timestamps: true });

module.exports = model('Sanction', sanctionSchema);
