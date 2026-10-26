# Sortarr — design

Date : 2026-10-24
Statut : validé en brainstorming, en attente de relecture

## 1. Objectif

Plateforme web auto-hébergée, avec une vraie interface, pour auditer et nettoyer une médiathèque Plex / Jellyfin au regard de ses instances Radarr et Sonarr :

- ajouter et configurer depuis l'interface autant d'instances Radarr, Sonarr, Plex et Jellyfin que nécessaire ;
- auditer la cohérence entre les serveurs médias et les instances *arr ;
- créer ses propres règles : rangement, qualité, alerte, avec actions automatiques optionnelles ;
- supprimer des médias selon des critères, manuellement ou par règle planifiée ;
- déplacer un média d'une instance à une autre du même type (ex : Radarr → Radarr 4K).

Exemple de règle de rangement, livrée comme règle modifiable : **envoyer les titres en langue originale anglaise vers une paire d'instances et de bibliothèques dédiées** (ici Radarr 4K / Sonarr 4K et « Movies 4K » / « Series 4K »), tous les autres vers Radarr / Sonarr standard.

Hors périmètre : multi-utilisateurs, demandes de médias (Overseerr/Jellyseerr), musique, analyse locale des fichiers (mediainfo).

## 2. Exemple d'installation

Une installation type, utilisée dans la suite du document :

| Service | Chemins vus par le service |
|---|---|
| Radarr | `/movies`, `/animations` |
| Sonarr | `/series`, `/animes` |
| Radarr 4K | `/movies` (= `movies-4k` sur le NAS) |
| Sonarr 4K | `/series` (= `series-4k` sur le NAS) |
| Plex | `/media/movies`, `/media/animations`, `/media/movies-4k`, `/media/series`, `/media/series-4k`, `/media/animes`, `/media/animes-extra` |
| Jellyfin | `/data/movies`, `/data/animations`, `/data/tvshows`, `/data/animes`, `/data/animes-extra`, `/data/movies-4k`, `/data/series-4k` |

Constats qui pilotent le design :

- Les profils de qualité des instances peuvent tous être « Any » → les critères de qualité vivent dans Sortarr (règles de qualité), pas dans les *arr.
- Le même dossier a un chemin différent dans chaque service → une correspondance des chemins par instance est obligatoire.
- Tout le stockage est sur le même NAS → une migration entre instances est un déplacement de dossier sur le même système de fichiers.
- Jellyfin exige l'en-tête `Authorization: MediaBrowser Token="<clé>"` (`X-Emby-Token` est refusé avec un 401 sur les versions récentes).
- `animes-extra` est présent dans Plex et Jellyfin sans dossier racine *arr → remonté en orphelin sauf s'il est déclaré « non géré ».

## 3. Stack et déploiement

Même stack que le projet `youkeep` de l'utilisateur :

- Nuxt 4 (front + serveur Nitro), Nuxt UI, TypeScript, Zod.
- SQLite via `better-sqlite3`.
- Tâches planifiées via `croner`.
- Authentification : `bcryptjs` + cookie de session httpOnly.
- Tests : Vitest (+ `@nuxt/test-utils`).
- Un seul conteneur Docker, `docker-compose.yml` et modèle Unraid.

Volumes :

- `/config` : base SQLite, réglages, clés API.
- `/media` : racine médias du NAS, en lecture-écriture.

Premier lancement : assistant de création du compte admin, puis ajout des instances. Si `/config/media.env` existe, l'assistant propose de l'importer (format : `<NOM>_URL` / `<NOM>_KEY` ou `_TOKEN`, type deviné à partir du nom et confirmé par l'utilisateur).

## 4. Architecture

```
server/
  connectors/   arr.ts (Radarr + Sonarr), plex.ts, jellyfin.ts — clients HTTP purs, typés
  instances/    CRUD, test de connexion, découverte (dossiers racines, profils, bibliothèques)
  paths/        correspondance chemin service ↔ chemin /media, suggestions automatiques
  sync/         construit le catalogue à partir des connecteurs
  filters/      moteur de filtres partagé (Catalogue, portée des règles, alertes)
  rules/        types de règles, évaluation, signalements, priorité de rangement
  audit/        contrôles intégrés + agrégation des signalements des règles
  actions/      delete.ts, migrate.ts, search.ts, unmonitor.ts — passent tous par le journal
  scheduler/    file de tâches séquentielle, planification croner, délai de grâce
  auth/
  db/           schéma et migrations SQLite
app/            pages Nuxt UI
```

Dépendances : `connectors` ← `instances`/`sync` ← `filters` ← `rules`/`audit` ← `scheduler` ; `actions` utilise `connectors` + `paths` + journal. Chaque module a une interface publique (`index.ts`) ; les modules ne lisent pas les tables des autres directement.

### 4.1 Instances

Nombre libre, gérées depuis l'interface.

Table `instances` : `id`, `kind` (radarr | sonarr | plex | jellyfin), `name`, `url`, `api_key` (chiffrée au repos avec une clé dérivée d'un secret stocké dans `/config/secret`, jamais renvoyée au front), `enabled`, `last_status` (ok | erreur | périmé), `last_status_at`, `last_error`, `version`.

Formulaire d'ajout/édition :

- nom, type, URL, clé API (champ masqué ; en édition, bouton « Remplacer la clé » au lieu d'afficher l'existante) ;
- bouton **Tester la connexion** : appelle `system/status` (*arr), `/identity` (Plex) ou `/System/Info` (Jellyfin), puis affiche la version et ce qui a été découvert : dossiers racines et profils de qualité (*arr), bibliothèques et leurs chemins (Plex, Jellyfin) ;
- l'enregistrement est possible même si le test échoue (instance marquée en erreur).

Actions : modifier, désactiver (exclue de la synchro, conservée), supprimer (refusé tant qu'une règle ou un mapping la référence ; l'UI liste ce qui bloque).

Note (phase 1) : supprimer une instance supprime en cascade ses correspondances de chemins, ses présences, fichiers et historique ; les titres qu'elle seule référençait disparaissent aussitôt du catalogue. Les gardes qui bloquent la suppression (règles) arrivent en phase 2 via `registerDeletionGuard`.

L'en-tête de chaque page affiche l'état de toutes les instances (pastille verte / orange / rouge, détail au survol).

### 4.2 Correspondance des chemins

Table `path_mappings` : `instance_id`, `service_path`, `real_path` (sous `/media`), `managed` (faux = dossier volontairement non géré par un *arr, exclu des orphelins).

Fonctions `toReal(instanceId, servicePath)` et `toService(instanceId, realPath)`, par plus long préfixe. Un chemin sans correspondance lève une erreur explicite qui bloque toute action sur le titre concerné.

Suggestion automatique après un test de connexion réussi : pour chaque dossier racine (*arr) ou chemin de bibliothèque (Plex/Jellyfin), Sortarr cherche sous `/media` un dossier de même nom final (`/movies` → `/media/movies`, `/data/tvshows` → aucun → l'utilisateur choisit `/media/series`). L'utilisateur valide ou corrige chaque ligne. Bouton « Vérifier » : prend 5 fichiers connus de l'instance et contrôle qu'ils existent sous le chemin réel calculé.

Note (phase 1) : la vérification contrôle les dossiers racines (ou chemins de bibliothèque) puis échantillonne jusqu'à 5 dossiers de titres (dossier du film ou de la série, *arr uniquement) plutôt que des fichiers.

Exemple pour l'installation ci-dessus :

| Instance | Chemin service | Chemin réel |
|---|---|---|
| Radarr | `/movies` | `/media/movies` |
| Radarr | `/animations` | `/media/animations` |
| Sonarr | `/series` | `/media/series` |
| Sonarr | `/animes` | `/media/animes` |
| Radarr 4K | `/movies` | `/media/movies-4k` |
| Sonarr 4K | `/series` | `/media/series-4k` |
| Plex | `/media/` | `/media/` |
| Jellyfin | `/data/tvshows` | `/media/series` |
| Jellyfin | `/data/` | `/media/` |

### 4.3 Catalogue

Synchronisation : cron configurable (défaut : toutes les heures) + bouton manuel. Une synchro = une tâche dans la file ; les instances désactivées sont ignorées.

Tables principales :

- `items` : un film ou une série. `type`, `title`, `year`, `tmdb_id`, `tvdb_id`, `imdb_id`, `original_language`, `genres[]`, `ratings` (TMDB, IMDb), `added_at`.
- `files` : un fichier vidéo (film ou épisode). `item_id`, `season`, `episode`, `real_path`, `size`, `resolution`, `video_codec`, `audio_languages[]`, `subtitle_languages[]`, `is_remux`, `runtime`.
- `presences` : où apparaît un item. `item_id`, `instance_id`, `external_id`, `library` (Plex/Jellyfin), `root_folder` (*arr), `monitored`, `has_file`, `tags[]`, `synced_at`.
- `watch_history` : `item_id`, `file_id?`, `server_instance_id`, `user`, `last_watched_at`, `play_count`.
- `disk_entries` : dossiers de premier niveau sous chaque `real_path` géré.

Infos techniques : `movieFile.mediaInfo` (Radarr) et `episodeFile.mediaInfo` (Sonarr).

Rapprochement entre services : par chemin réel, puis par identifiant (TMDB pour les films, TVDB pour les séries, IMDb en secours). Ids lus dans les GUID Plex (`tmdb://`, `tvdb://`, `imdb://`) et dans `ProviderIds` Jellyfin.

Fraîcheur : une instance dont la dernière synchro a échoué est « périmée » ; ses titres sont en lecture seule (aucune action destructive ni migration).

Note (phase 1) : la fraîcheur (`last_sync_ok`) est distincte du statut de connexion (`last_status`) : un test de connexion réussi n'efface pas « données périmées », seule une synchro réussie le fait. Une réponse vide ou sans liste alors que des titres étaient connus est traitée comme un échec (données conservées). Changer l'URL d'une instance oblige à ressaisir sa clé API (la clé enregistrée n'est jamais envoyée à une autre adresse).

## 5. Moteur de filtres

Partagé par le Catalogue, la portée des règles et les conditions d'alerte. Un filtre est un arbre JSON de groupes ET/OU contenant des conditions `{champ, opérateur, valeur}`.

Champs disponibles :

- type (film | série), instance, dossier racine, bibliothèque, tags *arr ;
- titre, année, genres, langue originale, note TMDB, note IMDb ;
- date d'ajout, taille, résolution, codec vidéo, langues audio, langues des sous-titres, remux ;
- visionnage : jamais vu ; date du dernier visionnage (combiné sur tous les serveurs Plex/Jellyfin, tous utilisateurs) ; nombre de lectures ;
- suivi (`monitored`), a un fichier ;
- signalé par une règle donnée.

Opérateurs selon le type de champ : égal, différent, contient, dans la liste, pas dans la liste, >, <, entre, depuis plus de N jours, depuis moins de N jours, est vide.

Validation par Zod côté serveur ; un champ inconnu rend la règle invalide (affichée en erreur, jamais exécutée).

## 6. Règles

Un modèle unique. Table `rules` : `id`, `name`, `description`, `kind` (rangement | qualité | alerte), `enabled`, `scope` (filtre), `expectation` (JSON selon `kind`), `severity` (erreur | avertissement | info), `message` (modèle de texte, ex : `{titre} devrait être dans {instance_attendue}`), `priority` (rangement uniquement), `action` (JSON optionnel), `action_enabled`.

### 6.1 Types

**Rangement** — `expectation` : `{ instance_id, libraries: [{ server_instance_id, library }] }`.
Pour chaque média de la portée, vérifie qu'il est géré par l'instance attendue et présent dans la bibliothèque attendue sur chaque serveur listé. Les règles de rangement sont ordonnées par `priority` ; pour un média, seule la première règle dont la portée correspond s'applique. Une règle « par défaut » (portée vide = tout), toujours en dernière position, est proposée à la création.
Action possible : migrer vers l'instance attendue.

**Qualité** — `expectation` : `{ min_resolution, max_resolution, required_audio_languages[], required_subtitle_languages[], allowed_video_codecs[], preferred_video_codecs[], exclude_remux, max_size_gb, max_size_gb_per_hour }`, tous optionnels.
Toutes les règles de qualité dont la portée correspond s'appliquent (cumul). Un codec préféré non respecté donne au plus un avertissement. Une info absente de `mediaInfo` est marquée « inconnue » : affichée, jamais utilisée pour déclencher une action.
Actions possibles : chercher une meilleure version, supprimer, ne plus suivre.

**Alerte** — `expectation` : un filtre. Le média est signalé s'il correspond à la portée ET au filtre de l'attente.
Actions possibles : supprimer, migrer vers une instance choisie, chercher, ne plus suivre.

### 6.2 Action automatique

`action` : `{ type, target_instance_id?, schedule (cron), grace_days? (suppression), leaving_soon_collection? (suppression), import_exclusion? (suppression) }`.

- Une règle peut exister en « signalement seul » (`action_enabled = false`).
- Les actions non destructives (chercher, ne plus suivre, migrer) s'exécutent à chaque passage planifié.
- Suppression avec délai de grâce :
  1. les médias signalés non déjà en attente passent dans `pending_deletions` (`item_id`, `rule_id`, `due_at = now + grace_days`) ;
  2. si l'option est active, ajout à une collection « Bientôt supprimé » dans chaque serveur Plex/Jellyfin où le média est présent ;
  3. à chaque passage, un média qui n'est plus signalé, ou que l'utilisateur a sauvé, sort de la liste et de la collection ; « Sauver » crée une exception pour cette règle ;
  4. à `due_at` : resynchronisation des instances concernées, nouvelle évaluation, puis suppression (§8.1).

### 6.3 Aperçu et test

Dans l'éditeur, calculé sur le catalogue à chaque modification (avec un délai de 300 ms) :

- nombre de médias dans la portée ;
- liste des médias signalés avec le motif ;
- pour une action : ce qui serait fait et l'espace libéré.

Rien n'est exécuté depuis l'aperçu.

### 6.4 Règles créées au premier lancement

Créées désactivées, à relire et activer par l'utilisateur, une fois les instances configurées :

- Rangement « Films anglais → 4K » : portée `type = film ET langue originale = en` → Radarr 4K, bibliothèques « Movies 4K ».
- Rangement « Séries anglaises → 4K » : idem avec Sonarr 4K, « Series 4K ».
- Rangement par défaut : films → Radarr, séries → Sonarr.
- Qualité « Standard » : portée `instance ∈ {Radarr, Sonarr}`, 1080p min, audio FR.
- Qualité « 4K » : portée `instance ∈ {Radarr 4K, Sonarr 4K}`, 1080p min, audio EN, sous-titres FR.

## 7. Audit

Recalculé à la fin de chaque synchro et après chaque modification de règle. Une `Issue` : `source` (règle:<id> | intégré:<contrôle>), `severity`, `item_id`, `file_id?`, `message`, `suggested_actions[]`.

Contrôles intégrés (non configurables, indépendants des règles) :

| Contrôle | Condition | Gravité | Actions proposées |
|---|---|---|---|
| Orphelin serveur | média dans Plex/Jellyfin mais dans aucune instance *arr | avertissement | Supprimer, Ignorer |
| Orphelin disque | dossier sous un chemin géré, connu d'aucun service | avertissement | Supprimer, Ignorer |
| Manquant (fichier) | média suivi sans fichier | info | Chercher, Ne plus suivre, Supprimer |
| Manquant (serveur) | fichier présent mais absent d'un serveur où sa règle de rangement l'attend | avertissement | Rescanner |
| Doublon d'instance | même TMDB/TVDB dans deux instances du même type | erreur | Supprimer d'une instance, Ignorer |
| Doublon de fichier | plusieurs fichiers vidéo pour un même film/épisode | avertissement | Supprimer un fichier, Ignorer |
| Écart entre serveurs | média présent sur un serveur Plex/Jellyfin et pas sur un autre | info | Rescanner, Ignorer |

S'y ajoutent les signalements de toutes les règles actives.

« Ignorer » crée une exception (`exceptions` : `item_id`, `source`, `reason`, `created_at`), consultable et révocable dans une page dédiée.

## 8. Actions

Toutes les actions passent par `actions/` et écrivent dans `journal` : `id`, `at`, `action`, `item_id`, `origin` (manuel | règle:<id>), `status` (simulé | succès | échec | annulé), `freed_bytes`, `details` (JSON des étapes).

Mode simulation (réglage global, **activé par défaut**) : les actions sont journalisées en « simulé », aucune écriture vers les services ni le disque.

### 8.1 Suppression

- Film : `DELETE /api/v3/movie/{id}?deleteFiles=true&addImportExclusion=<option>`.
- Série : `DELETE /api/v3/series/{id}?deleteFiles=true&addImportListExclusion=<option>`.
- Saison / épisodes : suppression des `episodefile` concernés, puis épisodes passés en non suivis.
- Orphelin sans *arr : suppression du dossier sur le disque, uniquement s'il est sous un `real_path` géré (vérifié après résolution des liens symboliques).
- Après suppression : rescan ciblé dans Plex (`/library/sections/{id}/refresh?path=`) et Jellyfin (`/Library/Media/Updated`).
- Manuelle : confirmation obligatoire avec nombre de titres et espace libéré.

### 8.2 Migration entre instances du même type

Tâche en étapes dans la file (une à la fois). Exemple Radarr → Radarr 4K :

1. **Vérifications** : titre absent de la cible (même TMDB) ; rien dans la file de téléchargement source ; mapping de chemins disponible pour la cible ; données non périmées ; dossier cible inexistant ; dossier racine cible choisi (celui de la règle, sinon le premier, modifiable en migration manuelle).
2. **Déplacement** : `rename(real_src, real_dst)` ; si `EXDEV`, copie, comparaison des tailles, suppression de la source.
3. **Ajout à la cible** : `POST /api/v3/movie` avec `path = toService(cible, real_dst)`, profil de qualité de la cible (le premier, ou celui choisi), `monitored` et tags repris de la source s'ils existent dans la cible, `addOptions.searchForMovie = false`. Puis `RefreshMovie` et vérification de `hasFile = true`.
4. **Retrait de la source** : `DELETE /api/v3/movie/{id}?deleteFiles=false&addImportExclusion=true`.
5. **Rescan** des bibliothèques concernées sur chaque serveur.

Sonarr : même logique avec `/api/v3/series`, `tvdbId`, `seasonFolder`, `seriesType`, `addOptions.searchForMissingEpisodes = false`, `RefreshSeries`.

Échec : annulation dans l'ordre inverse des étapes réussies. Si l'annulation échoue, la tâche passe en « échec — intervention requise » avec les chemins exacts à vérifier.

### 8.3 Autres actions

- Chercher une meilleure version : `MoviesSearch` / `SeriesSearch` / `EpisodeSearch`.
- Ne plus suivre : `PUT` de l'item avec `monitored = false`.

## 9. Interface

Nuxt UI, en français, utilisable sur ordinateur et tablette. Navigation latérale ; en-tête avec l'état des instances, le bouton de synchro et un bandeau visible quand le mode simulation est actif.

- **Tableau de bord** : signalements par gravité et par règle, espace disque par chemin, prochaines suppressions, dernière synchro par instance.
- **Catalogue** : tableau paginé, éditeur de filtres (le même que les règles), colonnes configurables, sélection multiple, actions groupées (supprimer, migrer, chercher, ne plus suivre). Fiche détaillée d'un média : présences, fichiers, infos techniques, visionnage, signalements, historique du journal.
- **Audit** : signalements groupés par règle ou contrôle, filtrables par gravité, actions en un clic.
- **Règles** : liste avec activation rapide, glisser-déposer de la priorité pour les règles de rangement. Éditeur en étapes : type → portée → attente → signalement → action, avec l'aperçu en direct à côté.
- **Bientôt supprimé** : médias en délai de grâce, date prévue, règle d'origine, bouton « Sauver ».
- **Tâches et journal** : file en cours avec progression, historique filtrable.
- **Exceptions** : liste des « Ignorer » et « Sauver », révocables.
- **Réglages** :
  - Instances : liste avec état, ajout/édition/test/désactivation/suppression (§4.1).
  - Chemins : mappings par instance, suggestions, vérification (§4.2).
  - Synchro : planification.
  - Sécurité : mot de passe, mode simulation.

## 10. Sécurité

- Compte admin unique créé au premier lancement ; mot de passe bcrypt ; cookie de session httpOnly, SameSite=Lax.
- Toutes les routes `/api/**` exigent une session, sauf les routes publiques : `/api/health`, `/api/auth/status`, `/api/auth/login` et `/api/auth/setup` (le chemin est contrôlé après décodage, comme le routeur).
- Protection CSRF : toute requête `/api/**` en POST, PUT, PATCH ou DELETE doit porter l'en-tête `x-sortarr: 1` (un formulaire d'un autre site ne peut pas l'ajouter), routes publiques comprises.
- Clés API chiffrées au repos, jamais renvoyées au front.
- Les suppressions disque refusent tout chemin hors des `real_path` gérés.

## 11. Gestion des erreurs

- Appels HTTP : délai max 15 s, 3 tentatives avec délai croissant, sur erreurs réseau et 5xx uniquement.
- Synchro partielle : une instance en échec n'empêche pas les autres ; elle passe « périmée ».
- Toute action vérifie la fraîcheur des données des titres concernés avant de s'exécuter.
- Une règle invalide (filtre mal formé, instance supprimée ou désactivée) est affichée en erreur et n'est ni évaluée ni exécutée.

## 12. Tests

- Unitaires : moteur de filtres, chaque type de règle, priorité de rangement, contrôles intégrés, `paths` (dont suggestions), délai de grâce.
- Connecteurs : réponses API réelles des services de l'utilisateur, enregistrées une fois puis anonymisées, rejouées en fixtures.
- Migration : sur un dossier temporaire avec des connecteurs simulés, y compris échecs et annulation.
- Routes serveur : authentification exigée, clés API jamais présentes dans les réponses.
- Aucun test n'écrit sur les vrais services.

## 13. Phases de livraison

Chaque phase est utilisable seule et a son propre plan d'implémentation.

1. **Socle** : projet Nuxt, Docker + modèle Unraid, assistant de premier lancement, authentification, gestion des instances (ajout, test, état), correspondance des chemins avec suggestions, synchro, Catalogue en lecture seule avec le moteur de filtres.
2. **Règles et audit** : modèle de règles (rangement, qualité, alerte) en signalement seul, éditeur avec aperçu, règles d'exemple, contrôles intégrés, page Audit, exceptions, tableau de bord.
3. **Suppression manuelle et journal** : mode simulation, suppressions, rescans, pages Journal.
4. **Migration entre instances** : file de tâches, migration unitaire et en lot, annulation.
5. **Actions automatiques** : planification des règles, délai de grâce, collections « Bientôt supprimé », page Bientôt supprimé.
