import { Client, Events, GatewayIntentBits } from 'discord.js';
import { readConfig } from './config.js';
import { Store } from './store.js';
import { GuildManager } from './guild-manager.js';
import { handleInteraction } from './interactions.js';
import { safeError } from './errors.js';

let config;
try { config = readConfig(); }
catch (error) { console.error(safeError(error)); process.exit(1); }

const store = new Store(config.databasePath);
const manager = new GuildManager({ store, config });
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
  allowedMentions: { parse: [] },
});
let maintenance;
let stopping = false;
function queued(guild, operation) {
  if (stopping || !guild?.available || !client.guilds.cache.has(guild.id)) return;
  manager.run(guild, operation).catch(error => console.error(`[serveur ${guild.id}] ${safeError(error)}`));
}

client.once(Events.ClientReady, async readyClient => {
  try {
    if (readyClient.user.id !== config.applicationId) throw new Error('DISCORD_APPLICATION_ID ne correspond pas au bot connecté.');
    if (stopping) return;
    await manager.reconcileAll(readyClient.guilds.cache.values());
    if (stopping) return;
    console.log(`Connecté : ${readyClient.user.tag}. Mode multiserveur : ${readyClient.guilds.cache.size} serveur(s).`);
    maintenance = setInterval(() => {
      if (!stopping) manager.reconcileAll(client.guilds.cache.values());
    }, 60000);
    maintenance.unref();
  } catch (error) {
    console.error(`[démarrage] ${safeError(error)}`);
    await stop(1);
  }
});

client.on(Events.VoiceStateUpdate, (oldState, newState) => {
  if (oldState.channelId === newState.channelId) return;
  queued(newState.guild, context => context.service.onVoiceState(oldState, newState));
});
client.on(Events.ChannelUpdate, (_oldChannel, channel) => {
  queued(channel.guild, context => context.service.onChannelUpdate(channel));
});
client.on(Events.ChannelDelete, channel => {
  queued(channel.guild, context => {
    store.removePilot(channel.guild.id, channel.id);
    context.service.forget(channel.id);
  });
});

function resumeGuild(guild) {
  if (stopping || !client.isReady()) return;
  manager.reconcile(guild).catch(error => console.error(`[serveur ${guild.id}] Reprise : ${safeError(error)}`));
}
client.on(Events.GuildCreate, resumeGuild);
client.on(Events.GuildAvailable, resumeGuild);
client.on(Events.GuildDelete, guild => manager.remove(guild.id));
client.on(Events.GuildUnavailable, guild => manager.remove(guild.id));
client.on(Events.InteractionCreate, interaction => {
  if (!stopping) handleInteraction(interaction, { manager });
});
client.on(Events.Error, error => console.error(`[discord] ${safeError(error)}`));
client.rest.on('rateLimited', data => console.warn(`[discord] Limite API ; attente ${data.timeToReset} ms.`));

async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  clearInterval(maintenance);
  manager.dispose();
  client.destroy();
  // Laisser finir les mutations déjà commencées sur chaque serveur.
  const deadline = setTimeout(() => process.exit(code || 1), 15000);
  await manager.idle();
  store.close();
  clearTimeout(deadline);
  process.exit(code);
}
process.once('SIGINT', () => stop());
process.once('SIGTERM', () => stop());
process.on('unhandledRejection', error => {
  console.error(`[fatal] ${safeError(error)}`);
  stop(1);
});
try { await client.login(config.token); }
catch (error) { console.error(`[connexion] ${safeError(error)}`); await stop(1); }
