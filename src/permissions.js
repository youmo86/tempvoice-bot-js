import { PermissionFlagsBits as P } from 'discord.js';
import { UserError } from './errors.js';

const names = new Map([
  [P.ViewChannel, 'Voir les salons'], [P.Connect, 'Se connecter'],
  [P.ManageChannels, 'Gérer les salons'], [P.ManageRoles, 'Gérer les permissions'],
  [P.MoveMembers, 'Déplacer les membres'],
]);

export const pilotPermissions = [P.ViewChannel, P.Connect, P.MoveMembers];
export const categoryPermissions = [...pilotPermissions, P.ManageChannels, P.ManageRoles];

export function requirePermissions(channel, member, flags) {
  const permissions = channel.permissionsFor(member);
  const missing = flags.filter(flag => !permissions?.has(flag));
  if (missing.length) {
    throw new UserError(`Permissions manquantes pour le bot dans « ${channel.name} » : ${missing.map(f => names.get(f)).join(', ')}.`);
  }
}

export function copyCategoryOverwrites(category) {
  // Copier roles ET membres, les autorisations ET les refus ; aucune exception pour le créateur.
  return [...category.permissionOverwrites.cache.values()].map(overwrite => ({
    id: overwrite.id,
    type: overwrite.type,
    allow: overwrite.allow.bitfield,
    deny: overwrite.deny.bitfield,
  }));
}

export function memberCanEnter(channel, member) {
  return Boolean(channel.permissionsFor(member)?.has([P.ViewChannel, P.Connect]));
}

export function cleanChannelName(value) {
  const result = value.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return [...(result || 'Salon vocal')].slice(0, 100).join('');
}

export function channelName(template, displayName) {
  return cleanChannelName(template.replaceAll('{user}', displayName));
}
