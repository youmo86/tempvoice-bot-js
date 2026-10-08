import test from 'node:test';
import assert from 'node:assert/strict';
import { PermissionFlagsBits as P, PermissionsBitField } from 'discord.js';
import { fixture } from './fakes.js';

test('un vocal reprend tous les refus et autorisations de rôles ET de membres, sans exception propriétaire', async t => {
  const f = fixture(t);
  const room = await f.enter();
  assert.equal(room.parentId, f.category.id);
  assert.equal(room.name, 'Salon de flavien');
  assert.equal(room.permissionsLocked, true);
  const options = f.guild.created[0];
  assert.deepEqual(options.permissionOverwrites, [
    { id: f.guild.id, type: 0, allow: 0n, deny: P.ViewChannel },
    { id: 'members-role', type: 0, allow: P.ViewChannel | P.Connect, deny: P.SendMessages },
    { id: 'restricted-member', type: 1, allow: 0n, deny: P.Connect },
  ]);
  assert.ok(!options.permissionOverwrites.some(o => o.id === f.member.id));
  assert.equal(f.store.getRoom(f.guild.id, room.id).ownerId, f.member.id);
});

test('le bot ne déplace pas un utilisateur interdit dans la catégorie', async t => {
  const f = fixture(t);
  await f.member.voice.setChannel(f.pilot);
  f.guild.blocked.add(f.member.id);
  await assert.rejects(() => f.service.enterPilot(f.guild, f.member, f.store.getPilot(f.guild.id, f.pilot.id)), /pas accès/);
  assert.equal(f.guild.created.length, 0);
  assert.equal(f.member.voice.channelId, f.pilot.id);
});

test('deux événements simultanés pour un membre ne créent qu’un salon', async t => {
  const f = fixture(t);
  await f.member.voice.setChannel(f.pilot);
  const state = { guild: f.guild, channelId: f.pilot.id, member: f.member };
  await Promise.all([
    f.queue.run(() => f.service.onVoiceState({ channelId: null }, state)),
    f.queue.run(() => f.service.onVoiceState({ channelId: null }, state)),
  ]);
  assert.equal(f.guild.created.length, 1);
  assert.equal(f.store.listRooms(f.guild.id).length, 1);
});

test('un propriétaire qui repasse dans le pilote retrouve son salon sans duplication', async t => {
  const f = fixture(t);
  const room = await f.enter();
  await f.member.voice.setChannel(f.pilot);
  await f.service.enterPilot(f.guild, f.member, f.store.getPilot(f.guild.id, f.pilot.id));
  assert.equal(f.member.voice.channelId, room.id);
  assert.equal(f.guild.created.length, 1);
});

test('un membre quittant le pilote pendant la requête n’est pas forcé dans le nouveau salon', async t => {
  const f = fixture(t);
  f.guild.afterCreate = async () => { await f.member.voice.setChannel(null); };
  await f.enter();
  assert.equal(f.member.voice.channelId, null);
  assert.equal(f.store.listRooms(f.guild.id).length, 1);
  await f.timers.fireAll();
  assert.equal(f.store.listRooms(f.guild.id).length, 0);
});

test('un échec de déplacement laisse un salon suivi puis nettoyé', async t => {
  const f = fixture(t);
  await f.member.voice.setChannel(f.pilot);
  f.member.moveError = Object.assign(new Error('Denied'), { code: 50013 });
  await assert.rejects(() => f.service.enterPilot(f.guild, f.member, f.store.getPilot(f.guild.id, f.pilot.id)));
  assert.equal(f.store.listRooms(f.guild.id).length, 1);
  await f.timers.fireAll();
  assert.equal(f.store.listRooms(f.guild.id).length, 0);
  assert.ok(f.guild.channels.cache.has(f.staticRoom.id));
});

test('la catégorie changeant pendant la création est reprise avant le déplacement', async t => {
  const f = fixture(t);
  f.guild.afterCreate = async () => {
    const overwrite = f.category.permissionOverwrites.cache.get('members-role');
    overwrite.deny = new PermissionsBitField(P.SendMessages | P.Stream);
  };
  const room = await f.enter();
  assert.equal(room.permissionsLocked, true);
  assert.equal(room.permissionOverwrites.cache.get('members-role').deny.bitfield, P.SendMessages | P.Stream);
  assert.equal(room.lockCalls, 1);
});

test('le retour d’un membre annule la suppression programmée', async t => {
  const f = fixture(t);
  const room = await f.enter();
  await f.member.voice.setChannel(null);
  await f.service.onVoiceState({ channelId: room.id }, { guild: f.guild, channelId: null, member: f.member });
  assert.equal(f.timers.pending.size, 1);
  await f.member.voice.setChannel(room);
  await f.service.onVoiceState({ channelId: null }, { guild: f.guild, channelId: room.id, member: f.member });
  assert.equal(f.timers.pending.size, 0);
  await f.timers.fireAll();
  assert.equal(room.deleteCalls, 0);
});

test('la suppression vérifie à nouveau l’occupation même si l’événement de retour n’a pas été traité', async t => {
  const f = fixture(t);
  const room = await f.enter();
  await f.member.voice.setChannel(null);
  f.service.scheduleDeletion(f.guild, f.store.getRoom(f.guild.id, room.id));
  await f.member.voice.setChannel(room);
  await f.timers.fireAll();
  assert.equal(room.deleteCalls, 0);
  assert.ok(f.store.getRoom(f.guild.id, room.id));
});

test('seul un vocal vide enregistré par le bot peut être supprimé', async t => {
  const f = fixture(t);
  const room = await f.enter();
  await f.member.voice.setChannel(null);
  await f.service.deleteIfEmpty(f.guild, f.staticRoom.id);
  assert.equal(f.staticRoom.deleteCalls, 0);
  await f.service.deleteIfEmpty(f.guild, room.id);
  assert.equal(room.deleteCalls, 1);
  assert.equal(f.store.getRoom(f.guild.id, room.id), undefined);
});

test('un salon déplacé par un administrateur est conservé et cesse d’être géré', async t => {
  const f = fixture(t);
  const room = await f.enter();
  await f.member.voice.setChannel(null);
  room.parentId = null;
  await f.service.deleteIfEmpty(f.guild, room.id);
  assert.equal(room.deleteCalls, 0);
  assert.equal(f.store.getRoom(f.guild.id, room.id), undefined);
});

test('une perte d’accès ne fait pas oublier un salon ; une suppression réelle le fait', async t => {
  const f = fixture(t);
  const room = await f.enter();
  const record = f.store.getRoom(f.guild.id, room.id);
  f.guild.fetchErrors = new Map([[room.id, { code: 50001 }]]);
  await assert.rejects(() => f.service.trackedChannel(f.guild, record, true));
  assert.ok(f.store.getRoom(f.guild.id, room.id));
  f.guild.fetchErrors.set(room.id, { code: 10003 });
  assert.equal(await f.service.trackedChannel(f.guild, record, true), null);
  assert.equal(f.store.getRoom(f.guild.id, room.id), undefined);
});

test('une permission ajoutée individuellement est remise en synchronisation stricte', async t => {
  const f = fixture(t);
  const room = await f.enter();
  room.permissionOverwrites.cache.set('intruder', { id: 'intruder', type: 1, allow: new PermissionsBitField(P.Connect), deny: new PermissionsBitField() });
  assert.equal(room.permissionsLocked, false);
  await f.service.onChannelUpdate(room);
  assert.equal(room.permissionsLocked, true);
  assert.ok(!room.permissionOverwrites.cache.has('intruder'));
});

test('la limite de salons empêche une nouvelle création sans supprimer les salons existants', async t => {
  const f = fixture(t);
  const first = await f.enter();
  f.config.maxTempChannels = 1;
  const other = f.addMember('second');
  await other.voice.setChannel(f.pilot);
  await assert.rejects(() => f.service.enterPilot(f.guild, other, f.store.getPilot(f.guild.id, f.pilot.id)), /maximal/);
  assert.equal(first.deleteCalls, 0);
  assert.equal(f.guild.created.length, 1);
});
