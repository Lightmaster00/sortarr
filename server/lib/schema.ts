import type { Db } from './db'

/** Exporté pour les tests de montée de version. */
export const MIGRATIONS: readonly string[] = [
  `
  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

  CREATE TABLE users (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    username TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE instances (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL CHECK (kind IN ('radarr', 'sonarr', 'plex', 'jellyfin')),
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    url TEXT NOT NULL,
    api_key_enc TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    version TEXT,
    last_status TEXT NOT NULL DEFAULT 'inconnu' CHECK (last_status IN ('inconnu', 'ok', 'erreur', 'perime')),
    last_status_at INTEGER,
    last_error TEXT,
    last_sync_at INTEGER,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE path_mappings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    instance_id INTEGER NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
    service_path TEXT NOT NULL,
    real_path TEXT NOT NULL,
    managed INTEGER NOT NULL DEFAULT 1,
    UNIQUE (instance_id, service_path)
  );

  CREATE TABLE items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_key TEXT NOT NULL UNIQUE,
    type TEXT NOT NULL CHECK (type IN ('movie', 'series')),
    title TEXT NOT NULL,
    year INTEGER,
    tmdb_id INTEGER,
    tvdb_id INTEGER,
    imdb_id TEXT,
    original_language TEXT,
    genres TEXT NOT NULL DEFAULT '[]',
    rating_tmdb REAL,
    rating_imdb REAL,
    added_at INTEGER,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    instance_id INTEGER NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
    external_id INTEGER NOT NULL,
    season INTEGER,
    episode INTEGER,
    real_path TEXT,
    size INTEGER NOT NULL DEFAULT 0,
    resolution INTEGER,
    video_codec TEXT,
    audio_languages TEXT NOT NULL DEFAULT '[]',
    subtitle_languages TEXT NOT NULL DEFAULT '[]',
    is_remux INTEGER NOT NULL DEFAULT 0,
    runtime_seconds INTEGER
  );
  CREATE INDEX files_item ON files(item_id);

  CREATE TABLE presences (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    instance_id INTEGER NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
    external_id TEXT NOT NULL,
    library TEXT,
    root_folder TEXT,
    real_folder TEXT,
    monitored INTEGER,
    has_file INTEGER,
    size INTEGER,
    tags TEXT NOT NULL DEFAULT '[]',
    synced_at INTEGER NOT NULL,
    UNIQUE (instance_id, external_id)
  );
  CREATE INDEX presences_item ON presences(item_id);
  CREATE INDEX presences_folder ON presences(real_folder);

  CREATE TABLE watch_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    server_instance_id INTEGER NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
    user TEXT NOT NULL,
    last_watched_at INTEGER,
    play_count INTEGER NOT NULL DEFAULT 0,
    UNIQUE (item_id, server_instance_id, user)
  );

  CREATE TABLE disk_entries (
    real_path TEXT PRIMARY KEY,
    parent_real_path TEXT NOT NULL,
    scanned_at INTEGER NOT NULL
  );
  `,
  `
  ALTER TABLE instances ADD COLUMN last_sync_ok INTEGER;
  ALTER TABLE presences ADD COLUMN added_at INTEGER;
  `,
  `
  ALTER TABLE items ADD COLUMN rating_sonarr REAL;

  CREATE TABLE rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    template TEXT NOT NULL,
    params TEXT NOT NULL DEFAULT '{}',
    filter TEXT NOT NULL,
    severity TEXT NOT NULL CHECK (severity IN ('erreur', 'avertissement', 'info')),
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE exceptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL,
    item_key TEXT NOT NULL,
    title TEXT NOT NULL,
    reason TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    UNIQUE (source, item_key)
  );
  `,
  `
  -- « Géré » ne servait jusqu'ici qu'à Radarr/Sonarr. Pour Plex/Jellyfin il veut maintenant dire
  -- « suivi par Radarr/Sonarr » : on repart de « suivi » pour ne masquer aucun signalement.
  UPDATE path_mappings SET managed = 1
    WHERE instance_id IN (SELECT id FROM instances WHERE kind IN ('plex', 'jellyfin'));
  `,
]

export const SCHEMA_VERSION = MIGRATIONS.length

/** Applique les migrations manquantes, chacune dans une transaction. */
export function migrate(db: Db): void {
  const current = db.pragma('user_version', { simple: true }) as number
  if (current > MIGRATIONS.length) throw new Error(`Base créée par une version plus récente de Sortarr (schéma ${current} > ${MIGRATIONS.length}).`)
  for (let i = current; i < MIGRATIONS.length; i++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[i]!)
      db.pragma(`user_version = ${i + 1}`)
    })()
  }
}
