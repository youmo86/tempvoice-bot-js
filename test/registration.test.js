import test from 'node:test';
import assert from 'node:assert/strict';
import { ApplicationIntegrationType, InteractionContextType, Routes } from 'discord.js';
import { commands } from '../src/command-definitions.js';
import { readConfig, readLegacyGuildId } from '../src/config.js';
import { registerCommands } from '../src/registration.js';

test('une installation multiserveur n’a besoin que du token et de l’identifiant de l’application', () => {
  const env = { DISCORD_TOKEN: 'test-only', DISCORD_APPLICATION_ID: '123456789012345678' };
  assert.equal(readConfig(env).maxTempChannels, 30);
  assert.equal(readConfig(env).guildId, undefined);
  assert.equal(readLegacyGuildId(env), undefined);
  assert.equal(readLegacyGuildId({ ...env, DISCORD_GUILD_ID: 'remplacer_par_serveur_id' }), undefined);
  assert.equal(readLegacyGuildId({ ...env, DISCORD_GUILD_ID: '123456789012345679' }), '123456789012345679');
  assert.throws(() => readLegacyGuildId({ ...env, DISCORD_GUILD_ID: 'incorrect' }), /migration/);
  // Une ancienne variable ne restreint pas les serveurs au démarrage.
  assert.equal(readConfig({ ...env, DISCORD_GUILD_ID: 'incorrect' }).guildId, undefined);
});

test('les commandes sont globales, réservées aux serveurs et aux installations sur serveur', async () => {
  const applicationId = '123456789012345678';
  const calls = [];
  const rest = {
    async put(route, payload) { calls.push({ route, payload }); },
    async get() { throw new Error('Aucune requête locale attendue'); },
    async delete() { throw new Error('Aucune suppression attendue'); },
  };
  assert.deepEqual(await registerCommands(rest, applicationId), { count: 3, removed: 0 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].route, Routes.applicationCommands(applicationId));
  assert.deepEqual(calls[0].payload.body, commands);
  for (const command of commands) {
    assert.deepEqual(command.contexts, [InteractionContextType.Guild]);
    assert.deepEqual(command.integration_types, [ApplicationIntegrationType.GuildInstall]);
  }
});

test('la migration retire les anciennes commandes locales du bot et conserve les autres', async () => {
  const app = '123456789012345678';
  const guild = '123456789012345679';
  const calls = [];
  const rest = {
    async put(route) { calls.push(['put', route]); },
    async get(route) {
      calls.push(['get', route]);
      return [
        { id: '1', name: 'setup', type: 1 },
        { id: '2', name: 'pilotes', type: 1 },
        { id: '3', name: 'vocal', type: 1 },
        { id: '4', name: 'other', type: 1 },
        { id: '5', name: 'vocal', type: 2 },
      ];
    },
    async delete(route) { calls.push(['delete', route]); },
  };
  assert.deepEqual(await registerCommands(rest, app, guild), { count: 3, removed: 3 });
  assert.deepEqual(calls, [
    ['put', Routes.applicationCommands(app)],
    ['get', Routes.applicationGuildCommands(app, guild)],
    ...['1', '2', '3'].map(id => ['delete', Routes.applicationGuildCommand(app, guild, id)]),
  ]);
});
