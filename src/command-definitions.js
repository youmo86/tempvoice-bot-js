import { ApplicationIntegrationType, ChannelType, InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';

export const commands = [
  new SlashCommandBuilder()
    .setName('setup').setDescription('Configure un générateur de salons vocaux temporaires.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption(o => o.setName('pilote').setDescription('Vocal à rejoindre pour créer un salon.').addChannelTypes(ChannelType.GuildVoice).setRequired(true))
    .addChannelOption(o => o.setName('categorie').setDescription('Catégorie dont les permissions seront synchronisées.').addChannelTypes(ChannelType.GuildCategory).setRequired(true))
    .addStringOption(o => o.setName('modele').setDescription('Nom des salons ; {user} sera remplacé par le nom du membre.').setMinLength(1).setMaxLength(100))
    .addIntegerOption(o => o.setName('limite').setDescription('Nombre de places : 0 = sans limite.').setMinValue(0).setMaxValue(99)),
  new SlashCommandBuilder()
    .setName('pilotes').setDescription('Liste ou désactive les générateurs.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(s => s.setName('liste').setDescription('Affiche la configuration des générateurs.'))
    .addSubcommand(s => s.setName('supprimer').setDescription('Désactive un générateur sans supprimer son vocal.')
      .addChannelOption(o => o.setName('pilote').setDescription('Générateur à désactiver.').addChannelTypes(ChannelType.GuildVoice).setRequired(true))),
  new SlashCommandBuilder()
    .setName('vocal').setDescription('Consulte le salon temporaire dans lequel tu te trouves.')
    .addSubcommand(s => s.setName('infos').setDescription('Affiche le créateur et l’état des permissions.')),
].map(command => command
  .setContexts(InteractionContextType.Guild)
  .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
  .toJSON());
