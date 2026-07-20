/**
 * BOT DISCORD TOUT-EN-UN — fichier unique
 * Modération, anti-raid/anti-nuke, tickets, économie, niveaux, vocaux temporaires, invitations.
 * Tout se configure via /config une fois le bot en ligne.
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
// STOCKAGE (un fichier JSON par serveur)
// ============================================================
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const COLORS = { primary: 0x5865F2, success: 0x57F287, error: 0xED4245, warning: 0xFEE75C };

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
        antiNuke: { enabled: false, maxChannelDeletes: 3, maxRoleDeletes: 3, maxBans: 3, windowMs: 10000 }
      },
      tickets: { enabled: false, categoryId: null, logChannelId: null, supportRoleId: null, counter: 0 },
      economy: { enabled: false, dailyAmount: 200, workMin: 50, workMax: 250, currencyName: 'pièces' },
      leveling: { enabled: false, xpPerMessage: 15, cooldownMs: 60000, levelUpChannelId: null, levelUpMessage: '{user} passe niveau **{level}** !' },
      tempVoice: { enabled: false, hubChannelId: null, categoryId: null },
      invites: { enabled: false, logChannelId: null }
    },
    economy: {}, levels: {}, warns: {}, invitesCache: {}, inviteStats: {}, memberInviter: {},
    tempVoiceChannels: {}, raidState: { recentJoins: [], lockdown: false }, nukeState: {}
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

async function logAction(guild, title, description, color = COLORS.warning) {
  const data = getData(guild.id);
  const channelId = data.config.moderation.logChannelId;
  if (!channelId) return;
  const channel = guild.channels.cache.get(channelId);
  if (!channel) return;
  channel.send({ embeds: [new EmbedBuilder().setColor(color).setTitle(title).setDescription(description).setTimestamp()] }).catch(() => {});
}

// XP / niveaux
function xpForLevel(level) { return 5 * (level ** 2) + 50 * level + 100; }
function levelFromXp(xp) { let l = 0; while (xp >= xpForLevel(l + 1)) l++; return l; }

// Construit l'embed de bienvenue à partir de la config et du membre (ou d'un membre factice pour la preview)
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
// DÉFINITION DES COMMANDES SLASH
// ============================================================
const commands = [
  new SlashCommandBuilder().setName('config').setDescription('Ouvre le panneau de configuration du bot').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder().setName('help').setDescription('Affiche la liste des commandes'),
  new SlashCommandBuilder().setName('ticket-panel').setDescription('Envoie le panneau de création de ticket dans ce salon').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder().setName('welcome-image').setDescription('Définit l\'image/bannière du message de bienvenue').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addAttachmentOption(o => o.setName('image').setDescription('L\'image à utiliser comme bannière').setRequired(true)),
  new SlashCommandBuilder().setName('welcome-preview').setDescription('Prévisualise le message de bienvenue actuel').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder().setName('ban').setDescription('Bannit un membre').setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addUserOption(o => o.setName('membre').setDescription('Le membre à bannir').setRequired(true))
    .addStringOption(o => o.setName('raison').setDescription('Raison')),
  new SlashCommandBuilder().setName('unban').setDescription('Débannit via un ID').setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addStringOption(o => o.setName('id').setDescription('ID Discord').setRequired(true)),
  new SlashCommandBuilder().setName('kick').setDescription('Expulse un membre').setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
    .addUserOption(o => o.setName('membre').setDescription('Le membre à expulser').setRequired(true))
    .addStringOption(o => o.setName('raison').setDescription('Raison')),
  new SlashCommandBuilder().setName('mute').setDescription('Rend un membre muet (timeout)').setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(o => o.setName('membre').setDescription('Le membre').setRequired(true))
    .addStringOption(o => o.setName('duree').setDescription('Ex: 10m, 2h, 1d').setRequired(true))
    .addStringOption(o => o.setName('raison').setDescription('Raison')),
  new SlashCommandBuilder().setName('unmute').setDescription('Retire le mute').setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(o => o.setName('membre').setDescription('Le membre').setRequired(true)),
  new SlashCommandBuilder().setName('warn').setDescription('Avertit un membre').setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(o => o.setName('membre').setDescription('Le membre').setRequired(true))
    .addStringOption(o => o.setName('raison').setDescription('Raison').setRequired(true)),
  new SlashCommandBuilder().setName('warnings').setDescription('Liste ou efface les avertissements').setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addSubcommand(s => s.setName('liste').setDescription('Liste les avertissements').addUserOption(o => o.setName('membre').setDescription('Le membre').setRequired(true)))
    .addSubcommand(s => s.setName('reset').setDescription('Efface les avertissements').addUserOption(o => o.setName('membre').setDescription('Le membre').setRequired(true))),
  new SlashCommandBuilder().setName('clear').setDescription('Supprime des messages').setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addIntegerOption(o => o.setName('nombre').setDescription('1-100').setRequired(true).setMinValue(1).setMaxValue(100))
    .addUserOption(o => o.setName('membre').setDescription('Filtrer par membre')),

  new SlashCommandBuilder().setName('balance').setDescription('Affiche un solde').addUserOption(o => o.setName('membre').setDescription('Le membre')),
  new SlashCommandBuilder().setName('daily').setDescription('Récupère ta récompense journalière'),
  new SlashCommandBuilder().setName('work').setDescription('Travaille pour gagner de l\'argent'),
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
  console.log(`✅ ${commands.length} commande(s) slash déployée(s).`);
}

// ============================================================
// MODULE CONFIG (panneau interactif)
// ============================================================
const MODULES = {
  welcome: '👋 Bienvenue & Auto-rôle', moderation: '🛡️ Modération & Anti-raid', tickets: '🎫 Tickets',
  economy: '💰 Économie', leveling: '📈 Niveaux (XP)', tempvoice: '🔊 Vocaux temporaires', invites: '📨 Invitations'
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
  return new ButtonBuilder().setCustomId(id).setLabel(label || (enabled ? 'Activé (clic = désactiver)' : 'Désactivé (clic = activer)')).setStyle(enabled ? ButtonStyle.Success : ButtonStyle.Danger);
}

function renderConfigHome() {
  const embed = new EmbedBuilder().setColor(COLORS.primary).setTitle('⚙️ Configuration du bot').setDescription('Choisis un module à configurer ci-dessous.');
  return { embeds: [embed], components: [moduleSelectRow(null)] };
}

function renderConfigModule(mod, data) {
  const cfg = data.config;
  const embed = new EmbedBuilder().setColor(COLORS.primary).setTitle(MODULES[mod]);
  const rows = [moduleSelectRow(mod)];

  if (mod === 'welcome') {
    const c = cfg.welcome;
    embed.setDescription('Aperçu en direct : utilise `/welcome-preview` à tout moment pour voir le rendu réel.')
      .addFields(
        { name: 'Salon', value: c.channelId ? `<#${c.channelId}>` : 'Non défini', inline: true },
        { name: 'Rôle auto', value: c.autoRoleId ? `<@&${c.autoRoleId}>` : 'Non défini', inline: true },
        { name: 'DM', value: c.dmEnabled ? 'Activé' : 'Désactivé', inline: true },
        { name: 'Image bannière', value: c.imageUrl ? '✅ définie (`/welcome-image` pour changer)' : '❌ aucune — utilise `/welcome-image` pour en ajouter une', inline: false }
      );
    rows.push(new ActionRowBuilder().addComponents(toggleBtn('cfg_welcome_toggle', c.enabled)));
    rows.push(new ActionRowBuilder().addComponents(new ChannelSelectMenuBuilder().setCustomId('cfg_welcome_channel').setPlaceholder('Salon de bienvenue').addChannelTypes(ChannelType.GuildText)));
    rows.push(new ActionRowBuilder().addComponents(new RoleSelectMenuBuilder().setCustomId('cfg_welcome_autorole').setPlaceholder('Rôle automatique')));
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('cfg_welcome_dmtoggle').setLabel(c.dmEnabled ? 'Désactiver DM' : 'Activer DM').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('cfg_welcome_textmodal').setLabel('✏️ Titre & texte').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('cfg_welcome_stepsmodal').setLabel('✏️ Étapes').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('cfg_welcome_footermodal').setLabel('✏️ Pied de page & rappel').setStyle(ButtonStyle.Secondary)
    ));
  }

  if (mod === 'moderation') {
    const c = cfg.moderation;
    embed.addFields(
      { name: 'Salon logs', value: c.logChannelId ? `<#${c.logChannelId}>` : 'Non défini', inline: true },
      { name: 'Anti-spam', value: c.antiSpam.enabled ? '✅' : '❌', inline: true },
      { name: 'Anti-lien', value: c.antiLink.enabled ? '✅' : '❌', inline: true },
      { name: 'Anti-ghost ping', value: c.antiGhostPing.enabled ? '✅' : '❌', inline: true },
      { name: 'Anti-raid', value: c.antiRaid.enabled ? '✅' : '❌', inline: true },
      { name: 'Anti-nuke', value: c.antiNuke.enabled ? '✅' : '❌', inline: true }
    );
    rows.push(new ActionRowBuilder().addComponents(new ChannelSelectMenuBuilder().setCustomId('cfg_mod_logchannel').setPlaceholder('Salon de logs').addChannelTypes(ChannelType.GuildText)));
    rows.push(new ActionRowBuilder().addComponents(
      toggleBtn('cfg_mod_antispam_toggle', c.antiSpam.enabled, 'Anti-spam'),
      toggleBtn('cfg_mod_antilink_toggle', c.antiLink.enabled, 'Anti-lien'),
      toggleBtn('cfg_mod_antighost_toggle', c.antiGhostPing.enabled, 'Anti-ghost ping')
    ));
    rows.push(new ActionRowBuilder().addComponents(
      toggleBtn('cfg_mod_antiraid_toggle', c.antiRaid.enabled, 'Anti-raid'),
      toggleBtn('cfg_mod_antinuke_toggle', c.antiNuke.enabled, 'Anti-nuke')
    ));
  }

  if (mod === 'tickets') {
    const c = cfg.tickets;
    embed.addFields(
      { name: 'Catégorie', value: c.categoryId ? `<#${c.categoryId}>` : 'Non défini', inline: true },
      { name: 'Salon logs', value: c.logChannelId ? `<#${c.logChannelId}>` : 'Non défini', inline: true },
      { name: 'Rôle support', value: c.supportRoleId ? `<@&${c.supportRoleId}>` : 'Non défini', inline: true }
    );
    rows.push(new ActionRowBuilder().addComponents(toggleBtn('cfg_ticket_toggle', c.enabled)));
    rows.push(new ActionRowBuilder().addComponents(new ChannelSelectMenuBuilder().setCustomId('cfg_ticket_category').setPlaceholder('Catégorie des tickets').addChannelTypes(ChannelType.GuildCategory)));
    rows.push(new ActionRowBuilder().addComponents(new ChannelSelectMenuBuilder().setCustomId('cfg_ticket_logchannel').setPlaceholder('Salon de logs').addChannelTypes(ChannelType.GuildText)));
    rows.push(new ActionRowBuilder().addComponents(new RoleSelectMenuBuilder().setCustomId('cfg_ticket_role').setPlaceholder('Rôle support')));
  }

  if (mod === 'economy') {
    const c = cfg.economy;
    embed.addFields({ name: 'Journalier', value: `${c.dailyAmount} ${c.currencyName}`, inline: true }, { name: 'Work', value: `${c.workMin}-${c.workMax} ${c.currencyName}`, inline: true });
    rows.push(new ActionRowBuilder().addComponents(toggleBtn('cfg_eco_toggle', c.enabled)));
    rows.push(new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('cfg_eco_amounts').setLabel('✏️ Modifier les montants').setStyle(ButtonStyle.Secondary)));
  }

  if (mod === 'leveling') {
    const c = cfg.leveling;
    embed.addFields({ name: 'Salon annonce', value: c.levelUpChannelId ? `<#${c.levelUpChannelId}>` : 'Salon du message', inline: true }, { name: 'XP/msg', value: `${c.xpPerMessage}`, inline: true });
    rows.push(new ActionRowBuilder().addComponents(toggleBtn('cfg_lvl_toggle', c.enabled)));
    rows.push(new ActionRowBuilder().addComponents(new ChannelSelectMenuBuilder().setCustomId('cfg_lvl_channel').setPlaceholder('Salon annonces niveau').addChannelTypes(ChannelType.GuildText)));
  }

  if (mod === 'tempvoice') {
    const c = cfg.tempVoice;
    embed.addFields({ name: 'Salon hub', value: c.hubChannelId ? `<#${c.hubChannelId}>` : 'Non défini', inline: true }, { name: 'Catégorie', value: c.categoryId ? `<#${c.categoryId}>` : 'Non défini', inline: true });
    rows.push(new ActionRowBuilder().addComponents(toggleBtn('cfg_tv_toggle', c.enabled)));
    rows.push(new ActionRowBuilder().addComponents(new ChannelSelectMenuBuilder().setCustomId('cfg_tv_hub').setPlaceholder('Salon vocal hub').addChannelTypes(ChannelType.GuildVoice)));
    rows.push(new ActionRowBuilder().addComponents(new ChannelSelectMenuBuilder().setCustomId('cfg_tv_category').setPlaceholder('Catégorie destination').addChannelTypes(ChannelType.GuildCategory)));
  }

  if (mod === 'invites') {
    const c = cfg.invites;
    embed.addFields({ name: 'Salon logs', value: c.logChannelId ? `<#${c.logChannelId}>` : 'Non défini', inline: true });
    rows.push(new ActionRowBuilder().addComponents(toggleBtn('cfg_inv_toggle', c.enabled)));
    rows.push(new ActionRowBuilder().addComponents(new ChannelSelectMenuBuilder().setCustomId('cfg_inv_channel').setPlaceholder('Salon logs invitations').addChannelTypes(ChannelType.GuildText)));
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

  if (interaction.isButton() && id === 'cfg_welcome_textmodal') {
    const modal = new ModalBuilder().setCustomId('cfg_welcome_textmodal_submit').setTitle('Titre & texte de bienvenue');
    modal.addComponents(
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('title').setLabel('Titre').setStyle(TextInputStyle.Short).setValue(cfg.welcome.title).setRequired(true)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('desc').setLabel('Texte — utilise {user} {server} {count}').setStyle(TextInputStyle.Paragraph).setValue(cfg.welcome.description).setRequired(true))
    );
    return interaction.showModal(modal);
  }
  if (interaction.isModalSubmit() && id === 'cfg_welcome_textmodal_submit') {
    cfg.welcome.title = interaction.fields.getTextInputValue('title');
    cfg.welcome.description = interaction.fields.getTextInputValue('desc');
    saveData(interaction.guildId, data);
    return interaction.update(renderConfigModule('welcome', data));
  }

  if (interaction.isButton() && id === 'cfg_welcome_stepsmodal') {
    const steps = cfg.welcome.steps;
    const modal = new ModalBuilder().setCustomId('cfg_welcome_stepsmodal_submit').setTitle('Étapes (format : Titre | Texte)');
    for (let i = 0; i < 3; i++) {
      const s = steps[i] || { title: '', text: '' };
      modal.addComponents(new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId(`step${i}`).setLabel(`Étape ${i + 1} (laisser vide = masquée)`).setStyle(TextInputStyle.Short)
          .setValue(s.title ? `${s.title} | ${s.text}` : '').setRequired(false)
      ));
    }
    return interaction.showModal(modal);
  }
  if (interaction.isModalSubmit() && id === 'cfg_welcome_stepsmodal_submit') {
    const newSteps = [];
    for (let i = 0; i < 3; i++) {
      const raw = interaction.fields.getTextInputValue(`step${i}`).trim();
      if (!raw) { newSteps.push({ title: '', text: '' }); continue; }
      const [title, ...rest] = raw.split('|');
      newSteps.push({ title: title.trim(), text: rest.join('|').trim() || 'Détails à venir.' });
    }
    cfg.welcome.steps = newSteps;
    saveData(interaction.guildId, data);
    return interaction.update(renderConfigModule('welcome', data));
  }

  if (interaction.isButton() && id === 'cfg_welcome_footermodal') {
    const modal = new ModalBuilder().setCustomId('cfg_welcome_footermodal_submit').setTitle('Pied de page & rappel');
    modal.addComponents(
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('footer').setLabel('Pied de page — {server} {count}').setStyle(TextInputStyle.Short).setValue(cfg.welcome.footer || '').setRequired(false)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('rtitle').setLabel('Titre du rappel').setStyle(TextInputStyle.Short).setValue(cfg.welcome.reminderTitle || '').setRequired(false)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('rtext').setLabel('Texte du rappel (vide = masqué)').setStyle(TextInputStyle.Paragraph).setValue(cfg.welcome.reminderText || '').setRequired(false))
    );
    return interaction.showModal(modal);
  }
  if (interaction.isModalSubmit() && id === 'cfg_welcome_footermodal_submit') {
    cfg.welcome.footer = interaction.fields.getTextInputValue('footer');
    cfg.welcome.reminderTitle = interaction.fields.getTextInputValue('rtitle');
    cfg.welcome.reminderText = interaction.fields.getTextInputValue('rtext');
    saveData(interaction.guildId, data);
    return interaction.update(renderConfigModule('welcome', data));
  }

  if (interaction.isButton() && id === 'cfg_eco_amounts') {
    const modal = new ModalBuilder().setCustomId('cfg_eco_amounts_submit').setTitle('Montants économie');
    modal.addComponents(
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('daily').setLabel('Montant journalier').setStyle(TextInputStyle.Short).setValue(String(cfg.economy.dailyAmount)).setRequired(true)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('min').setLabel('Work minimum').setStyle(TextInputStyle.Short).setValue(String(cfg.economy.workMin)).setRequired(true)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('max').setLabel('Work maximum').setStyle(TextInputStyle.Short).setValue(String(cfg.economy.workMax)).setRequired(true))
    );
    return interaction.showModal(modal);
  }
  if (interaction.isModalSubmit() && id === 'cfg_eco_amounts_submit') {
    cfg.economy.dailyAmount = parseInt(interaction.fields.getTextInputValue('daily')) || cfg.economy.dailyAmount;
    cfg.economy.workMin = parseInt(interaction.fields.getTextInputValue('min')) || cfg.economy.workMin;
    cfg.economy.workMax = parseInt(interaction.fields.getTextInputValue('max')) || cfg.economy.workMax;
    saveData(interaction.guildId, data);
    return interaction.update(renderConfigModule('economy', data));
  }

  if (interaction.isChannelSelectMenu()) {
    const val = interaction.values[0];
    const setters = {
      cfg_welcome_channel: ['welcome', () => cfg.welcome.channelId = val],
      cfg_mod_logchannel: ['moderation', () => cfg.moderation.logChannelId = val],
      cfg_ticket_category: ['tickets', () => cfg.tickets.categoryId = val],
      cfg_ticket_logchannel: ['tickets', () => cfg.tickets.logChannelId = val],
      cfg_lvl_channel: ['leveling', () => cfg.leveling.levelUpChannelId = val],
      cfg_tv_hub: ['tempvoice', () => cfg.tempVoice.hubChannelId = val],
      cfg_tv_category: ['tempvoice', () => cfg.tempVoice.categoryId = val],
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
    if (id === 'cfg_ticket_role') { cfg.tickets.supportRoleId = val; saveData(interaction.guildId, data); return interaction.update(renderConfigModule('tickets', data)); }
  }

  if (interaction.isButton()) {
    const toggles = {
      cfg_welcome_toggle: ['welcome', () => cfg.welcome.enabled = !cfg.welcome.enabled],
      cfg_welcome_dmtoggle: ['welcome', () => cfg.welcome.dmEnabled = !cfg.welcome.dmEnabled],
      cfg_mod_antispam_toggle: ['moderation', () => cfg.moderation.antiSpam.enabled = !cfg.moderation.antiSpam.enabled],
      cfg_mod_antilink_toggle: ['moderation', () => cfg.moderation.antiLink.enabled = !cfg.moderation.antiLink.enabled],
      cfg_mod_antighost_toggle: ['moderation', () => cfg.moderation.antiGhostPing.enabled = !cfg.moderation.antiGhostPing.enabled],
      cfg_mod_antiraid_toggle: ['moderation', () => cfg.moderation.antiRaid.enabled = !cfg.moderation.antiRaid.enabled],
      cfg_mod_antinuke_toggle: ['moderation', () => cfg.moderation.antiNuke.enabled = !cfg.moderation.antiNuke.enabled],
      cfg_ticket_toggle: ['tickets', () => cfg.tickets.enabled = !cfg.tickets.enabled],
      cfg_eco_toggle: ['economy', () => cfg.economy.enabled = !cfg.economy.enabled],
      cfg_lvl_toggle: ['leveling', () => cfg.leveling.enabled = !cfg.leveling.enabled],
      cfg_tv_toggle: ['tempvoice', () => cfg.tempVoice.enabled = !cfg.tempVoice.enabled],
      cfg_inv_toggle: ['invites', () => cfg.invites.enabled = !cfg.invites.enabled]
    };
    if (toggles[id]) {
      const [modName, fn] = toggles[id];
      fn(); saveData(interaction.guildId, data);
      return interaction.update(renderConfigModule(modName, data));
    }
  }
}

// ============================================================
// MODULE TICKETS
// ============================================================
async function deployTicketPanel(channel) {
  const embed = new EmbedBuilder().setColor(COLORS.primary).setTitle('🎫 Support').setDescription('Clique pour ouvrir un ticket avec l\'équipe.');
  const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('ticket_create').setLabel('Créer un ticket').setEmoji('📩').setStyle(ButtonStyle.Primary));
  await channel.send({ embeds: [embed], components: [row] });
}

async function handleTicketComponent(interaction) {
  const data = getData(interaction.guildId);
  const cfg = data.config.tickets;

  if (interaction.customId === 'ticket_create') {
    if (!cfg.enabled || !cfg.categoryId) return interaction.reply({ embeds: [errorEmbed('Système de tickets non configuré (`/config`).')], ephemeral: true });

    const existing = interaction.guild.channels.cache.find(c => c.topic === `ticket-${interaction.user.id}` && c.parentId === cfg.categoryId);
    if (existing) return interaction.reply({ embeds: [errorEmbed(`Tu as déjà un ticket ouvert : <#${existing.id}>`)], ephemeral: true });

    cfg.counter = (cfg.counter || 0) + 1;
    const overwrites = [
      { id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
      { id: interaction.client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels] }
    ];
    if (cfg.supportRoleId) overwrites.push({ id: cfg.supportRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });

    const channel = await interaction.guild.channels.create({ name: `ticket-${cfg.counter}`, type: ChannelType.GuildText, parent: cfg.categoryId, topic: `ticket-${interaction.user.id}`, permissionOverwrites: overwrites });
    saveData(interaction.guildId, data);

    const embed = new EmbedBuilder().setColor(COLORS.primary).setTitle(`Ticket #${cfg.counter}`).setDescription(`Bienvenue ${interaction.user}, décris ton problème.`);
    const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('ticket_close').setLabel('Fermer').setEmoji('🔒').setStyle(ButtonStyle.Danger));
    await channel.send({ content: `${interaction.user}${cfg.supportRoleId ? ` <@&${cfg.supportRoleId}>` : ''}`, embeds: [embed], components: [row] });
    return interaction.reply({ embeds: [successEmbed(`Ticket créé : ${channel}`)], ephemeral: true });
  }

  if (interaction.customId === 'ticket_close') {
    await interaction.reply({ embeds: [successEmbed('Fermeture dans 5 secondes...')] });
    if (cfg.logChannelId) {
      interaction.guild.channels.cache.get(cfg.logChannelId)?.send({ embeds: [new EmbedBuilder().setColor(COLORS.warning).setTitle('Ticket fermé').setDescription(`Salon **${interaction.channel.name}** fermé par ${interaction.user}`)] }).catch(() => {});
    }
    setTimeout(() => interaction.channel.delete().catch(() => {}), 5000);
  }
}

// ============================================================
// COMMANDES SLASH — EXÉCUTION
// ============================================================
async function executeCommand(interaction) {
  const { commandName: name } = interaction;
  const data = getData(interaction.guildId);

  if (name === 'config') return interaction.reply({ ...renderConfigHome(), ephemeral: true });

  if (name === 'ticket-panel') {
    await deployTicketPanel(interaction.channel);
    return interaction.reply({ content: '✅ Panneau envoyé.', ephemeral: true });
  }

  if (name === 'welcome-image') {
    const attachment = interaction.options.getAttachment('image');
    if (!attachment.contentType || !attachment.contentType.startsWith('image/')) {
      return interaction.reply({ embeds: [errorEmbed('Le fichier doit être une image (png, jpg, gif, webp...).')], ephemeral: true });
    }
    data.config.welcome.imageUrl = attachment.url;
    saveData(interaction.guildId, data);
    return interaction.reply({ embeds: [successEmbed('Image de bienvenue mise à jour ! Utilise `/welcome-preview` pour voir le résultat.')], ephemeral: true });
  }

  if (name === 'welcome-preview') {
    const wCfg = data.config.welcome;
    return interaction.reply({ content: '👁️ Aperçu (les infos sont basées sur toi) :', embeds: [buildWelcomeEmbed(interaction.member, wCfg)], ephemeral: true });
  }

  if (name === 'help') {
    const embed = new EmbedBuilder().setColor(COLORS.primary).setTitle('📖 Commandes disponibles').addFields(
      { name: '⚙️ Configuration', value: '`/config` `/ticket-panel`' },
      { name: '🛡️ Modération', value: '`/ban` `/unban` `/kick` `/mute` `/unmute` `/warn` `/warnings` `/clear`' },
      { name: '💰 Économie', value: '`/balance` `/daily` `/work` `/pay` `/top-economie`' },
      { name: '📈 Niveaux', value: '`/rank` `/top-niveaux`' },
      { name: '📨 Invitations', value: '`/invites`' }
    );
    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  // --- Modération ---
  if (name === 'ban') {
    const user = interaction.options.getUser('membre');
    const reason = interaction.options.getString('raison') || 'Aucune raison fournie';
    const member = await interaction.guild.members.fetch(user.id).catch(() => null);
    if (member && !member.bannable) return interaction.reply({ embeds: [errorEmbed('Je ne peux pas bannir ce membre.')], ephemeral: true });
    await interaction.guild.members.ban(user.id, { reason: `${reason} — par ${interaction.user.tag}` });
    await logAction(interaction.guild, '🔨 Bannissement', `**Membre :** ${user.tag}\n**Modérateur :** ${interaction.user.tag}\n**Raison :** ${reason}`);
    return interaction.reply({ embeds: [successEmbed(`${user.tag} a été banni. Raison : ${reason}`)] });
  }

  if (name === 'unban') {
    const id = interaction.options.getString('id');
    try {
      await interaction.guild.members.unban(id, `Débanni par ${interaction.user.tag}`);
      await logAction(interaction.guild, '🔓 Débannissement', `**ID :** ${id}\n**Modérateur :** ${interaction.user.tag}`);
      return interaction.reply({ embeds: [successEmbed(`\`${id}\` débanni.`)] });
    } catch { return interaction.reply({ embeds: [errorEmbed('ID invalide ou non banni.')], ephemeral: true }); }
  }

  if (name === 'kick') {
    const user = interaction.options.getUser('membre');
    const reason = interaction.options.getString('raison') || 'Aucune raison fournie';
    const member = await interaction.guild.members.fetch(user.id).catch(() => null);
    if (!member) return interaction.reply({ embeds: [errorEmbed('Membre introuvable.')], ephemeral: true });
    if (!member.kickable) return interaction.reply({ embeds: [errorEmbed('Je ne peux pas expulser ce membre.')], ephemeral: true });
    await member.kick(`${reason} — par ${interaction.user.tag}`);
    await logAction(interaction.guild, '👢 Expulsion', `**Membre :** ${user.tag}\n**Modérateur :** ${interaction.user.tag}\n**Raison :** ${reason}`);
    return interaction.reply({ embeds: [successEmbed(`${user.tag} expulsé. Raison : ${reason}`)] });
  }

  if (name === 'mute') {
    const user = interaction.options.getUser('membre');
    const durationStr = interaction.options.getString('duree');
    const reason = interaction.options.getString('raison') || 'Aucune raison fournie';
    const units = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
    const match = /^(\d+)([smhd])$/.exec(durationStr.trim());
    const ms = match ? parseInt(match[1]) * units[match[2]] : null;
    if (!ms || ms > 28 * 86400000) return interaction.reply({ embeds: [errorEmbed('Durée invalide (ex: 10m, 2h, 1d — max 28j).')], ephemeral: true });
    const member = await interaction.guild.members.fetch(user.id).catch(() => null);
    if (!member || !member.moderatable) return interaction.reply({ embeds: [errorEmbed('Je ne peux pas mute ce membre.')], ephemeral: true });
    await member.timeout(ms, `${reason} — par ${interaction.user.tag}`);
    await logAction(interaction.guild, '🔇 Mute', `**Membre :** ${user.tag}\n**Durée :** ${durationStr}\n**Modérateur :** ${interaction.user.tag}\n**Raison :** ${reason}`);
    return interaction.reply({ embeds: [successEmbed(`${user.tag} mute pour ${durationStr}.`)] });
  }

  if (name === 'unmute') {
    const user = interaction.options.getUser('membre');
    const member = await interaction.guild.members.fetch(user.id).catch(() => null);
    if (!member) return interaction.reply({ embeds: [errorEmbed('Membre introuvable.')], ephemeral: true });
    await member.timeout(null, `Unmute par ${interaction.user.tag}`);
    return interaction.reply({ embeds: [successEmbed(`${user.tag} n'est plus muet.`)] });
  }

  if (name === 'warn') {
    const user = interaction.options.getUser('membre');
    const reason = interaction.options.getString('raison');
    if (!data.warns[user.id]) data.warns[user.id] = [];
    data.warns[user.id].push({ reason, moderatorId: interaction.user.id, timestamp: Date.now() });
    saveData(interaction.guildId, data);
    await logAction(interaction.guild, '⚠️ Avertissement', `**Membre :** ${user.tag}\n**Modérateur :** ${interaction.user.tag}\n**Raison :** ${reason}\n**Total :** ${data.warns[user.id].length}`);
    user.send(`Tu as reçu un avertissement sur **${interaction.guild.name}** : ${reason}`).catch(() => {});
    return interaction.reply({ embeds: [successEmbed(`${user.tag} averti (${data.warns[user.id].length} au total).`)] });
  }

  if (name === 'warnings') {
    const user = interaction.options.getUser('membre');
    const warns = data.warns[user.id] || [];
    const sub = interaction.options.getSubcommand();
    if (sub === 'liste') {
      if (warns.length === 0) return interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.primary).setDescription(`${user.tag} n'a aucun avertissement.`)], ephemeral: true });
      const embed = new EmbedBuilder().setColor(COLORS.warning).setTitle(`Avertissements de ${user.tag} (${warns.length})`)
        .setDescription(warns.map((w, i) => `**#${i + 1}** — <t:${Math.floor(w.timestamp / 1000)}:R> par <@${w.moderatorId}>\n${w.reason}`).join('\n\n'));
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }
    if (sub === 'reset') {
      data.warns[user.id] = []; saveData(interaction.guildId, data);
      return interaction.reply({ embeds: [successEmbed(`Avertissements de ${user.tag} effacés.`)] });
    }
  }

  if (name === 'clear') {
    const amount = interaction.options.getInteger('nombre');
    const user = interaction.options.getUser('membre');
    await interaction.deferReply({ ephemeral: true });
    const messages = await interaction.channel.messages.fetch({ limit: 100 });
    const toDelete = user ? messages.filter(m => m.author.id === user.id).first(amount) : messages.first(amount);
    if (!toDelete || toDelete.length === 0) return interaction.editReply({ embeds: [errorEmbed('Aucun message à supprimer.')] });
    const deleted = await interaction.channel.bulkDelete(toDelete, true).catch(() => null);
    if (!deleted) return interaction.editReply({ embeds: [errorEmbed('Suppression impossible (messages > 14 jours ?).')] });
    return interaction.editReply({ embeds: [successEmbed(`${deleted.size} message(s) supprimé(s).`)] });
  }

  // --- Économie ---
  function wallet(userId) {
    if (!data.economy[userId]) data.economy[userId] = { balance: 0, lastDaily: 0, lastWork: 0 };
    return data.economy[userId];
  }

  if (name === 'balance') {
    if (!data.config.economy.enabled) return interaction.reply({ embeds: [errorEmbed('Économie désactivée.')], ephemeral: true });
    const user = interaction.options.getUser('membre') || interaction.user;
    const w = wallet(user.id); saveData(interaction.guildId, data);
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.primary).setDescription(`💰 **${user.username}** possède **${w.balance} ${data.config.economy.currencyName}**`)] });
  }

  if (name === 'daily') {
    const cfg = data.config.economy;
    if (!cfg.enabled) return interaction.reply({ embeds: [errorEmbed('Économie désactivée.')], ephemeral: true });
    const w = wallet(interaction.user.id);
    const remaining = w.lastDaily + 86400000 - Date.now();
    if (remaining > 0) return interaction.reply({ embeds: [errorEmbed(`Reviens dans ${Math.ceil(remaining / 3600000)}h.`)], ephemeral: true });
    w.balance += cfg.dailyAmount; w.lastDaily = Date.now(); saveData(interaction.guildId, data);
    return interaction.reply({ embeds: [successEmbed(`+${cfg.dailyAmount} ${cfg.currencyName} ! Solde : ${w.balance}.`)] });
  }

  if (name === 'work') {
    const cfg = data.config.economy;
    if (!cfg.enabled) return interaction.reply({ embeds: [errorEmbed('Économie désactivée.')], ephemeral: true });
    const w = wallet(interaction.user.id);
    const remaining = w.lastWork + 3600000 - Date.now();
    if (remaining > 0) return interaction.reply({ embeds: [errorEmbed(`Reviens dans ${Math.ceil(remaining / 60000)} min.`)], ephemeral: true });
    const gain = Math.floor(Math.random() * (cfg.workMax - cfg.workMin + 1)) + cfg.workMin;
    w.balance += gain; w.lastWork = Date.now(); saveData(interaction.guildId, data);
    return interaction.reply({ embeds: [successEmbed(`Tu as gagné **${gain} ${cfg.currencyName}** ! Solde : ${w.balance}.`)] });
  }

  if (name === 'pay') {
    const cfg = data.config.economy;
    if (!cfg.enabled) return interaction.reply({ embeds: [errorEmbed('Économie désactivée.')], ephemeral: true });
    const target = interaction.options.getUser('membre');
    const amount = interaction.options.getInteger('montant');
    if (target.id === interaction.user.id) return interaction.reply({ embeds: [errorEmbed('Impossible de te payer toi-même.')], ephemeral: true });
    const sender = wallet(interaction.user.id);
    if (sender.balance < amount) return interaction.reply({ embeds: [errorEmbed('Solde insuffisant.')], ephemeral: true });
    sender.balance -= amount; wallet(target.id).balance += amount; saveData(interaction.guildId, data);
    return interaction.reply({ embeds: [successEmbed(`${amount} ${cfg.currencyName} transférés à ${target.username}.`)] });
  }

  if (name === 'top-economie') {
    if (!data.config.economy.enabled) return interaction.reply({ embeds: [errorEmbed('Économie désactivée.')], ephemeral: true });
    const sorted = Object.entries(data.economy).sort((a, b) => b[1].balance - a[1].balance).slice(0, 10);
    if (sorted.length === 0) return interaction.reply({ embeds: [errorEmbed('Personne n\'a de solde.')], ephemeral: true });
    const lines = sorted.map(([id, w], i) => `**${i + 1}.** <@${id}> — ${w.balance} ${data.config.economy.currencyName}`);
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.primary).setTitle('🏆 Classement économie').setDescription(lines.join('\n'))] });
  }

  // --- Niveaux ---
  if (name === 'rank') {
    if (!data.config.leveling.enabled) return interaction.reply({ embeds: [errorEmbed('Niveaux désactivés.')], ephemeral: true });
    const user = interaction.options.getUser('membre') || interaction.user;
    const xp = data.levels[user.id]?.xp || 0;
    const level = levelFromXp(xp);
    const embed = new EmbedBuilder().setColor(COLORS.primary).setTitle(`Niveau de ${user.username}`).setThumbnail(user.displayAvatarURL())
      .addFields({ name: 'Niveau', value: `${level}`, inline: true }, { name: 'XP total', value: `${xp}`, inline: true }, { name: 'Progression', value: `${xp - xpForLevel(level)} / ${xpForLevel(level + 1) - xpForLevel(level)} XP`, inline: true });
    return interaction.reply({ embeds: [embed] });
  }

  if (name === 'top-niveaux') {
    if (!data.config.leveling.enabled) return interaction.reply({ embeds: [errorEmbed('Niveaux désactivés.')], ephemeral: true });
    const sorted = Object.entries(data.levels).sort((a, b) => b[1].xp - a[1].xp).slice(0, 10);
    if (sorted.length === 0) return interaction.reply({ embeds: [errorEmbed('Personne n\'a d\'XP.')], ephemeral: true });
    const lines = sorted.map(([id, l], i) => `**${i + 1}.** <@${id}> — Niveau ${levelFromXp(l.xp)} (${l.xp} XP)`);
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.primary).setTitle('🏆 Classement niveaux').setDescription(lines.join('\n'))] });
  }

  // --- Invitations ---
  if (name === 'invites') {
    if (!data.config.invites.enabled) return interaction.reply({ embeds: [errorEmbed('Suivi des invitations désactivé.')], ephemeral: true });
    const user = interaction.options.getUser('membre') || interaction.user;
    const stats = data.inviteStats[user.id] || { joins: 0, leaves: 0 };
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.primary).setDescription(`📨 **${user.username}** a **${stats.joins - stats.leaves}** invitation(s) valide(s)`)] });
  }
}

// ============================================================
// ANTI-NUKE (audit log)
// ============================================================
async function recordNukeAction(guild, actionType, executorId, limitKey) {
  if (!executorId || executorId === guild.client.user.id) return;
  const data = getData(guild.id);
  const cfg = data.config.moderation.antiNuke;
  if (!cfg.enabled) return;

  const now = Date.now();
  data.nukeState[actionType] = (data.nukeState[actionType] || []).filter(e => now - e.time < cfg.windowMs && e.executorId === executorId);
  data.nukeState[actionType].push({ time: now, executorId });
  saveData(guild.id, data);

  const count = data.nukeState[actionType].filter(e => e.executorId === executorId).length;
  if (count >= cfg[limitKey]) {
    const executor = await guild.members.fetch(executorId).catch(() => null);
    if (executor && executor.bannable && executor.id !== guild.ownerId) {
      await executor.ban({ reason: 'Anti-nuke : actions destructrices en masse' }).catch(() => {});
      await logAction(guild, '🚨🚨 ANTI-NUKE', `<@${executorId}> banni automatiquement (${count} actions "${actionType}").`, COLORS.error);
    } else {
      await logAction(guild, '🚨 Anti-nuke', `<@${executorId}> a dépassé la limite d'actions "${actionType}".`, COLORS.error);
    }
  }
}

// ============================================================
// ÉVÉNEMENTS
// ============================================================
const spamTracker = new Map();
const URL_REGEX = /(https?:\/\/[^\s]+)/gi;

client.once('ready', async () => {
  console.log(`✅ Connecté en tant que ${client.user.tag}`);
  client.user.setActivity('/help', { type: 3 });
  try { await deployCommands(); } catch (e) { console.error('Erreur déploiement commandes:', e); }

  for (const guild of client.guilds.cache.values()) {
    try {
      const invites = await guild.invites.fetch();
      const data = getData(guild.id);
      data.invitesCache = {};
      invites.forEach(inv => { data.invitesCache[inv.code] = { uses: inv.uses || 0, inviterId: inv.inviter?.id || null }; });
      saveData(guild.id, data);
    } catch {}
  }
});

client.on('interactionCreate', async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) return executeCommand(interaction);
    if (interaction.customId?.startsWith('cfg_')) return handleConfigComponent(interaction);
    if (interaction.customId?.startsWith('ticket_')) return handleTicketComponent(interaction);
  } catch (error) {
    console.error('Erreur interaction:', error);
    const payload = { embeds: [errorEmbed('Une erreur est survenue.')], ephemeral: true };
    if (interaction.replied || interaction.deferred) await interaction.followUp(payload).catch(() => {});
    else await interaction.reply(payload).catch(() => {});
  }
});

client.on('guildMemberAdd', async (member) => {
  const data = getData(member.guild.id);

  // Anti-raid
  const raidCfg = data.config.moderation.antiRaid;
  if (raidCfg.enabled) {
    const now = Date.now();
    data.raidState.recentJoins = (data.raidState.recentJoins || []).filter(t => now - t < raidCfg.joinIntervalMs);
    data.raidState.recentJoins.push(now);
    const accountAgeH = (now - member.user.createdTimestamp) / 3600000;
    if (accountAgeH < raidCfg.minAccountAgeH) {
      await logAction(member.guild, '🚨 Anti-raid', `${member} : compte créé il y a ${accountAgeH.toFixed(1)}h.`, COLORS.warning);
    }
    if (data.raidState.recentJoins.length >= raidCfg.joinThreshold && !data.raidState.lockdown) {
      data.raidState.lockdown = true;
      await logAction(member.guild, '🚨🚨 RAID DÉTECTÉ', `${raidCfg.joinThreshold} arrivées en moins de ${raidCfg.joinIntervalMs / 1000}s.`, COLORS.error);
      if (raidCfg.lockdownOnRaid) member.guild.setVerificationLevel(4, 'Anti-raid').catch(() => {});
      setTimeout(() => { const f = getData(member.guild.id); f.raidState.lockdown = false; f.raidState.recentJoins = []; saveData(member.guild.id, f); }, 300000);
    }
  }

  // Suivi invitations
  try {
    const invites = await member.guild.invites.fetch();
    const before = data.invitesCache || {};
    let usedInvite = null;
    invites.forEach(inv => { if ((inv.uses || 0) > (before[inv.code]?.uses || 0)) usedInvite = inv; });
    data.invitesCache = {};
    invites.forEach(inv => { data.invitesCache[inv.code] = { uses: inv.uses || 0, inviterId: inv.inviter?.id || null }; });
    if (usedInvite?.inviter) {
      const inviterId = usedInvite.inviter.id;
      if (!data.inviteStats[inviterId]) data.inviteStats[inviterId] = { joins: 0, leaves: 0 };
      data.inviteStats[inviterId].joins++;
      data.memberInviter[member.id] = inviterId;
      if (data.config.invites.enabled && data.config.invites.logChannelId) {
        const total = data.inviteStats[inviterId].joins - data.inviteStats[inviterId].leaves;
        member.guild.channels.cache.get(data.config.invites.logChannelId)?.send({ embeds: [new EmbedBuilder().setColor(COLORS.primary).setDescription(`📨 ${member} a rejoint via <@${inviterId}> (total : ${total})`)] }).catch(() => {});
      }
    }
  } catch {}

  // Bienvenue
  const wCfg = data.config.welcome;
  if (wCfg.enabled && wCfg.channelId) {
    const channel = member.guild.channels.cache.get(wCfg.channelId);
    channel?.send({ content: `${member}`, embeds: [buildWelcomeEmbed(member, wCfg)] }).catch(() => {});
  }
  if (wCfg.dmEnabled) member.send(wCfg.dmMessage.replace(/{server}/g, member.guild.name)).catch(() => {});
  if (wCfg.autoRoleId) member.roles.add(wCfg.autoRoleId).catch(() => {});

  saveData(member.guild.id, data);
});

client.on('guildMemberRemove', (member) => {
  const data = getData(member.guild.id);
  const inviterId = data.memberInviter?.[member.id];
  if (inviterId && data.inviteStats[inviterId]) data.inviteStats[inviterId].leaves++;
  saveData(member.guild.id, data);
});

client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild) return;
  const data = getData(message.guildId);

  // Anti-spam
  const spamCfg = data.config.moderation.antiSpam;
  if (spamCfg.enabled) {
    const key = `${message.guildId}:${message.author.id}`;
    const now = Date.now();
    const timestamps = (spamTracker.get(key) || []).filter(t => now - t < spamCfg.intervalMs);
    timestamps.push(now);
    spamTracker.set(key, timestamps);
    if (timestamps.length > spamCfg.maxMessages) {
      spamTracker.set(key, []);
      if (message.member?.moderatable) await message.member.timeout(300000, 'Anti-spam').catch(() => {});
      await logAction(message.guild, '🚫 Anti-spam', `${message.author} mute 5min (spam).`, COLORS.warning);
      message.channel.send({ content: `${message.author}, tu as été mute pour spam.` }).then(m => setTimeout(() => m.delete().catch(() => {}), 5000)).catch(() => {});
      return;
    }
  }

  // Anti-lien
  const linkCfg = data.config.moderation.antiLink;
  if (linkCfg.enabled) {
    const matches = message.content.match(URL_REGEX);
    if (matches && !matches.every(url => linkCfg.whitelist.some(d => url.includes(d)))) {
      await message.delete().catch(() => {});
      await logAction(message.guild, '🔗 Anti-lien', `Message de ${message.author} supprimé dans ${message.channel}.`, COLORS.warning);
      message.channel.send({ content: `${message.author}, les liens ne sont pas autorisés.` }).then(m => setTimeout(() => m.delete().catch(() => {}), 5000)).catch(() => {});
      return;
    }
  }

  // XP / niveaux
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
        const text = lvlCfg.levelUpMessage.replace(/{user}/g, `${message.author}`).replace(/{level}/g, after);
        message.guild.channels.cache.get(channelId)?.send({ embeds: [new EmbedBuilder().setColor(COLORS.success).setDescription(`🎉 ${text}`)] }).catch(() => {});
      }
    }
  }

  saveData(message.guildId, data);
});

client.on('messageDelete', async (message) => {
  if (!message.guild || message.author?.bot || message.partial) return;
  const data = getData(message.guildId);
  if (!data.config.moderation.antiGhostPing.enabled) return;
  if (message.mentions.users.size === 0 && message.mentions.roles.size === 0) return;
  const age = Date.now() - message.createdTimestamp;
  if (age > 15000) return;
  const mentioned = [...message.mentions.users.values()].map(u => u.toString()).concat([...message.mentions.roles.values()].map(r => r.toString())).join(', ');
  await logAction(message.guild, '👻 Ghost ping détecté', `${message.author} a mentionné ${mentioned} puis supprimé son message (${Math.round(age / 1000)}s) dans ${message.channel}.`, COLORS.warning);
});

client.on('voiceStateUpdate', async (oldState, newState) => {
  const guild = newState.guild || oldState.guild;
  const data = getData(guild.id);
  const cfg = data.config.tempVoice;
  if (!cfg.enabled) return;

  if (newState.channelId === cfg.hubChannelId && newState.channelId !== oldState.channelId) {
    const category = cfg.categoryId ? guild.channels.cache.get(cfg.categoryId) : newState.channel.parent;
    const channel = await guild.channels.create({
      name: `🔊 Salon de ${newState.member.displayName}`, type: ChannelType.GuildVoice, parent: category?.id || null,
      permissionOverwrites: [{ id: newState.member.id, allow: [PermissionFlagsBits.ManageChannels, PermissionFlagsBits.MoveMembers] }]
    }).catch(() => null);
    if (channel) {
      data.tempVoiceChannels[channel.id] = { ownerId: newState.member.id };
      saveData(guild.id, data);
      await newState.setChannel(channel).catch(() => {});
    }
    return;
  }

  if (oldState.channelId && data.tempVoiceChannels[oldState.channelId]) {
    const channel = guild.channels.cache.get(oldState.channelId);
    if (channel && channel.members.size === 0) {
      await channel.delete().catch(() => {});
      delete data.tempVoiceChannels[oldState.channelId];
      saveData(guild.id, data);
    }
  }
});

client.on('channelDelete', async (channel) => {
  if (!channel.guild) return;
  const logs = await channel.guild.fetchAuditLogs({ type: AuditLogEvent.ChannelDelete, limit: 1 }).catch(() => null);
  const entry = logs?.entries.first();
  if (entry && Date.now() - entry.createdTimestamp < 5000) await recordNukeAction(channel.guild, 'channelDeletes', entry.executor?.id, 'maxChannelDeletes');
});

client.on('roleDelete', async (role) => {
  const logs = await role.guild.fetchAuditLogs({ type: AuditLogEvent.RoleDelete, limit: 1 }).catch(() => null);
  const entry = logs?.entries.first();
  if (entry && Date.now() - entry.createdTimestamp < 5000) await recordNukeAction(role.guild, 'roleDeletes', entry.executor?.id, 'maxRoleDeletes');
});

client.on('guildBanAdd', async (ban) => {
  const logs = await ban.guild.fetchAuditLogs({ type: AuditLogEvent.MemberBanAdd, limit: 1 }).catch(() => null);
  const entry = logs?.entries.first();
  if (entry && Date.now() - entry.createdTimestamp < 5000) await recordNukeAction(ban.guild, 'bans', entry.executor?.id, 'maxBans');
});

client.on('inviteCreate', (invite) => {
  if (!invite.guild) return;
  const data = getData(invite.guild.id);
  data.invitesCache[invite.code] = { uses: invite.uses || 0, inviterId: invite.inviter?.id || null };
  saveData(invite.guild.id, data);
});

process.on('unhandledRejection', (error) => console.error('Unhandled promise rejection:', error));

client.login(process.env.DISCORD_TOKEN);
