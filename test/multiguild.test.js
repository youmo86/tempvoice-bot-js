import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PermissionFlagsBits as P, PermissionsBitField } from 'discord.js';
import { Store } from '../src/store.js';
import { GuildManager } from '../src/guild-manager.js';
import { handleInteraction } from '../src/interactions.js';
import { fixture, interactionFor } from './fakes.js';

function multi(t, options = {}) {
  const store = new Store(options.path ?? ':memory:');
  const a = fixture(t, ':memory:', { guildId: 'server-a', store });
  const b = fixture(t, ':memory:', { guildId: 'server-b', store });
  const config = { emptyDeleteDelayMs: 10000, creationCooldownMs: 10000, maxTempChannels: 30, ...options.config };
  const manager = new GuildManager({ store, config, log: a.log });
  function context(f) {
    const value = manager.getContext(f.guild);
    if (value) {
      value.service.timers = f.timers;
      value.service.now = () => 100000;
    }
    return value;
  }
  context(a);
  context(b);
  const ready = () => manager.reconcileAll([a.guild, b.guild]);
  async function enter(f, member = f.member) {
    await member.voice.setChannel(f.pilot);
    await manager.run(f.guild, value => value.service.onVoiceState(
      { channelId: null }, { guild: f.guild, channelId: f.pilot.id, member },
    ));
    return f.guild.channels.cache.get(member.voice.channelId);
  }
  async function command(f, member, name, action, values = {}) {
    const interaction = interactionFor(f, member, action, values);
    interaction.commandName = name;
    await handleInteraction(interaction, { manager, log: a.log });
    return interaction.response.content;
  }
  t.after(async () => { manager.dispose(); await manager.idle(); store.close(); });
  return { store, manager, a, b, ready, enter, command, context };
}

test('chaque serveur possède ses propres réglages, liste et désactivation de pilotes', async t => {
  const m = multi(t);
  await m.ready();
  const adminA = m.a.addMember('admin', true);
  const adminB = m.b.addMember('admin', true);
  assert.match(await m.command(m.a, adminA, 'setup', null, {
    pilote: m.a.pilot, categorie: m.a.category, modele: 'A / {user}', limite: 2,
  }), /configuré/);
  assert.match(await m.command(m.b, adminB, 'setup', null, {
    pilote: m.b.pilot, categorie: m.b.category, modele: 'B / {user}', limite: 5,
  }), /configuré/);
  const [roomA, roomB] = await Promise.all([m.enter(m.a), m.enter(m.b)]);
  assert.equal(roomA.name, 'A / flavien');
  assert.equal(roomB.name, 'B / flavien');
  assert.equal(roomA.userLimit, 2);
  assert.equal(roomB.userLimit, 5);
  const list = await m.command(m.a, adminA, 'pilotes', 'liste');
  assert.ok(list.includes(m.a.pilot.id));
  assert.ok(!list.includes(m.b.pilot.id));
  assert.match(await m.command(m.a, adminA, 'pilotes', 'supprimer', { pilote: m.a.pilot }), /désactivé/);
  assert.equal(m.store.getPilot(m.a.guild.id, m.a.pilot.id), undefined);
  assert.ok(m.store.getPilot(m.b.guild.id, m.b.pilot.id));
  assert.ok(m.store.getRoom(m.a.guild.id, roomA.id));
});

test('le même utilisateur crée dans deux serveurs avec des quotas et délais indépendants', async t => {
  const m = multi(t, { config: { maxTempChannels: 1 } });
  await m.ready();
  const roomA = await m.enter(m.a);
  const roomB = await m.enter(m.b);
  assert.notEqual(roomA.id, roomB.id);
  assert.equal(m.store.listRooms(m.a.guild.id).length, 1);
  assert.equal(m.store.listRooms(m.b.guild.id).length, 1);
  const another = m.a.addMember('another');
  await assert.rejects(() => m.enter(m.a, another), /maximal/);
  await m.a.member.voice.setChannel(null);
  await m.context(m.a).service.deleteIfEmpty(m.a.guild, roomA.id);
  await assert.rejects(() => m.enter(m.a), /rapprochées/);
  assert.equal(roomB.deleteCalls, 0);
  assert.equal(m.b.guild.created.length, 1);
});

test('un administrateur dans A ne peut pas administrer B sans les droits dans B', async t => {
  const m = multi(t);
  await m.ready();
  const adminA = m.a.addMember('same-user', true);
  const normalB = m.b.addMember('same-user');
  assert.match(await m.command(m.a, adminA, 'pilotes', 'liste'), /server-a-pilot/);
  for (const [name, action] of [['setup', null], ['pilotes', 'liste'], ['pilotes', 'supprimer']]) {
    const reply = await m.command(m.b, normalB, name, action, { pilote: m.b.pilot, categorie: m.b.category });
    assert.match(reply, /Gérer le serveur/);
  }
  assert.equal(m.store.listPilots(m.b.guild.id).length, 1);
});

test('un administrateur ne peut pas configurer ni désactiver le pilote d’un autre serveur', async t => {
  const m = multi(t);
  await m.ready();
  const adminB = m.b.addMember('admin', true);
  assert.match(await m.command(m.b, adminB, 'setup', null, {
    pilote: m.a.pilot, categorie: m.b.category,
  }), /appartenir à ce serveur/);
  assert.match(await m.command(m.b, adminB, 'setup', null, {
    pilote: m.b.pilot, categorie: m.a.category,
  }), /appartenir à ce serveur/);
  assert.match(await m.command(m.b, adminB, 'pilotes', 'supprimer', {
    pilote: m.a.pilot,
  }), /pas un pilote configuré/);
  assert.equal(m.store.listPilots(m.a.guild.id).length, 1);
  assert.equal(m.store.listPilots(m.b.guild.id).length, 1);
});

test('la base refuse les lectures, suppressions et mises à jour avec un serveur incorrect', async t => {
  const m = multi(t);
  await m.ready();
  const roomA = await m.enter(m.a);
  assert.equal(m.store.getPilot(m.b.guild.id, m.a.pilot.id), undefined);
  assert.equal(m.store.getRoom(m.b.guild.id, roomA.id), undefined);
  m.store.removePilot(m.b.guild.id, m.a.pilot.id);
  m.store.removeRoom(m.b.guild.id, roomA.id);
  assert.throws(() => m.store.savePilot({
    ...m.store.getPilot(m.a.guild.id, m.a.pilot.id), guildId: m.b.guild.id, nameTemplate: 'Foreign',
  }), /autre serveur/);
  assert.ok(m.store.getRoom(m.a.guild.id, roomA.id));
  assert.equal(m.store.getPilot(m.a.guild.id, m.a.pilot.id).nameTemplate, 'Salon de {user}');
  m.b.member.voice.channelId = roomA.id;
  assert.match(await m.command(m.b, m.b.member, 'vocal', 'infos'), /Rejoins un salon temporaire/);
});

test('une modification de catégorie et un nettoyage de A ne touchent aucun salon de B', async t => {
  const m = multi(t);
  await m.ready();
  const roomA = await m.enter(m.a);
  const roomB = await m.enter(m.b);
  m.a.category.permissionOverwrites.cache.get('members-role').deny = new PermissionsBitField(P.SendMessages | P.Stream);
  await m.manager.run(m.a.guild, value => value.service.onChannelUpdate(m.a.category));
  assert.equal(roomA.permissionOverwrites.cache.get('members-role').deny.bitfield, P.SendMessages | P.Stream);
  assert.equal(roomB.permissionOverwrites.cache.get('members-role').deny.bitfield, P.SendMessages);
  await m.a.member.voice.setChannel(null);
  await m.b.member.voice.setChannel(null);
  const serviceA = m.context(m.a).service;
  const foreignRoom = m.store.getRoom(m.b.guild.id, roomB.id);
  serviceA.scheduleDeletion(m.b.guild, foreignRoom);
  await serviceA.deleteIfEmpty(m.b.guild, roomB.id);
  serviceA.forget(roomB.id);
  await m.manager.reconcile(m.a.guild);
  await m.a.timers.fireAll();
  assert.equal(roomA.deleteCalls, 1);
  assert.equal(roomB.deleteCalls, 0);
  assert.ok(m.store.getRoom(m.b.guild.id, roomB.id));
  assert.equal(m.b.staticRoom.deleteCalls, 0);
});

test('une requête lente sur A ne bloque pas les commandes de B', async t => {
  const m = multi(t);
  await m.ready();
  const started = Promise.withResolvers();
  const hold = Promise.withResolvers();
  const pending = m.manager.run(m.a.guild, async () => { started.resolve(); await hold.promise; });
  t.after(() => hold.resolve());
  await started.promise;
  const adminB = m.b.addMember('admin', true);
  try {
    const reply = await m.command(m.b, adminB, 'pilotes', 'liste');
    assert.match(reply, /server-b-pilot/);
  } finally { hold.resolve(); await pending; }
});

test('une erreur de reprise sur A laisse B fonctionner et permet de retenter A', async t => {
  const m = multi(t);
  m.a.guild.fetchAllError = new Error('Expected failure A');
  await m.ready();
  assert.equal(m.context(m.a).service.active, false);
  assert.equal(m.context(m.b).service.active, true);
  assert.ok((await m.enter(m.b)).id.startsWith('server-b-room'));
  assert.ok(m.a.logs.some(line => line.includes('[serveur server-a]')));
  delete m.a.guild.fetchAllError;
  await m.manager.reconcile(m.a.guild);
  assert.equal(m.context(m.a).service.active, true);
  assert.ok((await m.enter(m.a)).id.startsWith('server-a-room'));
});

test('un serveur indisponible conserve ses données et reprend sans interrompre les autres', async t => {
  const m = multi(t);
  await m.ready();
  const roomA = await m.enter(m.a);
  await m.a.member.voice.setChannel(null);
  await m.manager.reconcile(m.a.guild);
  assert.equal(m.a.timers.pending.size, 1);
  const old = m.context(m.a);
  m.a.guild.available = false;
  m.manager.remove(m.a.guild.id);
  assert.equal(old.service.active, false);
  assert.equal(m.a.timers.pending.size, 0);
  assert.equal(m.manager.getContext(m.a.guild), null);
  assert.ok(m.store.getPilot(m.a.guild.id, m.a.pilot.id));
  assert.ok(m.store.getRoom(m.a.guild.id, roomA.id));
  assert.ok((await m.enter(m.b)).id.startsWith('server-b-room'));
  m.a.guild.available = true;
  assert.notEqual(m.context(m.a), old);
  await m.manager.reconcile(m.a.guild);
  await m.a.timers.fireAll();
  assert.equal(roomA.deleteCalls, 1);
  assert.equal(m.store.listRooms(m.b.guild.id).length, 1);
});

test('une réinvitation attend une ancienne création en cours sur ce même serveur', async t => {
  const m = multi(t);
  await m.ready();
  const started = Promise.withResolvers();
  const finish = Promise.withResolvers();
  m.a.guild.afterCreate = async () => { started.resolve(); await finish.promise; };
  const creating = m.enter(m.a);
  t.after(() => finish.resolve());
  await started.promise;
  const old = m.context(m.a);
  m.manager.remove(m.a.guild.id);
  const replacement = m.context(m.a);
  assert.notEqual(old, replacement);
  assert.equal(old.queue, replacement.queue);
  const resuming = m.manager.reconcile(m.a.guild);
  finish.resolve();
  await creating;
  await resuming;
  assert.equal(m.a.guild.created.length, 1);
  assert.equal(m.a.member.voice.channelId, 'server-a-room-1');
  assert.equal(m.store.listRooms(m.a.guild.id).length, 1);
});

test('deux demandes de reprise simultanées ne dupliquent pas les créations', async t => {
  const m = multi(t);
  await m.a.member.voice.setChannel(m.a.pilot);
  await Promise.all([m.manager.reconcile(m.a.guild), m.manager.reconcile(m.a.guild)]);
  assert.equal(m.a.guild.created.length, 1);
  assert.equal(m.store.listRooms(m.a.guild.id).length, 1);
});

test('un redémarrage conserve les réglages et les salons de deux serveurs dans la même base', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'tempvoice-multi-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, 'state.sqlite');
  const m = multi(t, { path });
  await m.ready();
  const [roomA, roomB] = await Promise.all([m.enter(m.a), m.enter(m.b)]);
  // Une seconde connexion reproduit l'ouverture du fichier après un redémarrage.
  m.manager.dispose();
  await m.manager.idle();
  const reopened = new Store(path);
  const next = new GuildManager({ store: reopened, config: m.manager.config, log: m.a.log });
  t.after(async () => { next.dispose(); await next.idle(); reopened.close(); });
  await next.reconcileAll([m.a.guild, m.b.guild]);
  assert.equal(reopened.getRoom(m.a.guild.id, roomA.id).ownerId, 'flavien');
  assert.equal(reopened.getRoom(m.b.guild.id, roomB.id).ownerId, 'flavien');
  assert.equal(reopened.listPilots(m.a.guild.id).length, 1);
  assert.equal(reopened.listPilots(m.b.guild.id).length, 1);
  assert.equal(reopened.getRoom(m.a.guild.id, roomB.id), undefined);
  assert.equal(m.a.guild.created.length, 1);
  assert.equal(m.b.guild.created.length, 1);
});

test('les commandes en message privé sont refusées sans accéder aux données d’un serveur', async t => {
  const m = multi(t);
  const interaction = interactionFor(m.a, m.a.member, 'infos');
  interaction.guild = null;
  interaction.guildId = null;
  await handleInteraction(interaction, { manager: m.manager, log: m.a.log });
  assert.match(interaction.response.content, /dans un serveur Discord/);
});
