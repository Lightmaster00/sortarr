# Sortarr

Sortarr est un outil auto-hébergé pour auditer et nettoyer une médiathèque Plex / Jellyfin au regard de vos instances Radarr et Sonarr : un catalogue unique qui rassemble les quatre services. L'interface est en français.

Phase 1 (cette version) : connexion admin, gestion des instances depuis l'interface, correspondance des chemins,
synchronisation planifiée et catalogue filtrable en lecture seule. Rien n'est modifié dans vos services.

## Installation sur Unraid

L'image est publiée sur `ghcr.io/lightmaster00/sortarr:latest`. En attendant une entrée dans Community Applications :

1. onglet **Docker** › **Template repositories** : ajouter `https://github.com/Lightmaster00/sortarr` puis enregistrer ;
2. **Add Container** › choisir le modèle **sortarr** (ou coller l'URL du modèle : `https://raw.githubusercontent.com/Lightmaster00/sortarr/main/unraid/sortarr.xml`) ;
3. vérifier les deux volumes : `/config` (par défaut `/mnt/user/appdata/sortarr`) et `/media` (la racine de vos médias, par exemple `/mnt/user/media`) ;
4. `PUID` / `PGID` valent `99` / `100` (utilisateur `nobody` d'Unraid) ; l'interface est en français ;
5. **Apply**, puis ouvrir `http://<ip-unraid>:3000`.

## Démarrer avec Docker

```bash
docker compose up -d
```

(ou `docker compose up -d --build` pour construire l'image localement).

Puis ouvrir http://<ip-du-serveur>:3000 :

1. créer le compte admin ;
2. **Réglages › Instances** : ajouter Radarr, Sonarr, Plex et Jellyfin (bouton « Ajouter une instance » : nom, URL et clé API), puis « Tester la connexion ». Modifier l'URL d'une instance impose de ressaisir sa clé API ;
3. **Réglages › Chemins** : pour chaque instance, « Suggérer », corriger, « Enregistrer », « Vérifier » ;
4. cliquer sur « Synchroniser » puis ouvrir le **Catalogue**.

### Volumes

| Conteneur | Rôle |
|---|---|
| `/config` | base SQLite, fichier `secret` (clé de chiffrement des clés API) |
| `/media` | racine de vos médias, celle qui contient vos dossiers de films et de séries (`movies/`, `series/`…) |

Gardez une sauvegarde de `/config/secret` : sans lui, les clés API enregistrées sont illisibles et doivent être ressaisies.

Si `/media` est absent ou illisible, la dernière synchronisation affiche une erreur « Disque ». Les données déjà synchronisées sont conservées.

### Variables

| Variable | Défaut | Rôle |
|---|---|---|
| `PUID` / `PGID` | `99` / `100` | utilisateur qui exécute l'app |
| `TZ` | — | fuseau horaire de la planification |
| `COOKIE_SECURE` | `false` | `true` derrière un reverse proxy HTTPS |
| `UMASK` | `022` | masque de création des fichiers de l'app |
| `PORT` | `3000` | port HTTP de l'app dans le conteneur |
| `ALLOW_ROOT` | `false` | `true` autorise `PUID=0` ou `PGID=0` (déconseillé) |

## Développement

```bash
npm install
npm test
SORTARR_CONFIG_DIR=./config SORTARR_MEDIA_ROOT=/chemin/vers/medias npm run dev
```

`npm run typecheck` vérifie les types. Les tests n'appellent jamais vos vrais services.

## Licence

MIT, voir [LICENSE](LICENSE).
