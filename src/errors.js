export class UserError extends Error {}

export function isUnknownChannel(error) {
  return Number(error?.code) === 10003;
}

// Ne pas journaliser l'objet DiscordAPIError complet : il contient la requête.
export function safeError(error) {
  if (error instanceof UserError) return error.message;
  if (error?.code !== undefined) return `Erreur ${error.name || 'API'} (code ${error.code}).`;
  return error instanceof Error ? error.message : 'Erreur inattendue.';
}

export function userMessage(error) {
  if (error instanceof UserError) return error.message;
  if (Number(error?.code) === 50013 || Number(error?.code) === 50001) {
    return 'Le bot manque de permissions. Vérifie son rôle et ses accès au pilote et à la catégorie.';
  }
  if (isUnknownChannel(error)) return 'Ce salon a été supprimé. Recommence dans un salon disponible.';
  return 'L’action a échoué. Un administrateur peut consulter les journaux du bot.';
}
