# TempVoice — bot Discord multiserveur en JavaScript

Une version multiserveur pour Linux, basée sur **Node.js + discord.js**.
Une seule application Discord, un seul token et un seul processus gèrent tous
les serveurs où tu invites le bot. Chaque serveur possède sa propre configuration.
Rejoindre un vocal générateur crée un vocal temporaire, déplace le membre dedans
et reprend exactement les permissions de la catégorie choisie. Le vocal est
supprimé après 10 secondes sans membre. La configuration et les propriétaires
sont conservés dans SQLite, via le module intégré à Node.js.

## Fonctionnalités de cette version

- Plusieurs vocaux générateurs, chacun avec sa catégorie, son modèle de nom et sa limite de places.
- Synchronisation stricte des permissions de la catégorie, pour les rôles et les membres.
- Consultation des informations d’un salon temporaire via `/vocal infos`.
- Réutilisation du salon existant quand son propriétaire repasse par le générateur.
- Nettoyage des salons vides après redémarrage et nouvelle tentative après un échec API.
- Délai entre créations par membre et par serveur ; quota de salons propre à chaque serveur.
- Pilotes, modèles de noms, catégories et limites de places configurés séparément sur chaque serveur.
- Vérification des droits d’administration dans le serveur où la commande est utilisée.
- Reprise indépendante d’un serveur après une indisponibilité ou une réinvitation.

Ce bot gère les salons ; il n’a pas besoin de rejoindre les conversations ni de
traiter leur audio. Les réponses aux commandes sont visibles uniquement par leur auteur.

## Permissions de catégorie : le comportement exact

Le bot copie **toutes** les autorisations et **tous** les refus de la catégorie à
la création. Il n’ajoute aucune permission particulière pour le créateur.
Son identité est enregistrée dans la base pour lui permettre de retrouver son
salon existant lorsqu’il repasse par le générateur.

Comme le vocal a les mêmes règles que sa catégorie, les modifications de la
catégorie se répercutent par la synchronisation native de Discord. Le bot
vérifie aussi cette correspondance au démarrage, à chaque mise à jour de salon
ou de catégorie et lors de sa vérification périodique.

**Une permission ajoutée directement sur un vocal géré sera remplacée par les
règles de sa catégorie.** Cette version garde volontairement une synchronisation
stricte. Pour ajouter ensuite des salons privés, des invitations ou des exclusions,
il faudra un mode distinct qui conserve les exceptions et applique les changements
de catégorie via le bot.

Un membre sans droit de voir et rejoindre la catégorie de destination n’est pas
déplacé dedans par le bot. Si un administrateur déplace un vocal temporaire vers
une autre catégorie ou hors d’une catégorie, le bot cesse de le gérer, le conserve
et ne le supprime plus.

## 1. Créer l’application Discord

1. Ouvre <https://discord.com/developers/applications> puis **New Application**.
2. Dans **General Information**, copie **Application ID**.
3. Dans **Bot**, génère ou réinitialise le token et conserve-le pour `.env`.
4. Dans **Installation** ou le générateur d’URL **OAuth2**, active une installation
   sur serveur avec les scopes **bot** et **applications.commands**.
5. Demande au bot les permissions suivantes : **Voir les salons**, **Se connecter**,
   **Gérer les salons**, **Déplacer les membres** et **Gérer les rôles** (appelé
   **Gérer les permissions** dans les paramètres de salon).
6. Ouvre le même lien d’installation pour ajouter le bot à chaque serveur souhaité.
   Dans **Bot**, active **Public Bot** si d’autres personnes doivent pouvoir
   l’inviter sur leurs serveurs. Tu peux le laisser privé pour tes propres serveurs.

Les intents utilisés sont uniquement **Guilds** et **GuildVoiceStates**. Aucun
intent privilégié **Message Content**, **Server Members** ou **Presence** n’est
nécessaire pour cette version.

Vérifie également les permissions du rôle du bot sur la catégorie et le pilote :
un refus local peut annuler une permission de son rôle. Il doit garder ses accès
après la copie des permissions de la catégorie.

L’API Discord limite les permissions qu’un bot peut poser lors d’une création
aux permissions qu’il possède au niveau du serveur. Si ta catégorie contient des
autorisations/refus supplémentaires et que Discord renvoie `50013`, vérifie
aussi les permissions correspondantes dans le rôle du bot. Certaines règles,
notamment la pose de `ManageRoles` dans les dérogations, peuvent nécessiter un
bot administrateur selon l’API. Le bot ne contourne pas ces restrictions.

## 2. Installer et démarrer sous Linux

Prérequis : **Node.js 24.17.0 ou plus récent**, npm et accès sortant vers Discord.
SQLite est intégrée à Node.js ; aucun serveur SQL ni compilation d’une extension
native SQLite n’est nécessaire. La version de discord.js est figée dans le fichier
de dépendances et son verrouillage npm est fourni.

Dans le dossier du projet :

```bash
node --version
npm ci
cp .env.example .env
chmod 600 .env
```

Modifie `.env` et renseigne `DISCORD_TOKEN` et `DISCORD_APPLICATION_ID`.
Aucun identifiant de serveur n’est nécessaire pour une nouvelle installation.
Le token reste sur ton serveur : ne le partage pas et ne le
commite pas dans Git. Les autres valeurs ont des paramètres par défaut.

```bash
npm run register
npm start
```

`register` installe les commandes **globales de cette application**. Elles sont
disponibles sur ses serveurs actuels et futurs, et utilisables uniquement sur
un serveur. Il remplace toutes les commandes globales de l’application : utilise
une application dédiée. Relance-le lors d’une mise à jour des commandes, sans
avoir à le relancer à chaque invitation. Leur affichage dans Discord peut prendre
un peu de temps ; recharge le client si nécessaire.

Le bot doit afficher `Mode multiserveur : ... serveur(s)`. Il peut démarrer sans
serveur puis prendre en charge les nouvelles invitations. Il tourne tant que ce processus
fonctionne. Pour le laisser actif en permanence, choisis systemd ou Docker ci-dessous.
Lance **une seule instance** du bot pour cette application et cette base, même
si tu gères plusieurs serveurs.

## 3. Configurer les générateurs sur chaque serveur

Pour tester, crée un nouveau vocal **➕ Créer un salon**. Ne choisis pas un
générateur encore géré par ChannelManager : les deux bots créeraient des salons.
Pour réutiliser un ancien générateur, désactive-le d’abord dans ChannelManager.

Configure les rôles et permissions sur la **catégorie de destination**. Puis, dans
un salon où tu peux utiliser les commandes d’application :

```text
/setup pilote:➕ Créer un salon categorie:Vocaux modele:Salon de {user} limite:0
```

Discord propose ses sélecteurs de salons/catégories : l’exemple illustre les
valeurs à choisir, pas une chaîne à recopier avec des identifiants textuels.

Seul un membre avec **Gérer le serveur** peut configurer les pilotes. Cette
commande adopte un vocal existant ; elle ne modifie pas ses permissions.
Une nouvelle configuration de pilote s’applique aux prochaines créations.
Répète `/setup` dans chaque serveur souhaité. Être administrateur dans un
serveur ne donne aucun droit de configuration sur les autres serveurs.
Tu peux créer plusieurs pilotes sur un même serveur.

Rejoins le générateur. Tu dois être déplacé dans `Salon de ton pseudo`.
Dans **Modifier le salon → Permissions**, vérifie qu’il est synchronisé avec
la catégorie. Quitte-le : il disparaît après le délai configuré.

## Commandes

| Commande | Qui ? | Effet |
|---|---|---|
| `/setup` | Gérer le serveur | Configure ou met à jour un vocal générateur. |
| `/pilotes liste` | Gérer le serveur | Affiche les pilotes du serveur courant et leur destination. |
| `/pilotes supprimer pilote:...` | Gérer le serveur | Désactive le générateur sans supprimer son vocal. Les temporaires existants restent gérés. |
| `/vocal infos` | Membre présent | Affiche le créateur et l’état de synchronisation. |

### Mise à jour d’une installation existante

La base SQLite de la version précédente est compatible : les enregistrements
possèdent déjà l’identifiant de leur serveur. **Conserve `.env`, le dossier `data`
ou le volume Docker existant.** Arrête l’ancien processus avant de remplacer les
fichiers, puis installe les dépendances de la nouvelle version.

Pour cette première migration, garde l’ancienne valeur `DISCORD_GUILD_ID` dans
`.env` pendant `register` : le script enregistre les commandes globales puis
retire uniquement ses anciennes commandes slash locales (`setup`, `pilotes`,
`vocal`) de ce serveur. Tu peux ensuite supprimer cette variable de `.env` ;
elle n’est jamais utilisée pour restreindre les serveurs au démarrage.

Exemple avec systemd, depuis le dossier d’installation :

```bash
sudo systemctl stop tempvoice-bot
# Remplacer les fichiers du projet en conservant .env et data.
npm ci
npm run register
sudo systemctl start tempvoice-bot
```

Avec Docker Compose :

```bash
docker compose down
# Remplacer les fichiers du projet en conservant .env et le volume existant.
docker compose build
docker compose run --rm bot node src/register-commands.js
docker compose up -d
```

Invite ensuite la même application sur tes autres serveurs et exécute `/setup`
sur chacun. Les commandes pour renommer, modifier les places après création
ou reprendre la propriété restent retirées ; seul `/vocal infos` est proposé
aux membres.

## Option A — service systemd

Pour un Linux avec systemd et Node installé pour le système. Adapte les chemins
si nécessaire ; vérifie `command -v node` et reporte le chemin absolu dans
`ExecStart` du fichier service. L’exemple utilise `/usr/bin/node`.

Depuis le dossier du projet :

```bash
sudo useradd --system --user-group --home-dir /opt/tempvoice-bot --shell /usr/sbin/nologin tempvoice
sudo mkdir -p /opt/tempvoice-bot
sudo cp -a . /opt/tempvoice-bot/
sudo mkdir -p /opt/tempvoice-bot/data
sudo chown -R tempvoice:tempvoice /opt/tempvoice-bot
sudo chmod 600 /opt/tempvoice-bot/.env
sudo cp deploy/tempvoice-bot.service /etc/systemd/system/tempvoice-bot.service
sudo systemctl daemon-reload
sudo systemctl enable --now tempvoice-bot
sudo journalctl -u tempvoice-bot -f
```

Arrête ton lancement manuel avant d’activer le service. Les commandes slash
doivent déjà avoir été enregistrées. Pour arrêter/reprendre :

```bash
sudo systemctl stop tempvoice-bot
sudo systemctl start tempvoice-bot
```

## Option B — Docker Compose

Alternative à systemd ; ne lance pas les deux. Docker et son plugin Compose
doivent être installés. Prépare et remplis `.env` comme ci-dessus, puis :

```bash
docker compose build
docker compose run --rm bot node src/register-commands.js
docker compose up -d
docker compose logs -f bot
```

Le conteneur utilise l’utilisateur `node` et stocke SQLite dans un **volume
persistant**. Aucun port entrant n’est à publier. Le token n’est pas copié dans
l’image. Pour arrêter :

```bash
docker compose down
```

N’ajoute pas `-v` si tu souhaites conserver le volume contenant la configuration.

## Paramètres

| Variable | Défaut | Utilité |
|---|---|---|
| `DATABASE_PATH` | `./data/tempvoice.sqlite` | Base commune ; chaque configuration et salon est associé à son serveur. Docker la fixe dans son volume. |
| `EMPTY_DELETE_DELAY_MS` | `10000` | Attente avant suppression d’un vocal vide. |
| `CREATION_COOLDOWN_MS` | `10000` | Délai entre deux créations par un membre sur un même serveur. |
| `MAX_TEMP_CHANNELS` | `30` | Maximum de vocaux temporaires gérés simultanément sur chaque serveur. |

Les valeurs de `.env` s’appliquent à tous les serveurs, mais chaque serveur
possède son propre compteur de salons et ses propres délais de création.
Le modèle de nom, la catégorie et la limite de places se règlent par pilote
avec `/setup`. Toutes les écritures SQLite sont effectuées immédiatement ;
la conservation après redémarrage fonctionne pour l’ensemble des serveurs.
Les délais entre créations sont conservés en mémoire pendant l’exécution.

Quand le bot quitte un serveur, sa configuration reste dans la base pour
une éventuelle réinvitation. Les minuteurs de ce serveur sont arrêtés ;
les autres serveurs continuent de fonctionner.

Les limites propres à Discord continuent de s’appliquer, notamment 50 salons
dans une catégorie. Si le bot ne peut pas créer ou déplacer, le membre reste
dans le pilote et le motif apparaît dans les journaux. La vérification périodique
retente aussi les opérations pour les membres restés dans les pilotes.

## Vérification et dépannage

```bash
npm run check
npm test
```

Les tests locaux utilisent des doublures de Discord et une vraie base SQLite.
Ils couvrent les copies de permissions, les commandes de consultation, les créations
simultanées, les échecs de déplacement, le retour avant suppression, la protection
des salons permanents et la reprise après redémarrage. Les tests multiserveurs
vérifient aussi l’isolation des commandes admin, des quotas, des permissions,
des suppressions et des données, ainsi que la migration des commandes locales
vers les commandes globales. Ils ne remplacent pas un
test réel sur ton serveur après installation et configuration du token.

- **Commandes absentes** : vérifie le scope `applications.commands`, les identifiants,
  puis relance `npm run register` et recharge Discord si nécessaire.
- **Erreur 50013 / 50001** : vérifie les permissions du rôle du bot et ses accès
  locaux. Le message d’erreur de `/setup` précise les permissions manquantes
  détectables avant la création.
- **Membre restant dans le générateur** : consulte les journaux ; vérifie ses droits
  dans la catégorie de destination, le délai entre créations et les limites de salons.
- **Vocal conservé après déplacement manuel** : il est désormais hors de la gestion
  du bot ; c’est un comportement prévu.
- **Sauvegarde native** : arrête le bot et copie le dossier `data` et `.env` dans
  un emplacement privé. Une copie contient l’état de tous les serveurs.
  Si tu as personnalisé `DATABASE_PATH`, copie son dossier à la place de `data`.
  Avec Docker, conserve/sauvegarde le volume de données et `.env`.
  La persistance SQLite est automatique ; les copies de secours datées sont
  à réaliser séparément.

## Organisation du code

`voice-service.js` gère le cycle de vie ; `permissions.js` prépare les règles ;
`interactions.js` vérifie les droits des commandes ; `store.js` conserve l’état.
`guild-manager.js` associe chaque serveur à son propre service et à sa propre
file de mutations. `index.js` dirige les événements vers le serveur concerné.
Les créations, commandes et suppressions d’un serveur sont ordonnées sans bloquer
les files des autres serveurs. Les requêtes Discord passent
par discord.js, qui gère ses limites API.

La base persiste dès qu’un salon créé a été enregistré. Comme pour tout service
appelant une API distante, un arrêt brutal entre la création Discord et l’écriture
locale peut laisser un salon à supprimer manuellement ; le bot ne supprime jamais
un salon dont il ne possède pas l’enregistrement.

## Documentation de référence

- discord.js : <https://discord.js.org/docs/packages/discord.js/14.27.0>
- Synchronisation des permissions Discord : <https://docs.discord.com/developers/topics/permissions#permission-syncing>
- Création de salons : <https://docs.discord.com/developers/resources/guild#create-guild-channel>
- Événements vocaux : <https://docs.discord.com/developers/events/gateway-events#voice-state-update>
- Commandes globales : <https://docs.discord.com/developers/interactions/application-commands#global-commands>
- Portail développeur : <https://discord.com/developers/applications>

Projet livré sans token, sans connexion à ton serveur et sans installation distante.
