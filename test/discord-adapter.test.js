import test from 'node:test';
import assert from 'node:assert/strict';
import { Client, Guild, ChannelType, PermissionFlagsBits as P } from 'discord.js';
import { copyCategoryOverwrites } from '../src/permissions.js';

test('discord.js sérialise les permissions pour l’API et reconnaît le vocal comme synchronisé', async t => {
  const ids = {
    guild: '123456789012345678', category: '123456789012345679',
    voice: '123456789012345680', role: '123456789012345681', user: '123456789012345682',
  };
  const client = new Client({ intents: [] });
  t.after(() => client.destroy());
  const rawRules = [
    { id: ids.guild, type: 0, allow: '0', deny: String(P.ViewChannel) },
    { id: ids.role, type: 0, allow: String(P.ViewChannel | P.Connect), deny: String(P.SendMessages) },
    { id: ids.user, type: 1, allow: '0', deny: String(P.Connect) },
  ];
  const guild = new Guild(client, {
    id: ids.guild, name: 'Test', owner_id: ids.user,
    roles: [{ id: ids.guild, name: '@everyone', permissions: '0' }],
    channels: [{ id: ids.category, guild_id: ids.guild, name: 'Vocaux', type: ChannelType.GuildCategory, permission_overwrites: rawRules }],
  });
  client.guilds.cache.set(guild.id, guild);
  const category = guild.channels.cache.get(ids.category);
  // Seule la requête réseau est remplacée : utiliser les vrais objets discord.js.
  client.rest.post = async (route, { body }) => {
    assert.equal(route, `/guilds/${ids.guild}/channels`);
    assert.deepEqual(body.permission_overwrites, rawRules);
    assert.equal(body.parent_id, ids.category);
    return { ...body, id: ids.voice, guild_id: ids.guild };
  };
  const channel = await guild.channels.create({
    name: 'Test', type: ChannelType.GuildVoice, parent: category.id,
    permissionOverwrites: copyCategoryOverwrites(category), userLimit: 3,
  });
  assert.equal(channel.permissionsLocked, true);
  assert.equal(channel.userLimit, 3);
});
