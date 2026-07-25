const Guild = require('../models/Guild');
const config = require('../config/config');

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

function hasLevel(userLevel, requiredLevel) {
  return userLevel >= requiredLevel;
}

async function canSanction(executor, target, guild) {
  if (target.id === guild.ownerId) return { ok: false, reason: "Tu ne peux pas sanctionner le propriétaire du serveur." };
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

module.exports = { getUserLevel, hasLevel, canSanction };
