import { Routes } from 'discord.js';
import { commands } from './command-definitions.js';

export async function registerCommands(rest, applicationId, legacyGuildId) {
  await rest.put(Routes.applicationCommands(applicationId), { body: commands });
  let removed = 0;
  if (legacyGuildId) {
    const localCommands = await rest.get(Routes.applicationGuildCommands(applicationId, legacyGuildId));
    const ownedNames = new Set(commands.map(command => command.name));
    for (const command of localCommands) {
      if (!ownedNames.has(command.name) || command.type !== 1) continue;
      await rest.delete(Routes.applicationGuildCommand(applicationId, legacyGuildId, command.id));
      removed++;
    }
  }
  return { count: commands.length, removed };
}
