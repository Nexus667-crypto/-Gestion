/**
 * BOT DISCORD TOUT-EN-UN V2 — AVEC DASHBOARD HIÉRARCHIQUE
 * ✨ Système de niveaux : Membre (1) / Staff (2) / Admin (3) / Owner (4)
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const {
  Client, GatewayIntentBits, Partials, Collection, REST, Routes,
  SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder,
  ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle,
  ChannelSelectMenuBuilder, RoleSelectMenuBuilder, ChannelType,
  ModalBuilder, TextInputBuilder, TextInputStyle, AuditLogEvent
} = require('discord.js');

// ============================================================
// CONFIGURATION ET STOCKAGE
// ============================================================
const OWNER_ID = (process.env.OWNER_ID || '').trim();
function isOwner(userId) { return OWNER_ID.length > 0 && userId === OWNER_ID; }
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const COLORS = { 
  primary: 0x5865F2, 
  success: 0x57F287, 
  error: 0xED4245, 
  warning: 0xFEE75C,
  info: 0x00B0F4,
  admin: 0xFF0000
};

const BOT_VERSION = 'Bêta V1.1';

// ============================================================
// SYSTÈME DE NIVEAUX DASHBOARD
// ============================================================
const DASHBOARD_LEVELS = {
  1: { name: 'Membre', color: 0x5865F2, emoji: '👤' },
  2: { name: 'Staff', color: 0xFEE75C, emoji: '️' },
  3: { name: 'Admin', color: 0xED4245, emoji: '👑' },
  4: { name: 'Owner', color: 0xFF0000, emoji: '' }
};

function getUserLevel(guildId, userId) {
  const data = getData(guildId);
  if (userId === OWNER_ID) return 4;
  return data.dashboardPermissions?.[userId] || 1;
}

function setUserLevel(guildId, userId, level) {
  const data = getData(guildId);
  if (!data.dashboardPermissions) data.dashboardPermissions = {};
  if (level < 1 || level > 4) level = 1;
  data.dashboardPermissions[userId] = level;
  saveData(guildId, data);
}

function removeUserLevel(guildId, userId) {
  const data = getData(guildId);
  if (data.dashboardPermissions?.[userId]) {
    delete data.dashboardPermissions[userId];
    saveData(guildId, data);
  }
}

function hasLevel(userId, requiredLevel, guildId) {
  return getUserLevel(guildId, userId) >= requiredLevel;
}

function getPermissionsDescription(level) {
  let desc = '';
  if (level >= 1) desc += '• Commandes de base (rank, balance, etc.)\n';
  if (level >= 2) desc += '• Modération (ban, kick, mute, warn)\n';
  if (level >= 3) desc += '• Administration (config, gestion des niveaux)\n';
  if (level >= 4) desc += '• Owner (ban-all, say, toutes commandes)\n';
  return desc;
}

// ============================================================
// DONNÉES PAR DÉFAUT
// ============================================================
function defaultData() {
  return {
    dashboardPermissions: {},
    config: {
      welcome: {
        enabled: false, channelId: null, dmEnabled: false, dmMessage: 'Bienvenue sur {server} !', autoRoleId: null,
        title: '👋 Bienvenue !',
        description: 'Salut {user}, et bienvenue sur **{server}** !',
        imageUrl: null,
        footer: '{server} • Membre #{count}',
        steps: [
          { title: '1. Lis le règlement', text: 'Consulte le règlement du serveur.' },
          { title: '2. Choisis tes rôles', text: 'Accède aux salons en choisissant tes rôles.' },
          { title: '3. Présente-toi', text: 'Fais-toi des amis dans la communauté !' }
        ],
        reminderTitle: '💡 Rappel',
        reminderText: 'Sois respectueux envers tous les membres et amuse-toi bien !'
      },
      moderation: {
        logChannelId: null,
        antiSpam: { enabled: false, maxMessages: 5, intervalMs: 5000 },
        antiLink: { enabled: false, whitelist: [] },
        antiGhostPing: { enabled: false },
        antiRaid: { enabled: false, joinThreshold: 6, joinIntervalMs: 10000, minAccountAgeH: 24, lockdownOnRaid: true },
        antiNuke: { enabled: false, maxChannelDeletes: 3, maxRoleDeletes: 3, maxBans: 3, windowMs: 10000 },
        antiEveryone: { enabled: false, threshold: 3, timeWindowMs: 900000 }
      },
      verification: { 
        enabled: false, 
        channelId: null, 
        roleId: null,
        attempts: 3,
        timeoutMs: 900000
      },
      tickets: {
        enabled: false, categoryId: null, supportRoleId: null, counter: 0,
        mode: 'single',
        panelTitle: '🎫 Support',
        panelDescription: 'Clique sur le bouton ci-dessous pour ouvrir un ticket avec l\'équipe.',
        panelButtonLabel: 'Créer un ticket',
        ticketTitle: 'Ticket #{number}',
        ticketDescription: 'Bienvenue {user} ! Décris ta demande, l\'équipe {role} va te répondre.\n**Sujet :** {subject}',
        categories: [
          { emoji: '️', label: 'Support' },
          { emoji: '🚨', label: 'Signalement' },
          { emoji: '🤝', label: 'Partenariat' },
          { emoji: '', label: '' },
          { emoji: '', label: '' }
        ]
      },
      updates: { channelId: null },
      economy: { enabled: false, dailyAmount: 200, workMin: 50, workMax: 250, currencyName: 'pièces' },
      leveling: { enabled: false, xpPerMessage: 15, cooldownMs: 60000, levelUpChannelId: null, levelUpMessage: '{user} passe niveau **{level}** !' },
      tempVoice: { enabled: false, hubChannelId: null, categoryId: null },
      invites: { enabled: false, logChannelId: null }
    },
    economy: {}, levels: {}, warns: {}, invitesCache: {}, inviteStats: {}, memberInviter: {},
    tempVoiceChannels: {}, raidState: { recentJoins: [], lockdown: false }, nukeState: {},
    verification: {},
    everyoneMentions: {},
    giveaways: {}
  };
}

function filePath(guildId) { return path.join(DATA_DIR, `${guildId}.json`); }

function mergeDefaults(def, raw) {
  if (typeof def !== 'object' || def === null || Array.isArray(def)) return raw !== undefined ? raw : def;
  const out = {};
  for (const key of Object.keys(def)) out[key] = mergeDefaults(def[key], raw ? raw[key] : undefined);
  if (raw) for (const key of Object.keys(raw)) if (!(key in out)) out[key] = raw[key];
  return out;
}

function getData(guildId) {
  const fp = filePath(guildId);
  if (!fs.existsSync(fp)) {
    const fresh = defaultData();
    fs.writeFileSync(fp, JSON.stringify(fresh, null, 2));
    return fresh;
  }
  try {
    return mergeDefaults(defaultData(), JSON.parse(fs.readFileSync(fp, 'utf8')));
  } catch {
    return defaultData();
  }
}

function saveData(guildId, data) { fs.writeFileSync(filePath(guildId), JSON.stringify(data, null, 2)); }

function successEmbed(desc) { return new EmbedBuilder().setColor(COLORS.success).setDescription(`✅ ${desc}`); }
function errorEmbed(desc) { return new EmbedBuilder().setColor(COLORS.error).setDescription(` ${desc}`); }
function infoEmbed(desc) { return new EmbedBuilder().setColor(COLORS.info).setDescription(`ℹ️ ${desc}`); }
function adminEmbed(desc) { return new EmbedBuilder().setColor(COLORS.admin).setDescription(`🔴 **ADMIN** : ${desc}`); }

async function logAction(guild, title, description, color = COLORS.warning) {
  const data = getData(guild.id);
  const channelId = data.config.moderation.logChannelId;
  if (!channelId) return;
  const channel = guild.channels.cache.get(channelId);
  if (!channel) return;
  channel.send({ embeds: [new EmbedBuilder().setColor(color).setTitle(title).setDescription(description).setTimestamp()] }).catch(() => {});
}

function generateVerificationCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function xpForLevel(level) { return 5 * (level ** 2) + 50 * level + 100; }
function levelFromXp(xp) { let l = 0; while (xp >= xpForLevel(l + 1)) l++; return l; }

function fillWelcomeText(str, member) {
  return str
    .replace(/{user}/g, `${member}`)
    .replace(/{server}/g, member.guild.name)
    .replace(/{count}/g, member.guild.memberCount);
}

function fillTicketText(str, { user, roleId, number, subject }) {
  return str
    .replace(/{user}/g, `${user}`)
    .replace(/{role}/g, roleId ? `<@&${roleId}>` : 'support')
    .replace(/{number}/g, `${number}`)
    .replace(/{subject}/g, subject || 'Non précisé');
}

function buildWelcomeEmbed(member, cfg) {
  const embed = new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle(cfg.title)
    .setDescription(fillWelcomeText(cfg.description, member))
    .setThumbnail(member.user.displayAvatarURL());

  const steps = (cfg.steps || []).filter(s => s.title && s.text);
  if (steps.length > 0) {
    embed.addFields(steps.map(s => ({ name: s.title, value: s.text, inline: true })));
  }
  if (cfg.reminderText) {
    embed.addFields({ name: cfg.reminderTitle || '💡 Rappel', value: cfg.reminderText, inline: false });
  }
  if (cfg.imageUrl) embed.setImage(cfg.imageUrl);
  if (cfg.footer) embed.setFooter({ text: fillWelcomeText(cfg.footer, member) });
  embed.setTimestamp();
  return embed;
}

// ============================================================
// GIVEAWAYS
// ============================================================
const DURATION_UNITS = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
function parseDuration(str) {
  const match = /^(\d+)([smhd])$/.exec((str || '').trim());
  return match ? parseInt(match[1]) * DURATION_UNITS[match[2]] : null;
}

function randomId() { return Math.random().toString(36).slice(2, 10); }

function buildGiveawayEmbed(prize, winnersCount, endTime, participantCount, ended = false, winners = []) {
  const embed = new EmbedBuilder().setColor(ended ? COLORS.warning : COLORS.primary).setTitle(ended ? ' GIVEAWAY TERMINÉ 🎉' : '🎉 GIVEAWAY 🎉');
  if (ended) {
    embed.setDescription(`**Lot :** ${prize}\n**Gagnant(s) :** ${winners.length > 0 ? winners.map(id => `<@${id}>`).join(', ') : 'Aucun participant'}\n**Participants :** ${participantCount}`);
  } else {
    embed.setDescription(`**Lot :** ${prize}\n**Nombre de gagnants :** ${winnersCount}\n**Fin :** <t:${Math.floor(endTime / 1000)}:R>\n**Participants :** ${participantCount}`)
      .setFooter({ text: 'Clique sur "🎉 Participer" pour tenter ta chance !' });
  }
  return embed;
}

async function updateGiveawayMessage(guild, g) {
  const channel = guild.channels.cache.get(g.channelId);
  if (!channel) return;
  const msg = await channel.messages.fetch(g.messageId).catch(() => null);
  if (!msg) return;
  const embed = buildGiveawayEmbed(g.prize, g.winnersCount, g.endTime, g.participants.length, g.ended, g.winners || []);
  await msg.edit({ embeds: [embed], components: g.ended ? [] : msg.components }).catch(() => {});
}

async function endGiveaway(guildId, giveawayId) {
  const data = getData(guildId);
  const g = data.giveaways[giveawayId];
  if (!g || g.ended) return;
  g.ended = true;

  let winners = [];
  if (g.participants.length > 0) {
    const pool = [...g.participants];
    for (let i = 0; i < g.winnersCount && pool.length > 0; i++) {
      winners.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
    }
  }
  g.winners = winners;
  saveData(guildId, data);

  const guild = client.guilds.cache.get(guildId);
  if (!guild) return;
  const channel = guild.channels.cache.get(g.channelId);
  if (!channel) return;

  const embed = buildGiveawayEmbed(g.prize, g.winnersCount, g.endTime, g.participants.length, true, winners);
  const msg = await channel.messages.fetch(g.messageId).catch(() => null);
  if (msg) await msg.edit({ embeds: [embed], components: [] }).catch(() => {});

  if (winners.length > 0) {
    channel.send(`🎉 Félicitations ${winners.map(id => `<@${id}>`).join(', ')} ! Tu remportes **${g.prize}** !`).catch(() => {});
  } else {
    channel.send(`Aucun participant pour le giveaway **${g.prize}**, pas de gagnant cette fois.`).catch(() => {});
  }
}

function startGiveawayScheduler() {
  setInterval(() => {
    if (!fs.existsSync(DATA_DIR)) return;
    for (const file of fs.readdirSync(DATA_DIR)) {
      if (!file.endsWith('.json')) continue;
      const guildId = file.replace('.json', '');
      const data = getData(guildId);
      for (const [giveawayId, g] of Object.entries(data.giveaways || {})) {
        if (!g.ended && g.endTime <= Date.now()) {
          endGiveaway(guildId, giveawayId).catch(() => {});
        }
      }
    }
  }, 30000);
}

// ============================================================
// CLIENT
// ============================================================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildModeration, GatewayIntentBits.GuildInvites
  ],
  partials: [Partials.Message, Partials.Channel, Partials.GuildMember]
});

// ============================================================
// COMMANDES SLASH
// ============================================================
const commands = [
  // Commandes ADMIN (visibles seulement pour OWNER_ID)
  new SlashCommandBuilder().setName('ban-all').setDescription('🔴 BAN TOUT LE MONDE (OWNER ONLY)').setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName('say').setDescription('🔴 LE BOT PARLE (OWNER ONLY)').setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addChannelOption(o => o.setName('salon').setDescription('Salon cible').setRequired(true))
    .addStringOption(o => o.setName('message').setDescription('Message').setRequired(true)),
  new SlashCommandBuilder().setName('message-modal').setDescription(' MESSAGE AVANCÉ (OWNER ONLY)').setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addChannelOption(o => o.setName('salon').setDescription('Salon cible').setRequired(true)),

  // Dashboard & Permissions
  new SlashCommandBuilder().setName('dashboard').setDescription('📊 Ouvre le dashboard interactif'),
  new SlashCommandBuilder().setName('set-level').setDescription('🔥 Définit le niveau dashboard d\'un membre (Admin+)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addUserOption(o => o.setName('membre').setDescription('Le membre').setRequired(true))
    .addIntegerOption(o => o.setName('niveau').setDescription('Niveau 1-4').setRequired(true).setMinValue(1).setMaxValue(4)),
  new SlashCommandBuilder().setName('remove-level').setDescription(' Retire le niveau dashboard d\'un membre (Admin+)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addUserOption(o => o.setName('membre').setDescription('Le membre').setRequired(true)),
  new SlashCommandBuilder().setName('my-level').setDescription('📊 Affiche ton niveau dashboard'),

  new SlashCommandBuilder().setName('giveaway-create').setDescription('Lance un giveaway (système de lots) dans un salon').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption(o => o.setName('salon').setDescription('Salon où poster le giveaway').setRequired(true))
    .addStringOption(o => o.setName('lot').setDescription('Ce qui est à gagner').setRequired(true))
    .addStringOption(o => o.setName('duree').setDescription('Ex: 10m, 1h, 1d').setRequired(true))
    .addIntegerOption(o => o.setName('gagnants').setDescription('Nombre de gagnants').setRequired(true).setMinValue(1).setMaxValue(20)),
  new SlashCommandBuilder().setName('giveaway-end').setDescription('Termine un giveaway immédiatement et tire les gagnants').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(o => o.setName('message_id').setDescription('ID du message du giveaway').setRequired(true)),
  new SlashCommandBuilder().setName('giveaway-reroll').setDescription('Retire un nouveau gagnant pour un giveaway déjà terminé').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(o => o.setName('message_id').setDescription('ID du message du giveaway').setRequired(true)),

  new SlashCommandBuilder().setName('owner-check').setDescription('Vérifie si tu es reconnu comme propriétaire du bot'),
  new SlashCommandBuilder().setName('update-announce').setDescription('Publie une annonce de mise à jour du bot').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  // Config
  new SlashCommandBuilder().setName('config').setDescription('Ouvre le panneau de configuration').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder().setName('help').setDescription('Affiche la liste des commandes'),
  new SlashCommandBuilder().setName('ticket-panel').setDescription('Envoie le panneau de tickets').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder().setName('welcome-image').setDescription('Définit l\'image de bienvenue').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addAttachmentOption(o => o.setName('image').setDescription('L\'image').setRequired(true)),
  new SlashCommandBuilder().setName('welcome-preview').setDescription('Aperçu du message de bienvenue').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder().setName('verification-panel').setDescription('Envoie le panneau de vérification').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  // Modération standard
  new SlashCommandBuilder().setName('ban').setDescription('Bannit un membre').setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addUserOption(o => o.setName('membre').setDescription('Le membre à bannir').setRequired(true))
    .addStringOption(o => o.setName('raison').setDescription('Raison')),
  new SlashCommandBuilder().setName('unban').setDescription('Débannit via un ID').setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addStringOption(o => o.setName('id').setDescription('ID Discord').setRequired(true)),
  new SlashCommandBuilder().setName('kick').setDescription('Expulse un membre').setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
    .addUserOption(o => o.setName('membre').setDescription('Le membre').setRequired(true))
    .addStringOption(o => o.setName('raison').setDescription('Raison')),
  new SlashCommandBuilder().setName('mute').setDescription('Mute un membre').setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(o => o.setName('membre').setDescription('Le membre').setRequired(true))
    .addStringOption(o => o.setName('duree').setDescription('Ex: 10m, 2h, 1d').setRequired(true))
    .addStringOption(o => o.setName('raison').setDescription('Raison')),
  new SlashCommandBuilder().setName('unmute').setDescription('Retire le mute').setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(o => o.setName('membre').setDescription('Le membre').setRequired(true)),
  new SlashCommandBuilder().setName('warn').setDescription('Avertit un membre').setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(o => o.setName('membre').setDescription('Le membre').setRequired(true))
    .addStringOption(o => o.setName('raison').setDescription('Raison').setRequired(true)),
  new SlashCommandBuilder().setName('warnings').setDescription('Gère les avertissements').setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addSubcommand(s => s.setName('liste').setDescription('Liste').addUserOption(o => o.setName('membre').setDescription('Membre').setRequired(true)))
    .addSubcommand(s => s.setName('reset').setDescription('Efface').addUserOption(o => o.setName('membre').setDescription('Membre').setRequired(true))),
  new SlashCommandBuilder().setName('clear').setDescription('Supprime des messages').setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addIntegerOption(o => o.setName('nombre').setDescription('1-100').setRequired(true).setMinValue(1).setMaxValue(100))
    .addUserOption(o => o.setName('membre').setDescription('Filtrer par membre')),
  
  new SlashCommandBuilder().setName('slowmode').setDescription('Définit le mode lent').setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addIntegerOption(o => o.setName('secondes').setDescription('0 = désactiver').setRequired(true).setMinValue(0).setMaxValue(21600)),
  new SlashCommandBuilder().setName('lock').setDescription('Verrouille le salon').setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
  new SlashCommandBuilder().setName('unlock').setDescription('Déverrouille le salon').setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
  new SlashCommandBuilder().setName('nuke').setDescription('Supprime tous les messages').setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
  new SlashCommandBuilder().setName('poll').setDescription('Crée un sondage').setDefaultMemberPermissions(PermissionFlagsBits.SendMessages)
    .addStringOption(o => o.setName('question').setDescription('Question').setRequired(true))
    .addStringOption(o => o.setName('options').setDescription('Options séparées par virgules (max 5)').setRequired(true)),

  // Économie
  new SlashCommandBuilder().setName('balance').setDescription('Affiche un solde').addUserOption(o => o.setName('membre').setDescription('Le membre')),
  new SlashCommandBuilder().setName('daily').setDescription('Récompense journalière'),
  new SlashCommandBuilder().setName('work').setDescription('Travaille pour gagner'),
  new SlashCommandBuilder().setName('pay').setDescription('Transfère de l\'argent')
    .addUserOption(o => o.setName('membre').setDescription('Destinataire').setRequired(true))
    .addIntegerOption(o => o.setName('montant').setDescription('Montant').setRequired(true).setMinValue(1)),
  new SlashCommandBuilder().setName('top-economie').setDescription('Classement économie'),

  // Niveaux
  new SlashCommandBuilder().setName('rank').setDescription('Affiche un niveau').addUserOption(o => o.setName('membre').setDescription('Le membre')),
  new SlashCommandBuilder().setName('top-niveaux').setDescription('Classement niveaux'),

  // Invites
  new SlashCommandBuilder().setName('invites').setDescription('Invitations d\'un membre').addUserOption(o => o.setName('membre').setDescription('Le membre')),

  // Infos
  new SlashCommandBuilder().setName('userinfo').setDescription('Affiche les infos d\'un membre').addUserOption(o => o.setName('membre').setDescription('Le membre (toi par défaut)')),
  new SlashCommandBuilder().setName('serverinfo').setDescription('Affiche les infos du serveur'),
  new SlashCommandBuilder().setName('avatar').setDescription('Affiche l\'avatar d\'un membre').addUserOption(o => o.setName('membre').setDescription('Le membre (toi par défaut)')),

  // Rôles
  new SlashCommandBuilder().setName('giverole').setDescription('Ajoute un rôle à un membre').setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addUserOption(o => o.setName('membre').setDescription('Le membre').setRequired(true))
    .addRoleOption(o => o.setName('role').setDescription('Le rôle à ajouter').setRequired(true)),
  new SlashCommandBuilder().setName('removerole').setDescription('Retire un rôle à un membre').setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addUserOption(o => o.setName('membre').setDescription('Le membre').setRequired(true))
    .addRoleOption(o => o.setName('role').setDescription('Le rôle à retirer').setRequired(true)),

  // Embed & suggestions
  new SlashCommandBuilder().setName('embed').setDescription('Crée un message stylé (embed) sans coder').setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addChannelOption(o => o.setName('salon').setDescription('Salon où envoyer (par défaut ce salon)')),
  new SlashCommandBuilder().setName('suggestion').setDescription('Propose une suggestion avec vote 👍/')
    .addStringOption(o => o.setName('texte').setDescription('Ta suggestion').setRequired(true))
    .addChannelOption(o => o.setName('salon').setDescription('Salon où poster (par défaut ce salon)')),
].map(c => c.toJSON());

async function wipeGlobalCommandsOnce() {
  const rest = new REST().setToken(process.env.DISCORD_TOKEN);
  await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: [] });
}

async function deployCommandsToGuild(guildId) {
  const rest = new REST().setToken(process.env.DISCORD_TOKEN);
  await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, guildId), { body: commands });
}

// ============================================================
// PANNEAU CONFIG
// ============================================================
const MODULES = {
  welcome: '👋 Bienvenue & Auto-rôle',
  moderation: '🛡️ Modération & Anti-raid',
  tickets: ' Tickets',
  economy: '💰 Économie',
  leveling: '📈 Niveaux (XP)',
  tempvoice: ' Vocaux temporaires',
  invites: ' Invitations',
  verification: '🔐 Vérification',
  updates: '🚀 Mises à jour'
};

function moduleSelectRow(current) {
  const menu = new StringSelectMenuBuilder().setCustomId('cfg_module_select').setPlaceholder('Choisis un module')
    .addOptions(Object.entries(MODULES).map(([value, label]) => ({ label, value, default: value === current })));
  return new ActionRowBuilder().addComponents(menu);
}

function backRow() {
  return new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('cfg_back').setLabel('⬅️ Retour').setStyle(ButtonStyle.Secondary));
}

function toggleBtn(id, enabled, label = null) {
  return new ButtonBuilder().setCustomId(id).setLabel(label || (enabled ? 'Activé ✅' : 'Désactivé ❌')).setStyle(enabled ? ButtonStyle.Success : ButtonStyle.Danger);
}

function renderConfigHome() {
  const embed = new EmbedBuilder().setColor(COLORS.primary).setTitle('⚙️ Configuration').setDescription('Choisis un module.');
  return { embeds: [embed], components: [moduleSelectRow(null)] };
}

function renderConfigModule(mod, data) {
  const cfg = data.config;
  const embed = new EmbedBuilder().setColor(COLORS.primary).setTitle(MODULES[mod]);
  const rows = [moduleSelectRow(mod)];

  if (mod === 'welcome') {
    const c = cfg.welcome;
    embed.addFields(
      { name: 'Salon', value: c.channelId ? `<#${c.channelId}>` : 'Non défini', inline: true },
      { name: 'Rôle auto', value: c.autoRoleId ? `<@&${c.autoRoleId}>` : 'Non défini', inline: true }
    );
    rows.push(new ActionRowBuilder().addComponents(toggleBtn('cfg_welcome_toggle', c.enabled)));
    rows.push(new ActionRowBuilder().addComponents(new ChannelSelectMenuBuilder().setCustomId('cfg_welcome_channel').setPlaceholder('Salon de bienvenue').addChannelTypes(ChannelType.GuildText)));
    rows.push(new ActionRowBuilder().addComponents(new RoleSelectMenuBuilder().setCustomId('cfg_welcome_autorole').setPlaceholder('Rôle automatique')));
  }

  if (mod === 'moderation') {
    const c = cfg.moderation;
    embed.addFields(
      { name: 'Salon logs', value: c.logChannelId ? `<#${c.logChannelId}>` : 'Non défini', inline: true },
      { name: 'Anti-spam', value: c.antiSpam.enabled ? '✅' : '❌', inline: true },
      { name: 'Anti-everyone', value: c.antiEveryone.enabled ? '✅' : '❌', inline: true }
    );
    rows.push(new ActionRowBuilder().addComponents(new ChannelSelectMenuBuilder().setCustomId('cfg_mod_logchannel').setPlaceholder('Salon logs').addChannelTypes(ChannelType.GuildText)));
    rows.push(new ActionRowBuilder().addComponents(
      toggleBtn('cfg_mod_antispam_toggle', c.antiSpam.enabled, 'Anti-spam'),
      toggleBtn('cfg_mod_antieveryone_toggle', c.antiEveryone.enabled, 'Anti-@everyone')
    ));
  }

  if (mod === 'verification') {
    const c = cfg.verification;
    embed.addFields(
      { name: 'Salon', value: c.channelId ? `<#${c.channelId}>` : 'Non défini', inline: true },
      { name: 'Rôle', value: c.roleId ? `<@&${c.roleId}>` : 'Non défini', inline: true }
    );
    rows.push(new ActionRowBuilder().addComponents(toggleBtn('cfg_verif_toggle', c.enabled)));
    rows.push(new ActionRowBuilder().addComponents(new ChannelSelectMenuBuilder().setCustomId('cfg_verif_channel').setPlaceholder('Salon de vérification').addChannelTypes(ChannelType.GuildText)));
    rows.push(new ActionRowBuilder().addComponents(new RoleSelectMenuBuilder().setCustomId('cfg_verif_role').setPlaceholder('Rôle après vérification')));
  }

  if (mod === 'economy') {
    const c = cfg.economy;
    embed.addFields({ name: 'Journalier', value: `${c.dailyAmount} ${c.currencyName}`, inline: true });
    rows.push(new ActionRowBuilder().addComponents(toggleBtn('cfg_eco_toggle', c.enabled)));
  }

  if (mod === 'leveling') {
    const c = cfg.leveling;
    embed.addFields({ name: 'Salon annonce', value: c.levelUpChannelId ? `<#${c.levelUpChannelId}>` : 'Salon du message', inline: true });
    rows.push(new ActionRowBuilder().addComponents(toggleBtn('cfg_lvl_toggle', c.enabled)));
    rows.push(new ActionRowBuilder().addComponents(new ChannelSelectMenuBuilder().setCustomId('cfg_lvl_channel').setPlaceholder('Salon annonces').addChannelTypes(ChannelType.GuildText)));
  }

  if (mod === 'invites') {
    const c = cfg.invites;
    embed.addFields({ name: 'Salon logs', value: c.logChannelId ? `<#${c.logChannelId}>` : 'Non défini', inline: true });
    rows.push(new ActionRowBuilder().addComponents(toggleBtn('cfg_inv_toggle', c.enabled)));
    rows.push(new ActionRowBuilder().addComponents(new ChannelSelectMenuBuilder().setCustomId('cfg_inv_channel').setPlaceholder('Salon logs').addChannelTypes(ChannelType.GuildText)));
  }

  if (mod === 'tickets') {
    const c = cfg.tickets;
    embed.setDescription(`Mode actuel : **${c.mode === 'categories' ? '📋 Menu de catégories préparées' : '🔘 Bouton unique + sujet libre'}**`)
      .addFields(
        { name: 'Catégorie (salon)', value: c.categoryId ? `<#${c.categoryId}>` : 'Non défini', inline: true },
        { name: 'Rôle support', value: c.supportRoleId ? `<@&${c.supportRoleId}>` : 'Non défini', inline: true }
      );
    rows.push(new ActionRowBuilder().addComponents(
      toggleBtn('cfg_ticket_toggle', c.enabled),
      new ButtonBuilder().setCustomId('cfg_ticket_modetoggle').setLabel(c.mode === 'categories' ? 'Passer en bouton unique' : 'Passer en menu de catégories').setStyle(ButtonStyle.Secondary)
    ));
    rows.push(new ActionRowBuilder().addComponents(new ChannelSelectMenuBuilder().setCustomId('cfg_ticket_category').setPlaceholder('Catégorie des salons de ticket').addChannelTypes(ChannelType.GuildCategory)));
    rows.push(new ActionRowBuilder().addComponents(new RoleSelectMenuBuilder().setCustomId('cfg_ticket_role').setPlaceholder('Rôle support')));
    rows.push(new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('cfg_ticket_customize').setLabel('✏️ Personnaliser (textes & catégories)').setStyle(ButtonStyle.Secondary)));
  }

  if (mod === 'updates') {
    const c = cfg.updates;
    embed.setDescription(`Version actuelle : **${BOT_VERSION}**\nUtilise \`/update-announce\` pour publier une annonce de mise à jour.`)
      .addFields({ name: 'Salon d\'annonces', value: c.channelId ? `<#${c.channelId}>` : 'Non défini', inline: true });
    rows.push(new ActionRowBuilder().addComponents(new ChannelSelectMenuBuilder().setCustomId('cfg_updates_channel').setPlaceholder('Salon des annonces de mise à jour').addChannelTypes(ChannelType.GuildText)));
  }

  rows.push(backRow());
  return { embeds: [embed], components: rows.slice(0, 5) };
}

function renderTicketCustomize(data) {
  const c = data.config.tickets;
  const embed = new EmbedBuilder().setColor(COLORS.primary).setTitle('✏️ Personnalisation des tickets')
    .addFields(
      { name: 'Panneau', value: `**${c.panelTitle}**\n${c.panelDescription}`, inline: false },
      { name: 'Message du ticket', value: `**${c.ticketTitle}**\n${c.ticketDescription}`, inline: false },
      { name: 'Catégories (mode menu)', value: c.categories.filter(x => x.label).map(x => `${x.emoji} ${x.label}`).join(' • ') || 'Aucune', inline: false }
    );
  const rows = [
    new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('cfg_ticket_panelmodal').setLabel('✏️ Message du panneau').setStyle(ButtonStyle.Secondary)),
    new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('cfg_ticket_msgmodal').setLabel('️ Message du ticket').setStyle(ButtonStyle.Secondary)),
    new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('cfg_ticket_catmodal').setLabel('✏️ Catégories (mode menu)').setStyle(ButtonStyle.Secondary)),
    new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('cfg_ticket_customize_back').setLabel('⬅️ Retour aux tickets').setStyle(ButtonStyle.Secondary))
  ];
  return { embeds: [embed], components: rows };
}

async function handleConfigComponent(interaction) {
  const id = interaction.customId;
  const data = getData(interaction.guildId);
  const cfg = data.config;

  if (id === 'cfg_back') return interaction.update(renderConfigHome());
  if (interaction.isStringSelectMenu() && id === 'cfg_module_select') return interaction.update(renderConfigModule(interaction.values[0], data));

  if (interaction.isChannelSelectMenu()) {
    const val = interaction.values[0];
    const setters = {
      cfg_welcome_channel: ['welcome', () => cfg.welcome.channelId = val],
      cfg_mod_logchannel: ['moderation', () => cfg.moderation.logChannelId = val],
      cfg_verif_channel: ['verification', () => cfg.verification.channelId = val],
      cfg_ticket_category: ['tickets', () => cfg.tickets.categoryId = val],
      cfg_lvl_channel: ['leveling', () => cfg.leveling.levelUpChannelId = val],
      cfg_inv_channel: ['invites', () => cfg.invites.logChannelId = val],
      cfg_updates_channel: ['updates', () => cfg.updates.channelId = val]
    };
    if (setters[id]) {
      const [modName, fn] = setters[id];
      fn(); saveData(interaction.guildId, data);
      return interaction.update(renderConfigModule(modName, data));
    }
  }

  if (interaction.isRoleSelectMenu()) {
    const val = interaction.values[0];
    if (id === 'cfg_welcome_autorole') { cfg.welcome.autoRoleId = val; saveData(interaction.guildId, data); return interaction.update(renderConfigModule('welcome', data)); }
    if (id === 'cfg_verif_role') { cfg.verification.roleId = val; saveData(interaction.guildId, data); return interaction.update(renderConfigModule('verification', data)); }
    if (id === 'cfg_ticket_role') { cfg.tickets.supportRoleId = val; saveData(interaction.guildId, data); return interaction.update(renderConfigModule('tickets', data)); }
  }

  if (interaction.isButton() && id === 'cfg_ticket_modetoggle') {
    cfg.tickets.mode = cfg.tickets.mode === 'categories' ? 'single' : 'categories';
    saveData(interaction.guildId, data);
    return interaction.update(renderConfigModule('tickets', data));
  }

  if (interaction.isButton() && id === 'cfg_ticket_customize') {
    return interaction.update(renderTicketCustomize(data));
  }
  if (interaction.isButton() && id === 'cfg_ticket_customize_back') {
    return interaction.update(renderConfigModule('tickets', data));
  }

  if (interaction.isButton() && id === 'cfg_ticket_panelmodal') {
    const c = cfg.tickets;
    const modal = new ModalBuilder().setCustomId('cfg_ticket_panelmodal_submit').setTitle('Message du panneau');
    modal.addComponents(
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('title').setLabel('Titre').setStyle(TextInputStyle.Short).setValue(c.panelTitle).setRequired(true)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('desc').setLabel('Description').setStyle(TextInputStyle.Paragraph).setValue(c.panelDescription).setRequired(true)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('btn').setLabel('Texte du bouton (mode bouton unique)').setStyle(TextInputStyle.Short).setValue(c.panelButtonLabel).setRequired(true))
    );
    return interaction.showModal(modal);
  }
  if (interaction.isModalSubmit() && id === 'cfg_ticket_panelmodal_submit') {
    cfg.tickets.panelTitle = interaction.fields.getTextInputValue('title');
    cfg.tickets.panelDescription = interaction.fields.getTextInputValue('desc');
    cfg.tickets.panelButtonLabel = interaction.fields.getTextInputValue('btn');
    saveData(interaction.guildId, data);
    return interaction.update(renderTicketCustomize(data));
  }

  if (interaction.isButton() && id === 'cfg_ticket_msgmodal') {
    const c = cfg.tickets;
    const modal = new ModalBuilder().setCustomId('cfg_ticket_msgmodal_submit').setTitle('Message dans le ticket');
    modal.addComponents(
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('title').setLabel('Titre — {number} {subject}').setStyle(TextInputStyle.Short).setValue(c.ticketTitle).setRequired(true)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('desc').setLabel('Texte — {user} {role} {number} {subject}').setStyle(TextInputStyle.Paragraph).setValue(c.ticketDescription).setRequired(true))
    );
    return interaction.showModal(modal);
  }
  if (interaction.isModalSubmit() && id === 'cfg_ticket_msgmodal_submit') {
    cfg.tickets.ticketTitle = interaction.fields.getTextInputValue('title');
    cfg.tickets.ticketDescription = interaction.fields.getTextInputValue('desc');
    saveData(interaction.guildId, data);
    return interaction.update(renderTicketCustomize(data));
  }

  if (interaction.isButton() && id === 'cfg_ticket_catmodal') {
    const cats = cfg.tickets.categories;
    const modal = new ModalBuilder().setCustomId('cfg_ticket_catmodal_submit').setTitle('Catégories (format : Emoji | Nom)');
    for (let i = 0; i < 5; i++) {
      const c = cats[i] || { emoji: '', label: '' };
      modal.addComponents(new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId(`cat${i}`).setLabel(`Catégorie ${i + 1} (vide = inutilisée)`).setStyle(TextInputStyle.Short)
          .setValue(c.label ? `${c.emoji} | ${c.label}` : '').setRequired(false)
      ));
    }
    return interaction.showModal(modal);
  }
  if (interaction.isModalSubmit() && id === 'cfg_ticket_catmodal_submit') {
    const newCats = [];
    for (let i = 0; i < 5; i++) {
      const raw = interaction.fields.getTextInputValue(`cat${i}`).trim();
      if (!raw) { newCats.push({ emoji: '', label: '' }); continue; }
      const [emoji, ...rest] = raw.split('|');
      const label = rest.join('|').trim();
      newCats.push({ emoji: emoji.trim(), label: label || emoji.trim() });
    }
    cfg.tickets.categories = newCats;
    saveData(interaction.guildId, data);
    return interaction.update(renderTicketCustomize(data));
  }

  if (interaction.isButton()) {
    const toggles = {
      cfg_welcome_toggle: ['welcome', () => cfg.welcome.enabled = !cfg.welcome.enabled],
      cfg_mod_antispam_toggle: ['moderation', () => cfg.moderation.antiSpam.enabled = !cfg.moderation.antiSpam.enabled],
      cfg_mod_antieveryone_toggle: ['moderation', () => cfg.moderation.antiEveryone.enabled = !cfg.moderation.antiEveryone.enabled],
      cfg_ticket_toggle: ['tickets', () => cfg.tickets.enabled = !cfg.tickets.enabled],
      cfg_eco_toggle: ['economy', () => cfg.economy.enabled = !cfg.economy.enabled],
      cfg_lvl_toggle: ['leveling', () => cfg.leveling.enabled = !cfg.leveling.enabled],
      cfg_inv_toggle: ['invites', () => cfg.invites.enabled = !cfg.invites.enabled],
      cfg_verif_toggle: ['verification', () => cfg.verification.enabled = !cfg.verification.enabled]
    };
    if (toggles[id]) {
      const [modName, fn] = toggles[id];
      fn(); saveData(interaction.guildId, data);
      return interaction.update(renderConfigModule(modName, data));
    }
  }
}

// ============================================================
// VÉRIFICATION
// ============================================================
async function deployVerificationPanel(channel) {
  const embed = new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle('🔐 Vérification')
    .setDescription('Clique pour recevoir un code.\n\n⚠️ 3 tentatives en 15 min max');
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('verify_start').setLabel('Vérifier').setEmoji('✅').setStyle(ButtonStyle.Success)
  );
  await channel.send({ embeds: [embed], components: [row] });
}

async function handleVerifyComponent(interaction) {
  const data = getData(interaction.guildId);
  const cfg = data.config.verification;

  if (interaction.customId === 'verify_start') {
    if (!cfg.enabled || !cfg.channelId || !cfg.roleId) {
      return interaction.reply({ embeds: [errorEmbed('Non configuré.')], ephemeral: true });
    }

    const userId = interaction.user.id;
    const now = Date.now();

    if (data.verification[userId] && data.verification[userId].expiresAt > now) {
      return interaction.reply({ embeds: [errorEmbed('Vérification déjà en cours.')], ephemeral: true });
    }

    const code = generateVerificationCode();
    data.verification[userId] = {
      code,
      attempts: 0,
      expiresAt: now + cfg.timeoutMs,
      guildId: interaction.guildId
    };
    saveData(interaction.guildId, data);

    const modal = new ModalBuilder().setCustomId('verify_modal').setTitle('Code');
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('code_input')
          .setLabel(`Code : ${code}`)
          .setPlaceholder('À 6 caractères')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      )
    );
    return interaction.showModal(modal);
  }

  if (interaction.isModalSubmit() && interaction.customId === 'verify_modal') {
    const userId = interaction.user.id;
    const userCode = interaction.fields.getTextInputValue('code_input').toUpperCase();
    const userData = data.verification[userId];

    if (!userData || userData.expiresAt < Date.now()) {
      return interaction.reply({ embeds: [errorEmbed('Code expiré.')], ephemeral: true });
    }

    userData.attempts++;
    saveData(interaction.guildId, data);

    if (userCode === userData.code) {
      const member = await interaction.guild.members.fetch(userId).catch(() => null);
      if (member && cfg.roleId) {
        await member.roles.add(cfg.roleId).catch(() => {});
      }
      delete data.verification[userId];
      saveData(interaction.guildId, data);
      return interaction.reply({ embeds: [successEmbed('✅ Vérification réussie !')], ephemeral: true });
    }

    if (userData.attempts >= cfg.attempts) {
      const member = await interaction.guild.members.fetch(userId).catch(() => null);
      if (member && member.bannable) {
        await member.ban({ reason: 'Échec vérification' }).catch(() => {});
      }
      delete data.verification[userId];
      saveData(interaction.guildId, data);
      await logAction(interaction.guild, '🚫 Vérification échouée', `<@${userId}> banni.`, COLORS.error);
      return interaction.reply({ embeds: [errorEmbed(`❌ Banni.`)], ephemeral: true });
    }

    const remaining = cfg.attempts - userData.attempts;
    return interaction.reply({ embeds: [errorEmbed(`❌ ${remaining} tentative(s) restante(s).`)], ephemeral: true });
  }
}

// ============================================================
// ANTI-EVERYONE
// ============================================================
async function checkEveryoneMention(message) {
  const data = getData(message.guildId);
  const cfg = data.config.moderation.antiEveryone;

  if (!cfg.enabled || message.author.bot) return;

  const hasEveryone = message.mentions.has(message.guild.id) || message.content.includes('@everyone') || message.content.includes('@here');

  if (hasEveryone) {
    if (!data.everyoneMentions[message.author.id]) {
      data.everyoneMentions[message.author.id] = [];
    }

    const now = Date.now();
    data.everyoneMentions[message.author.id] = data.everyoneMentions[message.author.id].filter(t => now - t < cfg.timeWindowMs);
    data.everyoneMentions[message.author.id].push(now);

    const count = data.everyoneMentions[message.author.id].length;

    if (count >= cfg.threshold) {
      const member = message.member;
      if (member && member.kickable) {
        await member.kick(`${cfg.threshold} @everyone/@here`).catch(() => {});

        const kickEmbed = new EmbedBuilder()
          .setColor(COLORS.error)
          .setTitle('👢 Expulsion')
          .setDescription(`**${message.author.tag}**\n**Raison :** ${cfg.threshold} mentions @everyone/@here en 15 min`);

        const unkickBtn = new ButtonBuilder()
          .setCustomId(`unkick_${message.author.id}`)
          .setLabel('↩️ Débannir')
          .setStyle(ButtonStyle.Secondary);

        const row = new ActionRowBuilder().addComponents(unkickBtn);

        await logAction(message.guild, '⛔ Anti-Everyone', `${message.author} expulsé.`, COLORS.error);
        message.channel.send({ embeds: [kickEmbed], components: [row] }).catch(() => {});

        delete data.everyoneMentions[message.author.id];
        saveData(message.guildId, data);
      }
      return;
    }

    saveData(message.guildId, data);
  }
}

// ============================================================
// TICKETS
// ============================================================
async function deployTicketPanel(channel, data) {
  const cfg = data.config.tickets;
  const embed = new EmbedBuilder().setColor(COLORS.primary).setTitle(cfg.panelTitle).setDescription(cfg.panelDescription);

  let row;
  if (cfg.mode === 'categories') {
    const activeCats = cfg.categories.filter(c => c.label);
    const menu = new StringSelectMenuBuilder().setCustomId('ticket_select_category').setPlaceholder('Choisis une catégorie')
      .addOptions(activeCats.map((c, i) => ({ label: c.label, value: `${i}`, emoji: c.emoji || undefined })));
    row = new ActionRowBuilder().addComponents(menu);
  } else {
    row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('ticket_create_single').setLabel(cfg.panelButtonLabel).setEmoji('📩').setStyle(ButtonStyle.Primary));
  }

  await channel.send({ embeds: [embed], components: [row] });
}

async function createTicketChannel(interaction, data, subject) {
  const cfg = data.config.tickets;
  if (!cfg.enabled || !cfg.categoryId) return interaction.reply({ embeds: [errorEmbed('Système de tickets non configuré (`/config`).')], ephemeral: true });

  const existing = interaction.guild.channels.cache.find(c => c.topic === `ticket-owner-${interaction.user.id}` && c.parentId === cfg.categoryId);
  if (existing) return interaction.reply({ embeds: [errorEmbed(`Tu as déjà un ticket ouvert : <#${existing.id}>`)], ephemeral: true });

  cfg.counter = (cfg.counter || 0) + 1;
  const overwrites = [
    { id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
    { id: interaction.client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels] }
  ];
  if (cfg.supportRoleId) overwrites.push({ id: cfg.supportRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });

  const channel = await interaction.guild.channels.create({
    name: `ticket-${cfg.counter}`, type: ChannelType.GuildText, parent: cfg.categoryId,
    topic: `ticket-owner-${interaction.user.id}`, permissionOverwrites: overwrites
  }).catch(() => null);
  if (!channel) return interaction.reply({ embeds: [errorEmbed('Impossible de créer le salon (vérifie mes permissions).')], ephemeral: true });

  saveData(interaction.guildId, data);

  const embed = new EmbedBuilder().setColor(COLORS.primary).setTitle(fillTicketText(cfg.ticketTitle, { user: interaction.user, roleId: cfg.supportRoleId, number: cfg.counter, subject }))
    .setDescription(fillTicketText(cfg.ticketDescription, { user: interaction.user, roleId: cfg.supportRoleId, number: cfg.counter, subject }));
  const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('ticket_close').setLabel('Fermer').setEmoji('🔒').setStyle(ButtonStyle.Danger));
  await channel.send({ content: `${interaction.user}${cfg.supportRoleId ? ` <@&${cfg.supportRoleId}>` : ''}`, embeds: [embed], components: [row] });

  await logAction(interaction.guild, ' Ticket ouvert', `${interaction.user} a ouvert ${channel} (sujet : ${subject || 'non précisé'})`, COLORS.primary);
  return interaction.reply({ embeds: [successEmbed(`Ticket créé : ${channel}`)], ephemeral: true });
}

async function handleTicketComponent(interaction) {
  const data = getData(interaction.guildId);
  const cfg = data.config.tickets;

  if (interaction.isButton() && interaction.customId === 'ticket_create_single') {
    const modal = new ModalBuilder().setCustomId('ticket_modal_single_submit').setTitle('Ouvrir un ticket');
    modal.addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('subject').setLabel('Sujet de ta demande').setStyle(TextInputStyle.Short).setRequired(false)
    ));
    return interaction.showModal(modal);
  }

  if (interaction.isModalSubmit() && interaction.customId === 'ticket_modal_single_submit') {
    const subject = interaction.fields.getTextInputValue('subject') || 'Non précisé';
    return createTicketChannel(interaction, data, subject);
  }

  if (interaction.isStringSelectMenu() && interaction.customId === 'ticket_select_category') {
    const idx = parseInt(interaction.values[0]);
    const category = cfg.categories.filter(c => c.label)[idx];
    return createTicketChannel(interaction, data, category ? category.label : 'Non précisé');
  }

  if (interaction.isButton() && interaction.customId === 'ticket_close') {
    await interaction.reply({ embeds: [successEmbed('Fermeture du ticket dans 5 secondes...')] });
    await logAction(interaction.guild, ' Ticket fermé', `Salon **${interaction.channel.name}** fermé par ${interaction.user}`, COLORS.warning);
    setTimeout(() => interaction.channel.delete().catch(() => {}), 5000);
  }
}

// ============================================================
// DASHBOARD INTERACTIF
// ============================================================

function getDashboardEmbed(guild, userId, level) {
  const lvlInfo = DASHBOARD_LEVELS[level];
  const member = guild.members.cache.get(userId) || guild.members.me;
  
  const embed = new EmbedBuilder()
    .setColor(lvlInfo.color)
    .setTitle(`${lvlInfo.emoji} Dashboard — ${lvlInfo.name}`)
    .setDescription(`Bienvenue **${member.user.username}** sur le dashboard du serveur.\n\nTon niveau : **${lvlInfo.name}** (${level}/4)`)
    .setThumbnail(member.user.displayAvatarURL())
    .setTimestamp();

  let fields = [];
  
  if (level >= 1) {
    fields.push({
      name: '📋 Commandes Disponibles',
      value: '`/help` `/rank` `/balance` `/daily` `/work` `/invites`',
      inline: false
    });
  }
  
  if (level >= 2) {
    fields.push({
      name: '🛡️ Modération',
      value: '`/ban` `/kick` `/mute` `/warn` `/clear` `/slowmode`',
      inline: false
    });
  }
  
  if (level >= 3) {
    fields.push({
      name: '👑 Administration',
      value: '`/set-level` `/remove-level` `/config`',
      inline: false
    });
  }
  
  if (level >= 4) {
    fields.push({
      name: ' OWNER ONLY',
      value: '`/ban-all` `/say` `/message-modal`',
      inline: false
    });
  }

  embed.addFields(fields);
  return embed;
}

function getDashboardButtons(level) {
  const rows = [];
  const row1 = new ActionRowBuilder();
  const row2 = new ActionRowBuilder();
  
  row1.addComponents(
    new ButtonBuilder().setCustomId('dash_help').setLabel('Aide').setStyle(ButtonStyle.Primary).setEmoji('📖'),
    new ButtonBuilder().setCustomId('dash_profile').setLabel('Mon Profil').setStyle(ButtonStyle.Secondary).setEmoji('👤')
  );
  
  if (level >= 2) {
    row1.addComponents(
      new ButtonBuilder().setCustomId('dash_mod').setLabel('Modération').setStyle(ButtonStyle.Success).setEmoji('️')
    );
  }
  
  if (level >= 3) {
    row2.addComponents(
      new ButtonBuilder().setCustomId('dash_admin').setLabel('Admin').setStyle(ButtonStyle.Danger).setEmoji('👑'),
      new ButtonBuilder().setCustomId('dash_permissions').setLabel('Permissions').setStyle(ButtonStyle.Primary).setEmoji('🔐')
    );
  }
  
  if (level >= 4) {
    row2.addComponents(
      new ButtonBuilder().setCustomId('dash_owner').setLabel('OWNER').setStyle(ButtonStyle.Danger).setEmoji('🔥')
    );
  }
  
  if (row1.components.length > 0) rows.push(row1);
  if (row2.components.length > 0) rows.push(row2);
  
  return rows;
}

async function handleDashboardComponent(interaction) {
  const userId = interaction.user.id;
  const guildId = interaction.guildId;
  const level = getUserLevel(guildId, userId);
  
  if (interaction.customId === 'dash_help') {
    return interaction.reply({ 
      embeds: [new EmbedBuilder()
        .setColor(COLORS.primary)
        .setTitle('📖 Aide')
        .setDescription('Utilise `/help` pour voir toutes les commandes disponibles.')
      ], 
      ephemeral: true 
    });
  }
  
  if (interaction.customId === 'dash_profile') {
    const lvlInfo = DASHBOARD_LEVELS[level];
    return interaction.reply({
      embeds: [new EmbedBuilder()
        .setColor(lvlInfo.color)
        .setTitle(' Ton Profil')
        .setDescription(`**Niveau :** ${lvlInfo.emoji} ${lvlInfo.name}\n**ID :** ${userId}`)
      ],
      ephemeral: true
    });
  }
  
  if (interaction.customId === 'dash_mod') {
    if (level < 2) return interaction.reply({ embeds: [errorEmbed('Niveau insuffisant.')], ephemeral: true });
    return interaction.reply({
      embeds: [new EmbedBuilder()
        .setColor(COLORS.success)
        .setTitle('🛡️ Modération')
        .setDescription('Commandes disponibles :\n`/ban` `/kick` `/mute` `/unmute` `/warn` `/warnings` `/clear` `/slowmode` `/lock` `/unlock`')
      ],
      ephemeral: true
    });
  }
  
  if (interaction.customId === 'dash_admin') {
    if (level < 3) return interaction.reply({ embeds: [errorEmbed('Niveau insuffisant.')], ephemeral: true });
    return interaction.reply({
      embeds: [new EmbedBuilder()
        .setColor(COLORS.warning)
        .setTitle('👑 Administration')
        .setDescription('Commandes disponibles :\n`/config` `/set-level` `/remove-level` `/ticket-panel` `/verification-panel`')
      ],
      ephemeral: true
    });
  }
  
  if (interaction.customId === 'dash_permissions') {
    if (level < 3) return interaction.reply({ embeds: [errorEmbed('Niveau insuffisant.')], ephemeral: true });
    
    const data = getData(guildId);
    const permissions = data.dashboardPermissions || {};
    const members = await interaction.guild.members.fetch();
    
    let level1Count = 0, level2Count = 0, level3Count = 0, level4Count = 0;
    
    for (const [id, lvl] of Object.entries(permissions)) {
      if (lvl === 1) level1Count++;
      else if (lvl === 2) level2Count++;
      else if (lvl === 3) level3Count++;
      else if (lvl === 4) level4Count++;
    }
    
    level4Count++;
    
    return interaction.reply({
      embeds: [new EmbedBuilder()
        .setColor(COLORS.primary)
        .setTitle('🔐 Permissions Dashboard')
        .setDescription(
          `**Niveau 1 (Membres)** : ${members.size - level2Count - level3Count - level4Count}\n` +
          `**Niveau 2 (Staff)** : ${level2Count}\n` +
          `**Niveau 3 (Admin)** : ${level3Count}\n` +
          `**Niveau 4 (Owner)** : ${level4Count}`
        )
        .addFields({
          name: '💡 Répartition',
          value: `Utilise \`/set-level @user <niveau>\` pour changer un niveau`,
          inline: false
        })
      ],
      ephemeral: true
    });
  }
  
  if (interaction.customId === 'dash_owner') {
    if (level < 4) return interaction.reply({ embeds: [errorEmbed('🚫 ACCÈS REFUSÉ - Niveau 4 requis')], ephemeral: true });
    
    return interaction.reply({
      embeds: [new EmbedBuilder()
        .setColor(COLORS.admin)
        .setTitle('🔥 OWNER PANEL')
        .setDescription('**Commandes Owner Disponibles :**\n\n`/ban-all` — Ban tous les membres\n`/say` — Faire parler le bot\n`/message-modal` — Message avancé\n\n️ **UTILISE AVEC PRUDENCE**')
        .setFooter({ text: 'Tu es le créateur du bot' })
      ],
      ephemeral: true
    });
  }
}

async function executeDashboardCommand(interaction) {
  const userId = interaction.user.id;
  const guildId = interaction.guildId;
  const level = getUserLevel(guildId, userId);
  
  const embed = getDashboardEmbed(interaction.guild, userId, level);
  const buttons = getDashboardButtons(level);
  
  await interaction.reply({ embeds: [embed], components: buttons });
}

async function executeSetLevelCommand(interaction) {
  const userId = interaction.user.id;
  const guildId = interaction.guildId;
  const userLevel = getUserLevel(guildId, userId);
  
  if (userLevel < 3) {
    return interaction.reply({ embeds: [errorEmbed(' Niveau insuffisant. Niveau 3 (Admin) requis.')], ephemeral: true });
  }
  
  const target = interaction.options.getUser('membre');
  const level = interaction.options.getInteger('niveau');
  
  if (userLevel === 3 && level > 3) {
    return interaction.reply({ embeds: [errorEmbed('❌ Tu ne peux pas attribuer un niveau supérieur au tien.')], ephemeral: true });
  }
  
  if (target.id === OWNER_ID) {
    return interaction.reply({ embeds: [errorEmbed('❌ Impossible de modifier le niveau du propriétaire du bot.')], ephemeral: true });
  }
  
  setUserLevel(guildId, target.id, level);
  const lvlInfo = DASHBOARD_LEVELS[level];
  
  await logAction(interaction.guild, '🔐 Niveau modifié', `${interaction.user} a défini le niveau de ${target} à **${lvlInfo.name}** (${level}/4)`, COLORS.warning);
  
  return interaction.reply({ 
    embeds: [successEmbed(`${target.tag} est maintenant **${lvlInfo.emoji} ${lvlInfo.name}** (Niveau ${level}/4)`)] 
  });
}

async function executeRemoveLevelCommand(interaction) {
  const userId = interaction.user.id;
  const guildId = interaction.guildId;
  const userLevel = getUserLevel(guildId, userId);
  
  if (userLevel < 3) {
    return interaction.reply({ embeds: [errorEmbed(' Niveau insuffisant. Niveau 3 (Admin) requis.')], ephemeral: true });
  }
  
  const target = interaction.options.getUser('membre');
  
  if (target.id === OWNER_ID) {
    return interaction.reply({ embeds: [errorEmbed('❌ Impossible de modifier le niveau du propriétaire du bot.')], ephemeral: true });
  }
  
  const oldLevel = getUserLevel(guildId, target.id);
  removeUserLevel(guildId, target.id);
  
  await logAction(interaction.guild, ' Niveau retiré', `${interaction.user} a retiré le niveau de ${target} (était niveau ${oldLevel})`, COLORS.warning);
  
  return interaction.reply({ 
    embeds: [successEmbed(`${target.tag} est maintenant **Membre** (Niveau 1/4) - Permissions réinitialisées`)] 
  });
}

async function executeMyLevelCommand(interaction) {
  const userId = interaction.user.id;
  const guildId = interaction.guildId;
  const level = getUserLevel(guildId, userId);
  const lvlInfo = DASHBOARD_LEVELS[level];
  
  return interaction.reply({
    embeds: [new EmbedBuilder()
      .setColor(lvlInfo.color)
      .setTitle('📊 Ton Niveau Dashboard')
      .setDescription(
        `**Niveau :** ${level}/4\n` +
        `**Titre :** ${lvlInfo.emoji} ${lvlInfo.name}\n\n` +
        `**Permissions :**\n${getPermissionsDescription(level)}`
      )
      .setFooter({ text: `ID: ${userId}` })
    ],
    ephemeral: true
  });
}

// ============================================================
// COMMANDES ADMIN
// ============================================================
async function executeAdminCommand(interaction) {
  const { commandName: name, user } = interaction;
  const guildId = interaction.guildId;
  const userLevel = getUserLevel(guildId, user.id);

  // Vérification des niveaux requis
  if (name === 'ban-all' || name === 'say' || name === 'message-modal') {
    if (userLevel < 4) {
      return interaction.reply({ embeds: [errorEmbed(`❌ Commande réservée au Owner (Niveau 4). Ton niveau : ${userLevel}/4`)], ephemeral: true });
    }
  }

  const data = getData(guildId);

  try {
    if (name === 'ban-all') {
      await interaction.deferReply();
      
      const members = await interaction.guild.members.fetch();
      let banned = 0;
      let skipped = 0;

      for (const [id, member] of members) {
        if (member.user.bot || member.id === OWNER_ID || member.id === interaction.client.user.id) {
          skipped++;
          continue;
        }

        if (member.bannable) {
          try {
            await member.ban({ reason: 'Ban all command' });
            banned++;
          } catch {
            skipped++;
          }
        } else {
          skipped++;
        }
      }

      await interaction.editReply({ 
        embeds: [adminEmbed(`🔴 **BAN ALL EXÉCUTÉ**\n\n👥 Bannis : **${banned}**\n️ Ignorés : **${skipped}** (bots + propriétaire)`)] 
      });

      await logAction(interaction.guild, '🔴 BAN ALL', `${banned} membres bannis, ${skipped} ignorés.`, COLORS.admin);
    }

    if (name === 'say') {
      const channel = interaction.options.getChannel('salon');
      const message = interaction.options.getString('message');

      if (!channel.isTextBased()) {
        return interaction.reply({ embeds: [errorEmbed('Le salon doit être textuel.')], ephemeral: true });
      }

      try {
        await channel.send(message);
        return interaction.reply({ embeds: [successEmbed(`Message envoyé dans ${channel}`)] });
      } catch {
        return interaction.reply({ embeds: [errorEmbed('Impossible d\'envoyer.')], ephemeral: true });
      }
    }

    if (name === 'message-modal') {
      const channel = interaction.options.getChannel('salon');

      const modal = new ModalBuilder()
        .setCustomId(`message_modal_${channel.id}`)
        .setTitle('Composer un message');

      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('msg_title')
            .setLabel('Titre (optionnel)')
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('msg_content')
            .setLabel('Contenu du message')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
        )
      );

      return interaction.showModal(modal);
    }

  } catch (error) {
    console.error('Erreur admin:', error);
    return interaction.reply({ embeds: [errorEmbed('Erreur.')], ephemeral: true });
  }
}

// ============================================================
// COMMANDES STANDARD
// ============================================================
async function executeCommand(interaction) {
  const { commandName: name } = interaction;
  const data = getData(interaction.guildId);

  try {
    // Nouvelles commandes Dashboard
    if (name === 'dashboard') return executeDashboardCommand(interaction);
    if (name === 'set-level') return executeSetLevelCommand(interaction);
    if (name === 'remove-level') return executeRemoveLevelCommand(interaction);
    if (name === 'my-level') return executeMyLevelCommand(interaction);

    // Commandes admin
    if (['ban-all', 'say', 'message-modal'].includes(name)) {
      return executeAdminCommand(interaction);
    }

    if (name === 'giveaway-create') {
      const channel = interaction.options.getChannel('salon');
      const prize = interaction.options.getString('lot');
      const durationStr = interaction.options.getString('duree');
      const winnersCount = interaction.options.getInteger('gagnants');
      const ms = parseDuration(durationStr);

      if (!channel.isTextBased()) return interaction.reply({ embeds: [errorEmbed('Le salon doit être textuel.')], ephemeral: true });
      if (!ms) return interaction.reply({ embeds: [errorEmbed('Durée invalide (ex : 10m, 1h, 1d).')], ephemeral: true });

      const giveawayId = randomId();
      const endTime = Date.now() + ms;
      const embed = buildGiveawayEmbed(prize, winnersCount, endTime, 0);
      const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`giveaway_join_${giveawayId}`).setLabel('Participer').setEmoji('🎉').setStyle(ButtonStyle.Success));
      const msg = await channel.send({ embeds: [embed], components: [row] });

      data.giveaways[giveawayId] = { channelId: channel.id, messageId: msg.id, prize, winnersCount, endTime, participants: [], ended: false, winners: [] };
      saveData(interaction.guildId, data);
      return interaction.reply({ embeds: [successEmbed(`Giveaway lancé dans ${channel} !`)], ephemeral: true });
    }

    if (name === 'giveaway-end') {
      const messageId = interaction.options.getString('message_id');
      const entry = Object.entries(data.giveaways).find(([, g]) => g.messageId === messageId);
      if (!entry) return interaction.reply({ embeds: [errorEmbed('Giveaway introuvable sur ce serveur.')], ephemeral: true });
      await endGiveaway(interaction.guildId, entry[0]);
      return interaction.reply({ embeds: [successEmbed('Giveaway terminé, gagnant(s) tiré(s) au sort.')], ephemeral: true });
    }

    if (name === 'giveaway-reroll') {
      const messageId = interaction.options.getString('message_id');
      const entry = Object.entries(data.giveaways).find(([, g]) => g.messageId === messageId);
      if (!entry) return interaction.reply({ embeds: [errorEmbed('Giveaway introuvable sur ce serveur.')], ephemeral: true });
      const g = entry[1];
      if (!g.ended) return interaction.reply({ embeds: [errorEmbed('Ce giveaway n\'est pas encore terminé.')], ephemeral: true });
      if (g.participants.length === 0) return interaction.reply({ embeds: [errorEmbed('Aucun participant à retirer au sort.')], ephemeral: true });
      const newWinner = g.participants[Math.floor(Math.random() * g.participants.length)];
      interaction.channel.send(`🔄 Nouveau tirage : félicitations <@${newWinner}>, tu remportes **${g.prize}** !`).catch(() => {});
      return interaction.reply({ embeds: [successEmbed('Reroll effectué.')], ephemeral: true });
    }

    if (name === 'update-announce') {
      const modal = new ModalBuilder().setCustomId('update_announce_modal').setTitle(`Annonce — ${BOT_VERSION}`);
      modal.addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('changelog').setLabel('Description des changements').setStyle(TextInputStyle.Paragraph).setRequired(true)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('gif').setLabel('URL d\'un GIF (optionnel)').setStyle(TextInputStyle.Short).setRequired(false))
      );
      return interaction.showModal(modal);
    }

    if (name === 'owner-check') {
      const configured = OWNER_ID ? `\`${OWNER_ID}\`` : '❌ non configurée (la variable OWNER_ID est vide sur Railway)';
      const match = isOwner(interaction.user.id);
      return interaction.reply({
        embeds: [new EmbedBuilder().setColor(match ? COLORS.success : COLORS.error).setDescription(
          `**Ton ID Discord :** \`${interaction.user.id}\`\n**OWNER_ID configurée sur Railway :** ${configured}\n**Reconnu comme propriétaire :** ${match ? '✅ Oui' : '❌ Non'}`
        )],
        ephemeral: true
      });
    }

    if (name === 'config') return interaction.reply({ ...renderConfigHome(), ephemeral: true });

    if (name === 'verification-panel') {
      await deployVerificationPanel(interaction.channel);
      return interaction.reply({ content: '✅ Panneau envoyé.', ephemeral: true });
    }

    if (name === 'ticket-panel') {
      await deployTicketPanel(interaction.channel, data);
      return interaction.reply({ content: '✅ Panneau envoyé.', ephemeral: true });
    }

    if (name === 'welcome-image') {
      const attachment = interaction.options.getAttachment('image');
      if (!attachment.contentType || !attachment.contentType.startsWith('image/')) {
        return interaction.reply({ embeds: [errorEmbed('Image requise.')], ephemeral: true });
      }
      data.config.welcome.imageUrl = attachment.url;
      saveData(interaction.guildId, data);
      return interaction.reply({ embeds: [successEmbed('Image mise à jour !')] });
    }

    if (name === 'welcome-preview') {
      return interaction.reply({ content: '👁️ Aperçu :', embeds: [buildWelcomeEmbed(interaction.member, data.config.welcome)], ephemeral: true });
    }

    if (name === 'help') {
      const embed = new EmbedBuilder().setColor(COLORS.primary).setTitle('📖 Commandes').addFields(
        { name: '⚙️ Config', value: '`/config` `/verification-panel` `/ticket-panel` `/update-announce` `/dashboard`', inline: false },
        { name: '️ Modération', value: '`/ban` `/kick` `/mute` `/warn` `/clear` `/lock` `/unlock` `/slowmode` `/nuke`', inline: false },
        { name: '📋 Utils', value: '`/poll` `/giveaway-create` `/giveaway-end` `/giveaway-reroll` `/embed` `/suggestion`', inline: false },
        { name: 'ℹ️ Infos', value: '`/userinfo` `/serverinfo` `/avatar`', inline: false },
        { name: '🎭 Rôles', value: '`/giverole` `/removerole`', inline: false },
        { name: '💰 Économie', value: '`/balance` `/daily` `/work` `/pay` `/top-economie`', inline: false },
        { name: '📈 Niveaux', value: '`/rank` `/top-niveaux`', inline: false },
        { name: '🔐 Dashboard', value: '`/my-level` `/set-level` `/remove-level`', inline: false }
      );
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (name === 'ban') {
      const user = interaction.options.getUser('membre');
      const reason = interaction.options.getString('raison') || 'Aucune';
      await interaction.guild.members.ban(user.id, { reason });
      await logAction(interaction.guild, ' Ban', `${user.tag}`);
      return interaction.reply({ embeds: [successEmbed(`${user.tag} banni.`)] });
    }

    if (name === 'unban') {
      const id = interaction.options.getString('id');
      try {
        await interaction.guild.members.unban(id);
        return interaction.reply({ embeds: [successEmbed(`${id} débanni.`)] });
      } catch { return interaction.reply({ embeds: [errorEmbed('ID invalide.')], ephemeral: true }); }
    }

    if (name === 'kick') {
      const user = interaction.options.getUser('membre');
      const member = await interaction.guild.members.fetch(user.id).catch(() => null);
      if (!member || !member.kickable) return interaction.reply({ embeds: [errorEmbed('Impossible.')], ephemeral: true });
      await member.kick();
      return interaction.reply({ embeds: [successEmbed(`${user.tag} expulsé.`)] });
    }

    if (name === 'mute') {
      const user = interaction.options.getUser('membre');
      const durationStr = interaction.options.getString('duree');
      const units = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
      const match = /^(\d+)([smhd])$/.exec(durationStr.trim());
      const ms = match ? parseInt(match[1]) * units[match[2]] : null;
      if (!ms) return interaction.reply({ embeds: [errorEmbed('Format : 10m, 2h, 1d')], ephemeral: true });
      const member = await interaction.guild.members.fetch(user.id).catch(() => null);
      if (!member || !member.moderatable) return interaction.reply({ embeds: [errorEmbed('Impossible.')], ephemeral: true });
      await member.timeout(ms);
      return interaction.reply({ embeds: [successEmbed(`Muté ${durationStr}.`)] });
    }

    if (name === 'unmute') {
      const user = interaction.options.getUser('membre');
      const member = await interaction.guild.members.fetch(user.id).catch(() => null);
      if (!member) return interaction.reply({ embeds: [errorEmbed('Introuvable.')], ephemeral: true });
      await member.timeout(null);
      return interaction.reply({ embeds: [successEmbed(`Unmute.`)] });
    }

    if (name === 'warn') {
      const user = interaction.options.getUser('membre');
      const reason = interaction.options.getString('raison');
      if (!data.warns[user.id]) data.warns[user.id] = [];
      data.warns[user.id].push({ reason, timestamp: Date.now() });
      saveData(interaction.guildId, data);
      return interaction.reply({ embeds: [successEmbed(`${user.tag} averti.`)] });
    }

    if (name === 'warnings') {
      const user = interaction.options.getUser('membre');
      const warns = data.warns[user.id] || [];
      const sub = interaction.options.getSubcommand();
      if (sub === 'liste') {
        if (warns.length === 0) return interaction.reply({ embeds: [infoEmbed(`Aucun avertissement.`)], ephemeral: true });
        return interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.warning).setTitle(`Avertissements (${warns.length})`).setDescription(warns.map((w, i) => `**#${i + 1}** — ${w.reason}`).join('\n'))], ephemeral: true });
      }
      if (sub === 'reset') {
        data.warns[user.id] = [];
        saveData(interaction.guildId, data);
        return interaction.reply({ embeds: [successEmbed(`Avertissements effacés.`)] });
      }
    }

    if (name === 'clear') {
      const amount = interaction.options.getInteger('nombre');
      await interaction.deferReply({ ephemeral: true });
      const messages = await interaction.channel.messages.fetch({ limit: 100 });
      const deleted = await interaction.channel.bulkDelete(messages.first(amount), true).catch(() => null);
      return interaction.editReply({ embeds: [successEmbed(`${deleted?.size || 0} supprimé(s).`)] });
    }

    if (name === 'slowmode') {
      const seconds = interaction.options.getInteger('secondes');
      await interaction.channel.setRateLimitPerUser(seconds);
      return interaction.reply({ embeds: [successEmbed(seconds === 0 ? 'Désactivé.' : `${seconds}s`)] });
    }

    if (name === 'lock') {
      await interaction.channel.permissionOverwrites.edit(interaction.guild.id, { SendMessages: false });
      return interaction.reply({ embeds: [successEmbed(' Verrouillé.')] });
    }

    if (name === 'unlock') {
      await interaction.channel.permissionOverwrites.edit(interaction.guild.id, { SendMessages: null });
      return interaction.reply({ embeds: [successEmbed('🔓 Déverrouillé.')] });
    }

    if (name === 'nuke') {
      const pos = interaction.channel.position;
      const newChannel = await interaction.channel.clone({ position: pos });
      await interaction.channel.delete();
      return newChannel.send({ embeds: [successEmbed('Nuke !')] });
    }

    if (name === 'poll') {
      const question = interaction.options.getString('question');
      const optionsStr = interaction.options.getString('options');
      const options = optionsStr.split(',').map(o => o.trim()).slice(0, 5);

      if (options.length < 2) return interaction.reply({ embeds: [errorEmbed('Min 2 options.')], ephemeral: true });

      const emojis = ['1️', '2️⃣', '3️⃣', '4️⃣', '5️⃣'];
      const pollEmbed = new EmbedBuilder()
        .setColor(COLORS.primary)
        .setTitle('📊 Sondage')
        .setDescription(`**${question}**\n\n${options.map((o, i) => `${emojis[i]} ${o}`).join('\n')}`);

      const msg = await interaction.channel.send({ embeds: [pollEmbed] });
      for (let i = 0; i < options.length; i++) {
        await msg.react(emojis[i]);
      }
      return interaction.reply({ embeds: [successEmbed('Créé !')], ephemeral: true });
    }

    function wallet(userId) {
      if (!data.economy[userId]) data.economy[userId] = { balance: 0, lastDaily: 0, lastWork: 0 };
      return data.economy[userId];
    }

    if (name === 'balance') {
      if (!data.config.economy.enabled) return interaction.reply({ embeds: [errorEmbed('Désactivé.')], ephemeral: true });
      const user = interaction.options.getUser('membre') || interaction.user;
      const w = wallet(user.id);
      return interaction.reply({ embeds: [infoEmbed(`💰 ${user.username} : **${w.balance}**`)] });
    }

    if (name === 'daily') {
      const cfg = data.config.economy;
      if (!cfg.enabled) return interaction.reply({ embeds: [errorEmbed('Désactivé.')], ephemeral: true });
      const w = wallet(interaction.user.id);
      const remaining = w.lastDaily + 86400000 - Date.now();
      if (remaining > 0) return interaction.reply({ embeds: [errorEmbed(`Reviens dans ${Math.ceil(remaining / 3600000)}h.`)], ephemeral: true });
      w.balance += cfg.dailyAmount;
      w.lastDaily = Date.now();
      saveData(interaction.guildId, data);
      return interaction.reply({ embeds: [successEmbed(`+${cfg.dailyAmount}`)] });
    }

    if (name === 'work') {
      const cfg = data.config.economy;
      if (!cfg.enabled) return interaction.reply({ embeds: [errorEmbed('Désactivé.')], ephemeral: true });
      const w = wallet(interaction.user.id);
      const remaining = w.lastWork + 3600000 - Date.now();
      if (remaining > 0) return interaction.reply({ embeds: [errorEmbed(`${Math.ceil(remaining / 60000)}min`)], ephemeral: true });
      const gain = Math.floor(Math.random() * (cfg.workMax - cfg.workMin + 1)) + cfg.workMin;
      w.balance += gain;
      w.lastWork = Date.now();
      saveData(interaction.guildId, data);
      return interaction.reply({ embeds: [successEmbed(`+${gain}`)] });
    }

    if (name === 'pay') {
      const cfg = data.config.economy;
      if (!cfg.enabled) return interaction.reply({ embeds: [errorEmbed('Désactivé.')], ephemeral: true });
      const target = interaction.options.getUser('membre');
      const amount = interaction.options.getInteger('montant');
      if (target.id === interaction.user.id) return interaction.reply({ embeds: [errorEmbed('Impossible.')], ephemeral: true });
      const sender = wallet(interaction.user.id);
      if (sender.balance < amount) return interaction.reply({ embeds: [errorEmbed('Solde insuffisant.')], ephemeral: true });
      sender.balance -= amount;
      wallet(target.id).balance += amount;
      saveData(interaction.guildId, data);
      return interaction.reply({ embeds: [successEmbed(`${amount} envoyés.`)] });
    }

    if (name === 'top-economie') {
      if (!data.config.economy.enabled) return interaction.reply({ embeds: [errorEmbed('Désactivé.')], ephemeral: true });
      const sorted = Object.entries(data.economy).sort((a, b) => b[1].balance - a[1].balance).slice(0, 10);
      if (sorted.length === 0) return interaction.reply({ embeds: [errorEmbed('Aucune donnée.')], ephemeral: true });
      const lines = sorted.map(([id, w], i) => `**${i + 1}.** <@${id}> — ${w.balance}`);
      return interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.primary).setTitle('🏆 Top').setDescription(lines.join('\n'))] });
    }

    if (name === 'rank') {
      if (!data.config.leveling.enabled) return interaction.reply({ embeds: [errorEmbed('Désactivé.')], ephemeral: true });
      const user = interaction.options.getUser('membre') || interaction.user;
      const xp = data.levels[user.id]?.xp || 0;
      const level = levelFromXp(xp);
      return interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.primary).setTitle(`Niveau`).addFields({ name: 'Niveau', value: `${level}`, inline: true }, { name: 'XP', value: `${xp}`, inline: true })] });
    }

    if (name === 'top-niveaux') {
      if (!data.config.leveling.enabled) return interaction.reply({ embeds: [errorEmbed('Désactivé.')], ephemeral: true });
      const sorted = Object.entries(data.levels).sort((a, b) => b[1].xp - a[1].xp).slice(0, 10);
      if (sorted.length === 0) return interaction.reply({ embeds: [errorEmbed('Aucune donnée.')], ephemeral: true });
      const lines = sorted.map(([id, l], i) => `**${i + 1}.** <@${id}> — ${levelFromXp(l.xp)}`);
      return interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.primary).setTitle('🏆 Top').setDescription(lines.join('\n'))] });
    }

    if (name === 'userinfo') {
      const user = interaction.options.getUser('membre') || interaction.user;
      const member = await interaction.guild.members.fetch(user.id).catch(() => null);
      const roles = member ? member.roles.cache.filter(r => r.id !== interaction.guild.id).sort((a, b) => b.position - a.position).map(r => `<@&${r.id}>`).slice(0, 15) : [];
      const embed = new EmbedBuilder().setColor(COLORS.primary).setTitle(`Infos de ${user.tag}`).setThumbnail(user.displayAvatarURL({ size: 256 }))
        .addFields(
          { name: 'ID', value: user.id, inline: true },
          { name: 'Compte créé', value: `<t:${Math.floor(user.createdTimestamp / 1000)}:D>`, inline: true },
          { name: 'A rejoint le', value: member ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:D>` : 'Inconnu', inline: true },
          { name: `Rôles (${roles.length})`, value: roles.length ? roles.join(' ') : 'Aucun', inline: false }
        );
      return interaction.reply({ embeds: [embed] });
    }

    if (name === 'serverinfo') {
      const guild = interaction.guild;
      const owner = await guild.fetchOwner().catch(() => null);
      const embed = new EmbedBuilder().setColor(COLORS.primary).setTitle(guild.name).setThumbnail(guild.iconURL({ size: 256 }))
        .addFields(
          { name: 'Propriétaire', value: owner ? `${owner.user.tag}` : 'Inconnu', inline: true },
          { name: 'Membres', value: `${guild.memberCount}`, inline: true },
          { name: 'Créé le', value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:D>`, inline: true },
          { name: 'Salons', value: `${guild.channels.cache.size}`, inline: true },
          { name: 'Rôles', value: `${guild.roles.cache.size}`, inline: true },
          { name: 'Boosts', value: `${guild.premiumSubscriptionCount || 0}`, inline: true }
        );
      return interaction.reply({ embeds: [embed] });
    }

    if (name === 'avatar') {
      const user = interaction.options.getUser('membre') || interaction.user;
      const embed = new EmbedBuilder().setColor(COLORS.primary).setTitle(`Avatar de ${user.tag}`).setImage(user.displayAvatarURL({ size: 512 }));
      return interaction.reply({ embeds: [embed] });
    }

    if (name === 'giverole') {
      const user = interaction.options.getUser('membre');
      const role = interaction.options.getRole('role');
      const member = await interaction.guild.members.fetch(user.id).catch(() => null);
      if (!member) return interaction.reply({ embeds: [errorEmbed('Membre introuvable.')], ephemeral: true });
      if (member.roles.cache.has(role.id)) return interaction.reply({ embeds: [errorEmbed(`${user.tag} a déjà ce rôle.`)], ephemeral: true });
      try {
        await member.roles.add(role);
        return interaction.reply({ embeds: [successEmbed(`Rôle ${role} ajouté à ${user.tag}.`)] });
      } catch {
        return interaction.reply({ embeds: [errorEmbed('Impossible d\'ajouter ce rôle (position du rôle trop haute pour le bot ?).')], ephemeral: true });
      }
    }

    if (name === 'removerole') {
      const user = interaction.options.getUser('membre');
      const role = interaction.options.getRole('role');
      const member = await interaction.guild.members.fetch(user.id).catch(() => null);
      if (!member) return interaction.reply({ embeds: [errorEmbed('Membre introuvable.')], ephemeral: true });
      if (!member.roles.cache.has(role.id)) return interaction.reply({ embeds: [errorEmbed(`${user.tag} n'a pas ce rôle.`)], ephemeral: true });
      try {
        await member.roles.remove(role);
        return interaction.reply({ embeds: [successEmbed(`Rôle ${role} retiré à ${user.tag}.`)] });
      } catch {
        return interaction.reply({ embeds: [errorEmbed('Impossible de retirer ce rôle (position du rôle trop haute pour le bot ?).')], ephemeral: true });
      }
    }

    if (name === 'embed') {
      const channel = interaction.options.getChannel('salon') || interaction.channel;
      if (!channel.isTextBased()) return interaction.reply({ embeds: [errorEmbed('Le salon doit être textuel.')], ephemeral: true });
      const modal = new ModalBuilder().setCustomId(`embed_modal_${channel.id}`).setTitle('Créer un embed');
      modal.addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('titre').setLabel('Titre (optionnel)').setStyle(TextInputStyle.Short).setRequired(false)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('description').setLabel('Description').setStyle(TextInputStyle.Paragraph).setRequired(true)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('couleur').setLabel('Couleur hex (ex: 5865F2, optionnel)').setStyle(TextInputStyle.Short).setRequired(false)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('image').setLabel('URL image (optionnel)').setStyle(TextInputStyle.Short).setRequired(false)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('footer').setLabel('Pied de page (optionnel)').setStyle(TextInputStyle.Short).setRequired(false))
      );
      return interaction.showModal(modal);
    }

    if (name === 'suggestion') {
      const text = interaction.options.getString('texte');
      const channel = interaction.options.getChannel('salon') || interaction.channel;
      if (!channel.isTextBased()) return interaction.reply({ embeds: [errorEmbed('Le salon doit être textuel.')], ephemeral: true });
      const embed = new EmbedBuilder().setColor(COLORS.primary).setTitle('💡 Nouvelle suggestion').setDescription(text)
        .setFooter({ text: `Proposé par ${interaction.user.tag}` }).setThumbnail(interaction.user.displayAvatarURL());
      const msg = await channel.send({ embeds: [embed] });
      await msg.react('👍').catch(() => {});
      await msg.react('').catch(() => {});
      return interaction.reply({ embeds: [successEmbed(`Suggestion envoyée dans ${channel} !`)], ephemeral: true });
    }

    if (name === 'invites') {
      if (!data.config.invites.enabled) return interaction.reply({ embeds: [errorEmbed('Désactivé.')], ephemeral: true });
      const user = interaction.options.getUser('membre') || interaction.user;
      const stats = data.inviteStats[user.id] || { joins: 0, leaves: 0 };
      return interaction.reply({ embeds: [infoEmbed(`📨 ${stats.joins - stats.leaves}`)] });
    }

  } catch (error) {
    console.error('Erreur:', error);
    return interaction.reply({ embeds: [errorEmbed('Erreur.')], ephemeral: true });
  }
}

// ============================================================
// ÉVÉNEMENTS
// ============================================================
const spamTracker = new Map();

client.once('ready', async () => {
  console.log(`✅ ${client.user.tag} est en ligne !`);
  console.log(` Nombre de commandes: ${commands.length}`);
  console.log(`🔍 Commandes: ${commands.map(c => c.name).join(', ')}`);
  
  client.user.setActivity('/help', { type: 3 });
  
  try {
    await wipeGlobalCommandsOnce().catch(() => {});
    for (const guild of client.guilds.cache.values()) {
      await deployCommandsToGuild(guild.id).catch(() => {});
    }
    console.log(`✅ Commandes déployées sur ${client.guilds.cache.size} serveur(s).`);
  } catch (e) { 
    console.error('❌ Erreur déploiement commandes:', e); 
  }
  
  startGiveawayScheduler();
});

client.on('guildCreate', async (guild) => {
  console.log(`➕ Bot ajouté au serveur : ${guild.name} (${guild.id})`);
  await deployCommandsToGuild(guild.id).catch((e) => console.error('Erreur déploiement pour', guild.id, e));
});

client.on('interactionCreate', async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) return executeCommand(interaction);
    if (interaction.customId?.startsWith('cfg_')) return handleConfigComponent(interaction);
    if (interaction.customId?.startsWith('ticket_')) return handleTicketComponent(interaction);
    if (interaction.customId?.startsWith('verify_')) return handleVerifyComponent(interaction);
    if (interaction.customId?.startsWith('dash_')) return handleDashboardComponent(interaction);
    
    if (interaction.isModalSubmit() && interaction.customId === 'update_announce_modal') {
      const data = getData(interaction.guildId);
      const changelog = interaction.fields.getTextInputValue('changelog');
      const gif = interaction.fields.getTextInputValue('gif');
      const channelId = data.config.updates.channelId;
      const channel = channelId ? interaction.guild.channels.cache.get(channelId) : interaction.channel;
      if (!channel) return interaction.reply({ embeds: [errorEmbed('Salon d\'annonces introuvable. Configure-le dans `/config`.')], ephemeral: true });

      const embed = new EmbedBuilder()
        .setColor(COLORS.primary)
        .setTitle(`🚀 Nouvelle mise à jour du bot — ${BOT_VERSION}`)
        .setDescription(changelog)
        .setTimestamp();
      if (gif) embed.setImage(gif);
      if (BOT_VERSION.toLowerCase().includes('bêta') || BOT_VERSION.toLowerCase().includes('beta')) {
        embed.setFooter({ text: 'Le bot est toujours en bêta — merci pour ton soutien et tes retours !' });
      }

      await channel.send({ embeds: [embed] }).catch(() => {});
      return interaction.reply({ embeds: [successEmbed(`Annonce publiée dans ${channel} !`)], ephemeral: true });
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith('embed_modal_')) {
      const channelId = interaction.customId.replace('embed_modal_', '');
      const channel = interaction.guild.channels.cache.get(channelId);
      if (!channel || !channel.isTextBased()) return interaction.reply({ embeds: [errorEmbed('Salon introuvable.')], ephemeral: true });

      const titre = interaction.fields.getTextInputValue('titre');
      const description = interaction.fields.getTextInputValue('description');
      const couleurRaw = interaction.fields.getTextInputValue('couleur');
      const image = interaction.fields.getTextInputValue('image');
      const footer = interaction.fields.getTextInputValue('footer');

      const embed = new EmbedBuilder().setColor(COLORS.primary).setDescription(description);
      if (titre) embed.setTitle(titre);
      if (couleurRaw) {
        const hex = couleurRaw.trim().replace('#', '');
        if (/^[0-9A-Fa-f]{6}$/.test(hex)) embed.setColor(parseInt(hex, 16));
      }
      if (image) embed.setImage(image);
      if (footer) embed.setFooter({ text: footer });

      try {
        await channel.send({ embeds: [embed] });
        return interaction.reply({ embeds: [successEmbed(`Embed envoyé dans ${channel}`)], ephemeral: true });
      } catch {
        return interaction.reply({ embeds: [errorEmbed('Erreur lors de l\'envoi (vérifie l\'URL de l\'image).')], ephemeral: true });
      }
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith('message_modal_')) {
      const user = interaction.user;
      if (!isOwner(user.id)) return interaction.reply({ embeds: [errorEmbed('Non autorisé.')], ephemeral: true });

      const channelId = interaction.customId.replace('message_modal_', '');
      const channel = interaction.guild.channels.cache.get(channelId);
      if (!channel || !channel.isTextBased()) return interaction.reply({ embeds: [errorEmbed('Salon introuvable.')], ephemeral: true });

      const title = interaction.fields.getTextInputValue('msg_title');
      const content = interaction.fields.getTextInputValue('msg_content');

      try {
        if (title) {
          const embed = new EmbedBuilder().setColor(COLORS.primary).setTitle(title).setDescription(content);
          await channel.send({ embeds: [embed] });
        } else {
          await channel.send(content);
        }
        return interaction.reply({ embeds: [successEmbed('Message envoyé !')], ephemeral: true });
      } catch {
        return interaction.reply({ embeds: [errorEmbed('Erreur.')], ephemeral: true });
      }
    }

    if (interaction.isButton() && interaction.customId.startsWith('giveaway_join_')) {
      const giveawayId = interaction.customId.replace('giveaway_join_', '');
      const data = getData(interaction.guildId);
      const g = data.giveaways[giveawayId];
      if (!g || g.ended) return interaction.reply({ embeds: [errorEmbed('Ce giveaway est terminé.')], ephemeral: true });

      if (g.participants.includes(interaction.user.id)) {
        g.participants = g.participants.filter(id => id !== interaction.user.id);
        saveData(interaction.guildId, data);
        await updateGiveawayMessage(interaction.guild, g);
        return interaction.reply({ embeds: [successEmbed('Tu ne participes plus à ce giveaway.')], ephemeral: true });
      }
      g.participants.push(interaction.user.id);
      saveData(interaction.guildId, data);
      await updateGiveawayMessage(interaction.guild, g);
      return interaction.reply({ embeds: [successEmbed('Tu participes au giveaway ! 🎉')], ephemeral: true });
    }

    if (interaction.isButton() && interaction.customId.startsWith('unkick_')) {
      const userId = interaction.customId.replace('unkick_', '');
      try {
        await interaction.guild.bans.remove(userId, 'Débanni');
        return interaction.reply({ embeds: [successEmbed(`Débanni.`)], ephemeral: true });
      } catch {
        return interaction.reply({ embeds: [errorEmbed('Erreur.')], ephemeral: true });
      }
    }
  } catch (error) {
    console.error('Erreur:', error);
    const payload = { embeds: [errorEmbed('Erreur.')], ephemeral: true };
    if (interaction.replied || interaction.deferred) await interaction.followUp(payload).catch(() => {});
    else await interaction.reply(payload).catch(() => {});
  }
});

client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild) return;
  const data = getData(message.guildId);

  await checkEveryoneMention(message);

  const lvlCfg = data.config.leveling;
  if (lvlCfg.enabled) {
    if (!data.levels[message.author.id]) data.levels[message.author.id] = { xp: 0, lastXp: 0 };
    const userLevel = data.levels[message.author.id];
    const now = Date.now();
    if (now - userLevel.lastXp >= lvlCfg.cooldownMs) {
      const before = levelFromXp(userLevel.xp);
      userLevel.xp += lvlCfg.xpPerMessage;
      userLevel.lastXp = now;
      const after = levelFromXp(userLevel.xp);
      if (after > before) {
        const channelId = lvlCfg.levelUpChannelId || message.channelId;
        message.guild.channels.cache.get(channelId)?.send({ embeds: [new EmbedBuilder().setColor(COLORS.success).setDescription(`🎉 ${message.author} niveau **${after}** !`)] }).catch(() => {});
      }
    }
  }

  saveData(message.guildId, data);
});

process.on('unhandledRejection', (error) => console.error('Erreur:', error));

client.login(process.env.DISCORD_TOKEN);
