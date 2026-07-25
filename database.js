const { Schema, model } = require('mongoose');
const chalk = require('chalk');
const fs = require('fs');
const path = require('path');
const config = require('./config');

// ═══════════════════════════════════════════
// LOGGER
// ═══════════════════════════════════════════

const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
const logFile = path.join(logsDir, `helpy-${new Date().toISOString().split('T')[0]}.log`);

const write = (level, ...args) => {
  const time = new Date().toLocaleString('fr-FR');
  const msg = `[${time}] [${level}] ${args.join(' ')}`;
  fs.appendFileSync(logFile, msg + '\n');
};

const logger = {
  info: (...args) => { console.log(chalk.blue('[INFO]'), ...args); write('INFO', ...args); },
  success: (...args) => { console.log(chalk.green('[OK]'), ...args); write('OK', ...args); },
  warn: (...args) => { console.log(chalk.yellow('[WARN]'), ...args); write('WARN', ...args); },
  error: (...args) => { console.log(chalk.red('[ERR]'), ...args); write('ERR', ...args); },
};

// ═══════════════════════════════════════════
// MODÈLES MONGODB
// ═══════════════════════════════════════════

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

const userSchema = new Schema({
  userId: { type: String, required: true },
  globalWarns: { type: Number, default: 0 },
  globalKicks: { type: Number, default: 0 },
  globalBans: { type: Number, default: 0 },
}, { timestamps: true });

const sanctionSchema = new Schema({
  guildId: { type: String, required: true },
  targetId: { type: String, required: true },
  executorId: { type: String, required: true },
  type: { type: String, enum: ['warn', 'kick', 'ban', 'timeout', 'mute', 'unmute', 'unban', 'remove_warn'], required: true },
  reason: { type: String, default: 'Aucune raison' },
  duration: { type: Number, default: null },
  active: { type: Boolean, default: true },
}, { timestamps: true });

const ticketSchema = new Schema({
  guildId: { type: String, required: true },
  channelId: { type: String, required: true },
  userId: { type: String, required: true },
  status: { type: String, enum: ['open', 'closed'], default: 'open' },
}, { timestamps: true });

const Guild = model('Guild', guildSchema);
const User = model('User', userSchema);
const Sanction = model('Sanction', sanctionSchema);
const Ticket = model('Ticket', ticketSchema);

// ═══════════════════════════════════════════
// UTILITAIRES
// ═══════════════════════════════════════════

async function getUserLevel(userId, guildId) {
  try {
    if (userId === config.creatorId) return config.levels.CREATOR;
    const guildData = await Guild.findOne({ guildId });
    if (!guildData) return config.levels.MEMBER;
    const userEntry = guildData.staff.find((s) => s.userId === userId);
    return userEntry ? userEntry.level : config.levels.MEMBER;
  } catch (err) {
    return config.levels.MEMBER;
  }
}

async function canSanction(executor, target, guild) {
  if (target.id === guild.ownerId) return { ok: false, reason: "Tu ne peux pas sanctionner le propriétaire." };
  if (target.id === executor.id) return { ok: false, reason: "Tu ne peux pas te sanctionner toi-même." };
  if (target.id === executor.client.user.id) return { ok: false, reason: "Je ne peux pas me sanctionner." };

  const executorLevel = await getUserLevel(executor.id, guild.id);
  const targetLevel = await getUserLevel(target.id, guild.id);

  if (targetLevel >= executorLevel) {
    return { ok: false, reason: "Tu ne peux pas sanctionner un membre de niveau égal ou supérieur." };
  }

  const executorMember = await guild.members.fetch(executor.id).catch(() => null);
  const targetMember = await guild.members.fetch(target.id).catch(() => null);

  if (executorMember && targetMember && targetMember.roles.highest.position >= executorMember.roles.highest.position) {
    return { ok: false, reason: "Le rôle de la cible est supérieur ou égal au tien." };
  }

  const botMember = guild.members.me;
  if (targetMember && targetMember.roles.highest.position >= botMember.roles.highest.position) {
    return { ok: false, reason: "Mon rôle est insuffisant pour sanctionner ce membre." };
  }

  return { ok: true };
}

function validateDuration(duration, maxDays) {
  const ms = duration * 1000;
  const maxMs = maxDays * 24 * 60 * 60 * 1000;
  if (ms > maxMs) return { ok: false, reason: `Durée maximale : ${maxDays} jour(s).` };
  if (ms <= 0) return { ok: false, reason: 'Durée invalide.' };
  return { ok: true };
}

async function safeExecute(fn, context = 'unknown') {
  try {
    return await fn();
  } catch (err) {
    logger.error(`[SECURITY] Erreur dans ${context}:`, err);
    return null;
  }
}

module.exports = {
  logger,
  Guild,
  User,
  Sanction,
  Ticket,
  getUserLevel,
  canSanction,
  validateDuration,
  safeExecute,
};
