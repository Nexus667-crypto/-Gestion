const { Schema, model } = require('mongoose');

const userSchema = new Schema({
  userId: { type: String, required: true },
  globalWarns: { type: Number, default: 0 },
  globalKicks: { type: Number, default: 0 },
  globalBans: { type: Number, default: 0 },
}, { timestamps: true });

module.exports = model('User', userSchema);
