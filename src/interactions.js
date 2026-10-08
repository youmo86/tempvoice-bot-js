import { ChannelType, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { UserError, safeError, userMessage } from './errors.js';

const supported = new Set(['setup', 'pilotes', 'vocal']);

export async function handleInteraction(interaction, { manager, log = console }) {
  if (!interaction.isChatInputCommand() || !supported.has(interaction.commandName)) return;
  const replyOptions = { allowedMentions: { parse: [] } };
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const guild = interaction.guild;
    if (!guild || interaction.guildId !== guild.id) throw new UserError('Utilise cette commande dans un serveur Discord.');
    const context = manager.getContext(guild);
    if (!context) throw new UserError('Le serveur est momentanément indisponible.');
    const { queue, service, store } = context;
    const content = await queue.run(async () => {
      if (manager.closing || context.retired || !guild.available) throw new UserError('Le serveur est momentanément indisponible.');
      if (!service.active) throw new UserError('Le bot démarre ; réessaie dans quelques secondes.');
      const member = await guild.members.fetch(interaction.user.id);
      if (!member) throw new UserError('Ton compte n’est plus membre de ce serveur.');
      const admin = member.permissions.has(PermissionFlagsBits.ManageGuild);
      if (interaction.commandName !== 'vocal' && !admin) throw new UserError('La permission « Gérer le serveur » est requise.');

      if (interaction.commandName === 'setup') {
        const pilotId = interaction.options.getChannel('pilote', true).id;
        const categoryId = interaction.options.getChannel('categorie', true).id;
        const channels = await guild.channels.fetch();
        if (!channels.has(pilotId) || !channels.has(categoryId)) throw new UserError('Le pilote et la catégorie doivent appartenir à ce serveur.');
        const pilot = await guild.channels.fetch(pilotId, { force: true });
        const category = await guild.channels.fetch(categoryId, { force: true });
        if (!pilot || !category) throw new UserError('Le pilote ou la catégorie est introuvable.');
        const template = interaction.options.getString('modele')?.trim() || 'Salon de {user}';
        await service.setup(guild, pilot, category, template, interaction.options.getInteger('limite') ?? 0);
        return `Pilote <#${pilot.id}> configuré vers <#${category.id}>. Les nouveaux salons reprennent exactement les permissions de cette catégorie.`;
      }
      if (interaction.commandName === 'pilotes') {
        if (interaction.options.getSubcommand() === 'supprimer') {
          const id = interaction.options.getChannel('pilote', true).id;
          const pilot = store.getPilot(guild.id, id);
          if (!pilot) throw new UserError('Ce salon n’est pas un pilote configuré.');
          store.removePilot(guild.id, id);
          return `Le pilote <#${id}> est désactivé. Les salons temporaires déjà créés continuent d’être gérés.`;
        }
        const pilots = store.listPilots(guild.id);
        if (!pilots.length) return 'Aucun pilote. Configure un vocal existant avec /setup.';
        return pilots.map(p => `<#${p.channelId}> → <#${p.categoryId}> · ${p.userLimit || 'illimité'} places`).join('\n').slice(0, 1900);
      }

      const id = member.voice.channelId;
      const room = id && store.getRoom(guild.id, id);
      if (!room) throw new UserError('Rejoins un salon temporaire géré par ce bot.');
      const channel = await service.trackedChannel(guild, room, true);
      if (!channel || channel.type !== ChannelType.GuildVoice) throw new UserError('Ce salon n’est plus géré par le bot.');
      if (member.voice.channelId !== id) throw new UserError('Tu as changé de salon pendant la commande ; réessaie.');
      const action = interaction.options.getSubcommand();
      if (action === 'infos') {
        return `Salon <#${id}> · créateur <@${room.ownerId}> · ${channel.userLimit || 'illimité'} places · permissions ${channel.permissionsLocked === true ? 'synchronisées avec la catégorie' : 'en cours de synchronisation'}.`;
      }
      throw new UserError('Action inconnue.');
    });
    await interaction.editReply({ content, ...replyOptions });
  } catch (error) {
    log.error(`[commande] ${interaction.commandName} : ${safeError(error)}`);
    const message = { content: userMessage(error), ...replyOptions };
    try {
      if (interaction.deferred || interaction.replied) await interaction.editReply(message);
      else await interaction.reply({ ...message, flags: MessageFlags.Ephemeral });
    } catch (replyError) { log.error(`[commande] Réponse impossible : ${safeError(replyError)}`); }
  }
}
