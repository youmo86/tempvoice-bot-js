import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fixture } from './fakes.js';
import { Store } from '../src/store.js';
import { VoiceService } from '../src/voice-service.js';
import { SerialQueue } from '../src/queue.js';
import { commands } from '../src/command-definitions.js';
import { readConfig } from '../src/config.js';

test('un redémarrage retrouve pilote et propriétaire puis nettoie les salons vides', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'tempvoice-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, 'state.sqlite');
  const f = fixture(t, path);
  const room = await f.enter();
  f.service.dispose();
  f.store.close();
  const reopened = new Store(path);
  const second = new VoiceService({ store: reopened, config: f.config, queue: f.queue, timers: f.timers, log: f.log });
  second.active = true;
  t.after(() => { second.dispose(); reopened.close(); });
  assert.equal(reopened.getPilot(f.guild.id, f.pilot.id).nameTemplate, 'Salon de {user}');
  assert.equal(reopened.getRoom(f.guild.id, room.id).ownerId, f.member.id);
  await second.reconcile(f.guild);
  assert.equal(f.timers.pending.size, 0);
  await f.member.voice.setChannel(null);
  await second.reconcile(f.guild);
  assert.equal(f.timers.pending.size, 1);
  await f.timers.fireAll();
  assert.equal(reopened.getRoom(f.guild.id, room.id), undefined);
  assert.ok(f.guild.channels.cache.has(f.staticRoom.id));
});

test('une erreur dans la file n’empêche pas les commandes suivantes', async () => {
  const queue = new SerialQueue();
  const values = [];
  const first = queue.run(async () => { values.push(1); throw new Error('Expected'); });
  const second = queue.run(async () => { values.push(2); return 42; });
  await assert.rejects(first);
  assert.equal(await second, 42);
  assert.deepEqual(values, [1, 2]);
});

test('les commandes d’administration sont restreintes et toutes les définitions sont sérialisables', () => {
  assert.ok(commands.find(c => c.name === 'setup').default_member_permissions);
  assert.ok(commands.find(c => c.name === 'pilotes').default_member_permissions);
  assert.doesNotThrow(() => JSON.stringify(commands));
  assert.equal(commands.length, 3);
  assert.deepEqual(commands.find(c => c.name === 'vocal').options.map(option => option.name), ['infos']);
});

test('la configuration refuse les valeurs invalides sans afficher le token', () => {
  const env = { DISCORD_APPLICATION_ID: '123456789012345678', DISCORD_GUILD_ID: '123456789012345679', DISCORD_TOKEN: 'secret', EMPTY_DELETE_DELAY_MS: 'oops' };
  assert.throws(() => readConfig(env), /EMPTY_DELETE_DELAY_MS/);
  delete env.EMPTY_DELETE_DELAY_MS;
  assert.equal(readConfig(env).emptyDeleteDelayMs, 10000);
});
