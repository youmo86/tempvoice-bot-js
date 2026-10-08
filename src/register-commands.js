import { REST } from 'discord.js';
import { readConfig, readLegacyGuildId } from './config.js';
import { registerCommands } from './registration.js';
import { safeError } from './errors.js';

try {
  const config = readConfig();
  const rest = new REST({ version: '10' }).setToken(config.token);
  const legacyGuildId = readLegacyGuildId();
  const result = await registerCommands(rest, config.applicationId, legacyGuildId);
  console.log(`${result.count} commandes globales enregistrées pour tous les serveurs du bot.`);
  if (legacyGuildId) console.log(`${result.removed} anciennes commandes locales retirées du serveur ${legacyGuildId}. Tu peux retirer DISCORD_GUILD_ID de .env.`);
} catch (error) {
  console.error(safeError(error));
  process.exitCode = 1;
}
