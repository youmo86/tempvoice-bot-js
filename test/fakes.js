import { ChannelType, Collection, PermissionsBitField, PermissionFlagsBits as P } from 'discord.js';
import { Store } from '../src/store.js';
import { SerialQueue } from '../src/queue.js';
import { VoiceService } from '../src/voice-service.js';

const botPermissions = new PermissionsBitField(Object.values(P));
function overwrites(values = []) {
  return new Collection(values.map(value => [value.id, {
    id: value.id, type: value.type,
    allow: new PermissionsBitField(value.allow ?? 0n),
    deny: new PermissionsBitField(value.deny ?? 0n),
  }]));
}
function rules(cache) {
  return [...cache.values()].map(v => `${v.id}/${v.type}/${v.allow.bitfield}/${v.deny.bitfield}`).sort();
}

export class FakeTimers {
  pending = new Map();
  nextId = 1;
  setTimeout = callback => {
    const id = this.nextId++;
    this.pending.set(id, callback);
    return id;
  };
  clearTimeout = id => this.pending.delete(id);
  async fireAll() {
    for (const [id, callback] of [...this.pending]) {
      this.pending.delete(id);
      await callback();
    }
  }
}

export function fixture(t, path = ':memory:', { guildId = 'guild', store: sharedStore } = {}) {
  const store = sharedStore ?? new Store(path);
  const prefix = guildId === 'guild' ? '' : `${guildId}-`;
  const queue = new SerialQueue();
  const timers = new FakeTimers();
  const logs = [];
  const log = { info: s => logs.push(s), warn: s => logs.push(s), error: s => logs.push(s) };
  const config = { guildId, emptyDeleteDelayMs: 10000, creationCooldownMs: 10000, maxTempChannels: 30 };
  const service = new VoiceService({ store, config, queue, timers, log, now: () => 100000 });
  service.active = true;
  let counter = 0;
  const guild = {
    id: config.guildId, available: true, blocked: new Set(), created: [],
    channels: { cache: new Collection() },
    members: { cache: new Collection() },
  };
  guild.channels.fetch = async id => {
    if (!id) {
      if (guild.fetchAllError) throw guild.fetchAllError;
      return guild.channels.cache.clone();
    }
    const error = guild.fetchErrors?.get(id);
    if (error) throw error;
    const channel = guild.channels.cache.get(id);
    if (!channel) throw Object.assign(new Error('Unknown channel'), { code: 10003 });
    return channel;
  };
  function addChannel(id, type, parentId = null, rawRules = []) {
    const channel = {
      id, guild, type, parentId, name: id, userLimit: 0,
      permissionOverwrites: { cache: overwrites(rawRules) },
      members: new Collection(), lockCalls: 0, deleteCalls: 0,
      get permissionsLocked() {
        const parent = guild.channels.cache.get(this.parentId);
        return parent ? JSON.stringify(rules(parent.permissionOverwrites.cache)) === JSON.stringify(rules(this.permissionOverwrites.cache)) : null;
      },
      permissionsFor(member) {
        if (member.id === 'bot') return botPermissions;
        return guild.blocked.has(member.id) ? new PermissionsBitField(P.ViewChannel) : new PermissionsBitField([P.ViewChannel, P.Connect]);
      },
      async lockPermissions() {
        this.lockCalls++;
        this.permissionOverwrites.cache = overwrites([...guild.channels.cache.get(this.parentId).permissionOverwrites.cache.values()].map(v => ({
          id: v.id, type: v.type, allow: v.allow.bitfield, deny: v.deny.bitfield,
        })));
        return this;
      },
      async delete() { this.deleteCalls++; guild.channels.cache.delete(this.id); return this; },
      async setName(name) { this.name = name; return this; },
      async setUserLimit(limit) { this.userLimit = limit; return this; },
    };
    guild.channels.cache.set(id, channel);
    return channel;
  }
  guild.channels.create = async options => {
    guild.created.push(options);
    const channel = addChannel(`${prefix}room-${++counter}`, options.type, options.parent, options.permissionOverwrites);
    channel.name = options.name;
    channel.userLimit = options.userLimit;
    await guild.afterCreate?.(channel);
    return channel;
  };
  function addMember(id, isAdmin = false) {
    const member = {
      id, guild, user: { id, bot: false }, displayName: id,
      permissions: new PermissionsBitField(isAdmin ? P.ManageGuild : 0n),
      voice: {
        channelId: null,
        async setChannel(channel) {
          if (member.moveError) throw member.moveError;
          guild.channels.cache.get(this.channelId)?.members.delete(id);
          this.channelId = channel?.id ?? null;
          channel?.members.set(id, member);
        },
      },
    };
    guild.members.cache.set(id, member);
    return member;
  }
  const me = { id: 'bot', permissions: botPermissions };
  guild.members.fetchMe = async () => me;
  guild.members.fetch = async id => guild.members.cache.get(id);
  const category = addChannel(`${prefix}category`, ChannelType.GuildCategory, null, [
    { id: guild.id, type: 0, deny: P.ViewChannel },
    { id: 'members-role', type: 0, allow: P.ViewChannel | P.Connect, deny: P.SendMessages },
    { id: 'restricted-member', type: 1, deny: P.Connect },
  ]);
  const pilot = addChannel(`${prefix}pilot`, ChannelType.GuildVoice, category.id);
  const staticRoom = addChannel(`${prefix}permanent`, ChannelType.GuildVoice, category.id);
  const member = addMember('flavien');
  store.savePilot({ guildId: guild.id, channelId: pilot.id, categoryId: category.id, nameTemplate: 'Salon de {user}', userLimit: 0 });
  const enter = async () => {
    await member.voice.setChannel(pilot);
    await service.enterPilot(guild, member, store.getPilot(guild.id, pilot.id));
    return guild.channels.cache.get(member.voice.channelId);
  };
  t.after(async () => { service.dispose(); await queue.idle(); if (!sharedStore) { try { store.close(); } catch {} } });
  const context = { store, queue, config, service, retired: false };
  const manager = { getContext: candidate => candidate?.available && candidate.id === guild.id ? context : null };
  return { store, queue, timers, logs, log, config, service, manager, guild, category, pilot, staticRoom, member, enter, addMember, addChannel };
}

export function interactionFor(f, member, subcommand, options = {}) {
  return {
    commandName: 'vocal', guildId: f.guild.id, guild: f.guild, user: member.user,
    isChatInputCommand: () => true,
    deferred: false,
    options: {
      getSubcommand: () => subcommand,
      getChannel: name => options[name],
      getString: name => options[name],
      getInteger: name => options[name],
    },
    async deferReply(value) { this.deferred = true; this.initialReply = value; },
    async editReply(value) { this.response = value; },
  };
}
