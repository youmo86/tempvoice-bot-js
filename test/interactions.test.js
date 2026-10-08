import test from 'node:test';
import assert from 'node:assert/strict';
import { MessageFlags } from 'discord.js';
import { handleInteraction } from '../src/interactions.js';
import { fixture, interactionFor } from './fakes.js';

test('un membre du salon peut consulter les informations sans modifier son état', async t => {
  const f = fixture(t);
  const room = await f.enter();
  const other = f.addMember('other');
  await other.voice.setChannel(room);
  const interaction = interactionFor(f, other, 'infos');
  await handleInteraction(interaction, f);
  assert.match(interaction.response.content, /créateur <@flavien>/);
  assert.match(interaction.response.content, /synchronisées avec la catégorie/);
  assert.equal(room.name, 'Salon de flavien');
  assert.equal(interaction.initialReply.flags, MessageFlags.Ephemeral);
  assert.equal(f.store.getRoom(f.guild.id, room.id).ownerId, f.member.id);
  assert.equal(room.permissionsLocked, true);
  assert.equal(room.lockCalls, 0);
});

test('des commandes anciennes encore affichées dans Discord ne peuvent plus modifier le salon', async t => {
  const f = fixture(t);
  const room = await f.enter();
  const admin = f.addMember('admin', true);
  await admin.voice.setChannel(room);
  for (const action of ['renommer', 'limite', 'reclamer']) {
    const interaction = interactionFor(f, f.member, action, { nom: 'Modifié', nombre: 5 });
    await handleInteraction(interaction, f);
    assert.match(interaction.response.content, /Action inconnue/);
  }
  await f.member.voice.setChannel(null);
  for (const action of ['renommer', 'limite', 'reclamer']) {
    const interaction = interactionFor(f, admin, action, { nom: 'Modifié', nombre: 5 });
    await handleInteraction(interaction, f);
    assert.match(interaction.response.content, /Action inconnue/);
  }
  assert.equal(room.name, 'Salon de flavien');
  assert.equal(room.userLimit, 0);
  assert.equal(f.store.getRoom(f.guild.id, room.id).ownerId, f.member.id);
  assert.equal(room.permissionsLocked, true);
});
