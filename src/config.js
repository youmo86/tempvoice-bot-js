import { resolve } from 'node:path';

function required(env, key) {
  const value = env[key]?.trim();
  if (!value || value.startsWith('remplacer_')) {
    throw new Error(`${key} manque dans le fichier .env.`);
  }
  return value;
}

function integer(env, key, fallback, min, max) {
  const value = env[key] === undefined ? fallback : Number(env[key]);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${key} doit être un entier entre ${min} et ${max}.`);
  }
  return value;
}

export function readConfig(env = process.env) {
  const applicationId = required(env, 'DISCORD_APPLICATION_ID');
  if (!/^\d{17,20}$/.test(applicationId)) {
    throw new Error('DISCORD_APPLICATION_ID doit contenir 17 à 20 chiffres.');
  }
  return {
    token: required(env, 'DISCORD_TOKEN'),
    applicationId,
    databasePath: resolve(env.DATABASE_PATH?.trim() || './data/tempvoice.sqlite'),
    emptyDeleteDelayMs: integer(env, 'EMPTY_DELETE_DELAY_MS', 10000, 1000, 300000),
    creationCooldownMs: integer(env, 'CREATION_COOLDOWN_MS', 10000, 1000, 300000),
    maxTempChannels: integer(env, 'MAX_TEMP_CHANNELS', 30, 1, 400),
  };
}

// Ancienne variable utilisée seulement pour retirer les commandes locales de la V1.
export function readLegacyGuildId(env = process.env) {
  const id = env.DISCORD_GUILD_ID?.trim();
  if (!id || id.startsWith('remplacer_')) return undefined;
  if (!/^\d{17,20}$/.test(id)) throw new Error('DISCORD_GUILD_ID : identifiant invalide pour la migration des anciennes commandes.');
  return id;
}
