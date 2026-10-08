import { ChannelType } from 'discord.js';
import { UserError, isUnknownChannel, safeError } from './errors.js';
import {
  categoryPermissions, pilotPermissions, requirePermissions,
  copyCategoryOverwrites, memberCanEnter, channelName,
} from './permissions.js';

export class VoiceService {
  constructor({ store, config, queue, log = console, now = Date.now, timers = globalThis }) {
    Object.assign(this, { store, config, queue, log, now, timers });
    this.deleteTimers = new Map();
    this.lastCreationAt = new Map();
    this.active = false;
  }

  async setup(guild, pilot, category, nameTemplate, userLimit) {
    if (guild.id !== this.config.guildId) throw new UserError('Ce serveur ne correspond pas à cette configuration.');
    if (pilot.type !== ChannelType.GuildVoice || category.type !== ChannelType.GuildCategory) {
      throw new UserError('Choisis un vocal comme pilote et une catégorie comme destination.');
    }
    if (pilot.guild.id !== guild.id || category.guild.id !== guild.id) {
      throw new UserError('Le pilote et la catégorie doivent appartenir à ce serveur.');
    }
    if (this.store.getRoom(guild.id, pilot.id)) throw new UserError('Un salon temporaire ne peut pas devenir un pilote.');
    const me = await guild.members.fetchMe();
    requirePermissions(pilot, me, pilotPermissions);
    requirePermissions(category, me, categoryPermissions);
    this.store.savePilot({
      guildId: guild.id, channelId: pilot.id, categoryId: category.id,
      nameTemplate, userLimit,
    });
  }

  async onVoiceState(oldState, newState) {
    const guild = newState.guild;
    if (!this.active || guild.id !== this.config.guildId || !guild.available) return;
    if (oldState.channelId === newState.channelId) return;
    if (newState.channelId) this.cancelDeletion(newState.channelId);
    if (oldState.channelId) {
      const room = this.store.getRoom(guild.id, oldState.channelId);
      if (room) this.scheduleDeletion(guild, room);
    }
    const pilot = newState.channelId && this.store.getPilot(guild.id, newState.channelId);
    const member = newState.member;
    if (pilot && member && !member.user.bot) await this.enterPilot(guild, member, pilot);
  }

  async enterPilot(guild, member, pilot) {
    if (!this.active || !guild.available || guild.id !== this.config.guildId || pilot.guildId !== guild.id) return;
    // Le membre peut avoir quitté le pilote pendant l'attente dans la file.
    if (member.voice.channelId !== pilot.channelId) return;
    const category = await guild.channels.fetch(pilot.categoryId, { force: true });
    const source = await guild.channels.fetch(pilot.channelId);
    if (!category || category.type !== ChannelType.GuildCategory || !source || source.type !== ChannelType.GuildVoice) {
      throw new UserError('Le pilote ou sa catégorie a été supprimé : refais /setup.');
    }
    if (category.guild.id !== guild.id || source.guild.id !== guild.id) {
      throw new UserError('Le pilote et la catégorie doivent appartenir à ce serveur.');
    }
    const me = await guild.members.fetchMe();
    requirePermissions(source, me, pilotPermissions);
    requirePermissions(category, me, categoryPermissions);
    // Un déplacement par le bot ne doit pas contourner les accès de la catégorie.
    if (!memberCanEnter(category, member)) {
      throw new UserError(`Le membre ${member.id} n’a pas accès à la catégorie de destination.`);
    }
    if (!this.active || !guild.available || member.voice.channelId !== pilot.channelId) return;

    const existing = this.store.listRooms(guild.id).find(room => room.ownerId === member.id && room.pilotId === pilot.channelId);
    if (existing) {
      const channel = await this.trackedChannel(guild, existing);
      if (channel) {
        await this.sync(channel);
        if (!memberCanEnter(channel, member)) throw new UserError('Tu n’as plus accès à ton salon existant.');
        if (channel.userLimit && channel.members.size >= channel.userLimit) throw new UserError('Ton salon existant est plein.');
        if (!this.active || !guild.available || member.voice.channelId !== pilot.channelId) return;
        await member.voice.setChannel(channel, 'Retour dans le salon temporaire existant');
        this.cancelDeletion(channel.id);
        return;
      }
    }

    const last = this.lastCreationAt.get(member.id);
    if (last !== undefined && this.now() - last < this.config.creationCooldownMs) {
      throw new UserError('Créations trop rapprochées : attends quelques secondes avant de rejoindre le pilote.');
    }
    if (this.store.listRooms(guild.id).length >= this.config.maxTempChannels) {
      throw new UserError('Le nombre maximal de salons temporaires est atteint.');
    }
    if ([...guild.channels.cache.values()].filter(c => c.parentId === category.id).length >= 50) {
      throw new UserError('La catégorie contient déjà 50 salons.');
    }
    this.lastCreationAt.set(member.id, this.now());
    let channel;
    let recorded = false;
    try {
      // Les règles complètes sont posées dès la création, sans fenêtre de salon public.
      channel = await guild.channels.create({
        name: channelName(pilot.nameTemplate, member.displayName),
        type: ChannelType.GuildVoice,
        parent: category.id,
        userLimit: pilot.userLimit,
        permissionOverwrites: copyCategoryOverwrites(category),
        reason: `Vocal temporaire créé pour ${member.id}`,
      });
      // Enregistrer avant les autres requêtes : une panne ultérieure reste récupérable.
      this.store.saveRoom({
        guildId: guild.id, channelId: channel.id, pilotId: pilot.channelId,
        categoryId: category.id, ownerId: member.id, createdAt: this.now(),
      });
      recorded = true;
      if (!this.active || !guild.available) return;
      // La catégorie a pu changer pendant la création ; utiliser son état actuel.
      await guild.channels.fetch(category.id, { force: true });
      await this.sync(channel);
      if (!this.active || !guild.available || member.voice.channelId !== pilot.channelId) {
        this.scheduleDeletion(guild, this.store.getRoom(guild.id, channel.id));
        return;
      }
      if (!memberCanEnter(channel, member)) throw new UserError('La catégorie ne t’autorise plus à rejoindre ce salon.');
      await member.voice.setChannel(channel, 'Déplacement vers le salon temporaire');
      this.cancelDeletion(channel.id);
      this.log.info(`[vocal] Création ${channel.id}, propriétaire ${member.id}.`);
    } catch (error) {
      if (channel) {
        if (recorded) this.scheduleDeletion(guild, this.store.getRoom(guild.id, channel.id));
        else if (channel.members.size === 0) {
          try { await channel.delete('Échec de l’enregistrement du salon temporaire'); }
          catch (cleanupError) { this.log.error(`[vocal] Salon ${channel.id} à vérifier : ${safeError(cleanupError)}`); }
        }
      }
      throw error;
    }
  }

  async sync(channel) {
    if (channel.permissionsLocked !== true) await channel.lockPermissions();
  }

  async trackedChannel(guild, room, force = false) {
    if (guild.id !== this.config.guildId || room.guildId !== guild.id) return null;
    let channel;
    try { channel = await guild.channels.fetch(room.channelId, { force }); }
    catch (error) {
      if (!isUnknownChannel(error)) throw error;
      this.forget(room.channelId);
      return null;
    }
    if (!channel) return null; // Accès absent : ne pas perdre la trace du salon.
    if (channel.guild.id !== guild.id) return null;
    if (channel.type !== ChannelType.GuildVoice || channel.parentId !== room.categoryId) {
      // Un administrateur l'a déplacé : le bot cesse de le gérer et ne le supprime pas.
      this.forget(room.channelId);
      this.log.warn(`[vocal] Salon ${room.channelId} déplacé ou converti : gestion arrêtée.`);
      return null;
    }
    return channel;
  }

  scheduleDeletion(guild, room) {
    if (!this.active || !guild.available || guild.id !== this.config.guildId || !room || room.guildId !== guild.id || this.deleteTimers.has(room.channelId)) return;
    const channel = guild.channels.cache.get(room.channelId);
    if (!channel || channel.members.size > 0) return;
    const timer = this.timers.setTimeout(() => {
      this.deleteTimers.delete(room.channelId);
      return this.queue.run(() => this.deleteIfEmpty(guild, room.channelId))
        .catch(error => this.log.error(`[vocal] Suppression ${room.channelId} : ${safeError(error)}`));
    }, this.config.emptyDeleteDelayMs);
    timer.unref?.();
    this.deleteTimers.set(room.channelId, timer);
  }

  cancelDeletion(channelId) {
    const timer = this.deleteTimers.get(channelId);
    if (timer !== undefined) this.timers.clearTimeout(timer);
    this.deleteTimers.delete(channelId);
  }

  forget(channelId) {
    this.cancelDeletion(channelId);
    this.store.removeRoom(this.config.guildId, channelId);
  }

  async deleteIfEmpty(guild, channelId) {
    if (!this.active || !guild.available || guild.id !== this.config.guildId) return;
    const room = this.store.getRoom(guild.id, channelId);
    if (!room || room.guildId !== guild.id) return;
    const channel = await this.trackedChannel(guild, room, true);
    if (!this.active || !guild.available || !channel || channel.members.size > 0) return;
    await channel.delete('Salon temporaire vide');
    this.forget(channelId);
    this.log.info(`[vocal] Suppression ${channelId}.`);
  }

  async reconcile(guild) {
    if (!this.active || !guild.available || guild.id !== this.config.guildId) return;
    const channels = await guild.channels.fetch();
    for (const room of this.store.listRooms(guild.id)) {
      if (!this.active || !guild.available) return;
      try {
        const channel = await this.trackedChannel(guild, room, !channels.has(room.channelId));
        if (!channel) continue;
        await this.sync(channel);
        if (channel.members.size === 0) this.scheduleDeletion(guild, room);
        else this.cancelDeletion(channel.id);
      } catch (error) {
        // Une erreur de permission sur un salon ne doit pas bloquer les autres.
        this.log.error(`[vocal] Reprise ${room.channelId} : ${safeError(error)}`);
      }
    }
    for (const pilot of this.store.listPilots(guild.id)) {
      if (!this.active || !guild.available) return;
      const channel = guild.channels.cache.get(pilot.channelId);
      if (!channel) continue;
      for (const member of channel.members.values()) {
        if (member.user.bot) continue;
        try { await this.enterPilot(guild, member, pilot); }
        catch (error) { this.log.error(`[vocal] Pilote ${pilot.channelId} : ${safeError(error)}`); }
      }
    }
  }

  async onChannelUpdate(channel) {
    if (!this.active || channel.guild.id !== this.config.guildId || !channel.guild.available) return;
    if (channel.type === ChannelType.GuildCategory) {
      for (const room of this.store.listRooms(channel.guild.id).filter(r => r.categoryId === channel.id)) {
        try {
          const tracked = await this.trackedChannel(channel.guild, room);
          if (tracked) await this.sync(tracked);
        } catch (error) { this.log.error(`[vocal] Synchronisation ${room.channelId} : ${safeError(error)}`); }
      }
    } else {
      const room = this.store.getRoom(channel.guild.id, channel.id);
      if (room) {
        const tracked = await this.trackedChannel(channel.guild, room);
        if (tracked) await this.sync(tracked);
      }
    }
  }

  dispose() {
    this.active = false;
    for (const channelId of this.deleteTimers.keys()) this.cancelDeletion(channelId);
  }
}
