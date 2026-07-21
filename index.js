/**
 * BOT DISCORD TOUT-EN-UN V2 — AMÉLIORÉ
 * ✨ Nouvelles fonctionnalités :
 * - Système de vérification Captcha (3 essais en 15 min)
 * - Anti-Everyone (3 violations = KICK)
 * - Slowmode, Lock/Unlock, Nuke, Polls
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
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const COLORS = { 
  primary: 0x5865F2, 
  success: 0x57F287, 
  error: 0xED4245, 
  warning: 0xFEE75C,
  info: 0x00B0F4
};

function defaultData() {
  return {
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
      tickets: { enabled: false, categoryId: null, logChannelId: null, supportRoleId: null, counter: 0 },
      economy: { enabled: false, dailyAmount: 200, workMin: 50, workMax: 250, currencyName: 'pièces' },
      leveling: { enabled: false, xpPerMessage: 15, cooldownMs: 60000, levelUpChannelId: null, levelUpMessage: '{user} passe niveau **{level}** !' },
      tempVoice: { enabled: false, hubChannelId: null, categoryId: null },
      invites: { enabled: false, logChannelId: null }
    },
    economy: {}, levels: {}, warns: {}, invitesCache: {}, inviteStats: {}, memberInviter: {},
    tempVoiceChannels: {}, raidState: { recentJoins: [], lockdown: false }, nukeState: {},
    verification: {},
    everyoneMentions: {}
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
function errorEmbed(desc) { return new EmbedBuilder().setColor(COLORS.error).setDescription(`❌ ${desc}`); }
function infoEmbed(desc) { return new EmbedBuilder().setColor(COLORS.info).setDescription(`ℹ️ ${desc}`); }

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
  new SlashCommandBuilder().setName('config').setDescription('Ouvre le panneau de configuration').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder().setName('help').setDescription('Affiche la liste des commandes'),
  new SlashCommandBuilder().setName('ticket-panel').setDescription('Envoie le panneau de tickets').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder().setName('welcome-image').setDescription('Définit l\'image de bienvenue').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addAttachmentOption(o => o.setName('image').setDescription('L\'image').setRequired(true)),
  new SlashCommandBuilder().setName('welcome-preview').setDescription('Aperçu du message de bienvenue').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder().setName('verification-panel').setDescription('Envoie le panneau de vérification').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

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

  new SlashCommandBuilder().setName('balance').setDescription('Affiche un solde').addUserOption(o => o.setName('membre').setDescription('Le membre')),
  new SlashCommandBuilder().setName('daily').setDescription('Récompense journalière'),
  new SlashCommandBuilder().setName('work').setDescription('Travaille pour gagner'),
  new SlashCommandBuilder().setName('pay').setDescription('Transfère de l\'argent')
    .addUserOption(o => o.setName('membre').setDescription('Destinataire').setRequired(true))
    .addIntegerOption(o => o.setName('montant').setDescription('Montant').setRequired(true).setMinValue(1)),
  new SlashCommandBuilder().setName('top-economie').setDescription('Classement économie'),

  new SlashCommandBuilder().setName('rank').setDescription('Affiche un niveau').addUserOption(o => o.setName('membre').setDescription('Le membre')),
  new SlashCommandBuilder().setName('top-niveaux').setDescription('Classement niveaux'),

  new SlashCommandBuilder().setName('invites').setDescription('Invitations d\'un membre').addUserOption(o => o.setName('membre').setDescription('Le membre'))
].map(c => c.toJSON());

async function deployCommands() {
  const rest = new REST().setToken(process.env.DISCORD_TOKEN);
  const route = process.env.GUILD_ID
    ? Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID)
    : Routes.applicationCommands(process.env.CLIENT_ID);
  await rest.put(route, { body: commands });
  console.log(`✅ ${commands.length} commande(s) déployée(s).`);
}

// ============================================================
// PANNEAU CONFIG
// ============================================================
const MODULES = {
  welcome: '👋 Bienvenue & Auto-rôle',
  moderation: '🛡️ Modération & Anti-raid',
  tickets: '🎫 Tickets',
  economy: '💰 Économie',
  leveling: '📈 Niveaux (XP)',
  tempvoice: '🔊 Vocaux temporaires',
  invites: '📨 Invitations',
  verification: '🔐 Vérification'
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
    embed.addFields(
      { name: 'Catégorie', value: c.categoryId ? `<#${c.categoryId}>` : 'Non défini', inline: true },
      { name: 'Rôle support', value: c.supportRoleId ? `<@&${c.supportRoleId}>` : 'Non défini', inline: true }
    );
    rows.push(new ActionRowBuilder().addComponents(toggleBtn('cfg_ticket_toggle', c.enabled)));
    rows.push(new ActionRowBuilder().addComponents(new ChannelSelectMenuBuilder().setCustomId('cfg_ticket_category').setPlaceholder('Catégorie').addChannelTypes(ChannelType.GuildCategory)));
    rows.push(new ActionRowBuilder().addComponents(new RoleSelectMenuBuilder().setCustomId('cfg_ticket_role').setPlaceholder('Rôle support')));
  }

  rows.push(backRow());
  return { embeds: [embed], components: rows.slice(0, 5) };
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
      cfg_inv_channel: ['invites', () => cfg.invites.logChannelId = val]
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
async function deployTicketPanel(channel) {
  const embed = new EmbedBuilder().setColor(COLORS.primary).setTitle('🎫 Support').setDescription('Clique pour ouvrir.');
  const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('ticket_create').setLabel('Créer').setEmoji('📩').setStyle(ButtonStyle.Primary));
  await channel.send({ embeds: [embed], components: [row] });
}

async function handleTicketComponent(interaction) {
  const data = getData(interaction.guildId);
  const cfg = data.config.tickets;

  if (interaction.customId === 'ticket_create') {
    if (!cfg.enabled || !cfg.categoryId) return interaction.reply({ embeds: [errorEmbed('Non configuré.')], ephemeral: true });

    const existing = interaction.guild.channels.cache.find(c => c.topic === `ticket-${interaction.user.id}` && c.parentId === cfg.categoryId);
    if (existing) return interaction.reply({ embeds: [errorEmbed(`Ticket ouvert : <#${existing.id}>`)], ephemeral: true });

    cfg.counter = (cfg.counter || 0) + 1;
    const overwrites = [
      { id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
      { id: interaction.client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels] }
    ];
    if (cfg.supportRoleId) overwrites.push({ id: cfg.supportRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] });

    const channel = await interaction.guild.channels.create({ name: `ticket-${cfg.counter}`, type: ChannelType.GuildText, parent: cfg.categoryId, topic: `ticket-${interaction.user.id}`, permissionOverwrites: overwrites }).catch(() => null);
    if (!channel) return interaction.reply({ embeds: [errorEmbed('Erreur.')], ephemeral: true });

    saveData(interaction.guildId, data);

    const embed = new EmbedBuilder().setColor(COLORS.primary).setTitle(`Ticket #${cfg.counter}`).setDescription(`Bienvenue ${interaction.user}`);
    const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('ticket_close').setLabel('Fermer').setEmoji('🔒').setStyle(ButtonStyle.Danger));
    await channel.send({ content: `${interaction.user}${cfg.supportRoleId ? ` <@&${cfg.supportRoleId}>` : ''}`, embeds: [embed], components: [row] });
    return interaction.reply({ embeds: [successEmbed(`Créé : ${channel}`)], ephemeral: true });
  }

  if (interaction.customId === 'ticket_close') {
    await interaction.reply({ embeds: [successEmbed('Fermeture...')] });
    setTimeout(() => interaction.channel.delete().catch(() => {}), 2000);
  }
}

// ============================================================
// COMMANDES
// ============================================================
async function executeCommand(interaction) {
  const { commandName: name } = interaction;
  const data = getData(interaction.guildId);

  try {
    if (name === 'config') return interaction.reply({ ...renderConfigHome(), ephemeral: true });

    if (name === 'verification-panel') {
      await deployVerificationPanel(interaction.channel);
      return interaction.reply({ content: '✅ Panneau envoyé.', ephemeral: true });
    }

    if (name === 'ticket-panel') {
      await deployTicketPanel(interaction.channel);
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
        { name: '⚙️ Config', value: '`/config` `/verification-panel` `/ticket-panel`', inline: false },
        { name: '🛡️ Modération', value: '`/ban` `/kick` `/mute` `/warn` `/clear` `/lock` `/unlock` `/slowmode` `/nuke`', inline: false },
        { name: '📋 Utils', value: '`/poll`', inline: false },
        { name: '💰 Économie', value: '`/balance` `/daily` `/work` `/pay` `/top-economie`', inline: false },
        { name: '📈 Niveaux', value: '`/rank` `/top-niveaux`', inline: false }
      );
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (name === 'ban') {
      const user = interaction.options.getUser('membre');
      const reason = interaction.options.getString('raison') || 'Aucune';
      await interaction.guild.members.ban(user.id, { reason });
      await logAction(interaction.guild, '🔨 Ban', `${user.tag}`);
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
      return interaction.reply({ embeds: [successEmbed('🔒 Verrouillé.')] });
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

      const emojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣'];
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
  console.log(`✅ ${client.user.tag}`);
  client.user.setActivity('/help', { type: 3 });
  try { await deployCommands(); } catch (e) { console.error('Erreur:', e); }
});

client.on('interactionCreate', async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) return executeCommand(interaction);
    if (interaction.customId?.startsWith('cfg_')) return handleConfigComponent(interaction);
    if (interaction.customId?.startsWith('ticket_')) return handleTicketComponent(interaction);
    if (interaction.customId?.startsWith('verify_')) return handleVerifyComponent(interaction);
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
