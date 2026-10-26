import type { PathMapping } from '#shared/paths'
import type { Db } from '../db'
import { tryReal } from '../paths'
import type { ArrItemRecord, HistoryRecord, MediaType, ServerItemRecord, StoreCounts } from './types'

interface Ids { type: MediaType; tmdbId: number | null; tvdbId: number | null; imdbId: string | null }

/** Clé stable d'un titre : identifiant externe d'abord, chemin en dernier recours. */
export function itemKey(r: Ids, fallback: string): string {
  if (r.type === 'movie') {
    if (r.tmdbId) return `movie:tmdb:${r.tmdbId}`
    if (r.imdbId) return `movie:imdb:${r.imdbId}`
  } else {
    if (r.tvdbId) return `series:tvdb:${r.tvdbId}`
    if (r.tmdbId) return `series:tmdb:${r.tmdbId}`
    if (r.imdbId) return `series:imdb:${r.imdbId}`
  }
  return `${r.type}:${fallback}`
}

function idCandidates(r: Ids): string[] {
  const keys = r.type === 'movie'
    ? [r.tmdbId && `tmdb:${r.tmdbId}`, r.imdbId && `imdb:${r.imdbId}`]
    : [r.tvdbId && `tvdb:${r.tvdbId}`, r.tmdbId && `tmdb:${r.tmdbId}`, r.imdbId && `imdb:${r.imdbId}`]
  return keys.filter((k): k is string => !!k).map(k => `${r.type}:${k}`)
}

const UPSERT_ARR_ITEM = `
  INSERT INTO items (item_key, type, title, year, tmdb_id, tvdb_id, imdb_id, original_language, genres, rating_tmdb, rating_imdb, added_at, updated_at)
  VALUES (@key, @type, @title, @year, @tmdbId, @tvdbId, @imdbId, @originalLanguage, @genres, @ratingTmdb, @ratingImdb, @addedAt, @now)
  ON CONFLICT(item_key) DO UPDATE SET
    title = excluded.title, year = excluded.year,
    tmdb_id = COALESCE(excluded.tmdb_id, items.tmdb_id), tvdb_id = COALESCE(excluded.tvdb_id, items.tvdb_id), imdb_id = COALESCE(excluded.imdb_id, items.imdb_id),
    original_language = COALESCE(excluded.original_language, items.original_language), genres = excluded.genres,
    rating_tmdb = COALESCE(excluded.rating_tmdb, items.rating_tmdb), rating_imdb = COALESCE(excluded.rating_imdb, items.rating_imdb),
    added_at = excluded.added_at,
    updated_at = excluded.updated_at
  RETURNING id`

const UPSERT_ORPHAN_ITEM = `
  INSERT INTO items (item_key, type, title, year, tmdb_id, tvdb_id, imdb_id, updated_at)
  VALUES (@key, @type, @title, @year, @tmdbId, @tvdbId, @imdbId, @now)
  ON CONFLICT(item_key) DO UPDATE SET updated_at = excluded.updated_at
  RETURNING id`

const INSERT_PRESENCE = `
  INSERT INTO presences (item_id, instance_id, external_id, library, root_folder, real_folder, monitored, has_file, size, tags, synced_at, added_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`

const INSERT_FILE = `
  INSERT INTO files (item_id, instance_id, external_id, season, episode, real_path, size, resolution, video_codec, audio_languages, subtitle_languages, is_remux, runtime_seconds)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`

const UPSERT_HISTORY = `
  INSERT INTO watch_history (item_id, server_instance_id, user, last_watched_at, play_count) VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(item_id, server_instance_id, user) DO UPDATE SET
    last_watched_at = NULLIF(MAX(COALESCE(watch_history.last_watched_at, 0), COALESCE(excluded.last_watched_at, 0)), 0),
    play_count = watch_history.play_count + excluded.play_count`

export function storeArrInstance(db: Db, instanceId: number, records: ArrItemRecord[], mappings: PathMapping[], now: number): StoreCounts {
  const counts: StoreCounts = { items: 0, files: 0, unmapped: 0 }
  const upsert = db.prepare(UPSERT_ARR_ITEM)
  const insertPresence = db.prepare(INSERT_PRESENCE)
  const insertFile = db.prepare(INSERT_FILE)
  db.transaction(() => {
    db.prepare('DELETE FROM files WHERE instance_id = ?').run(instanceId)
    db.prepare('DELETE FROM presences WHERE instance_id = ?').run(instanceId)
    for (const r of records) {
      const realFolder = tryReal(mappings, r.servicePath)
      if (realFolder === null) counts.unmapped++
      const { id } = upsert.get({
        key: itemKey(r, `path:${realFolder ?? `${instanceId}:${r.servicePath}`}`),
        type: r.type, title: r.title, year: r.year, tmdbId: r.tmdbId, tvdbId: r.tvdbId, imdbId: r.imdbId,
        originalLanguage: r.originalLanguage, genres: JSON.stringify(r.genres), ratingTmdb: r.ratingTmdb, ratingImdb: r.ratingImdb,
        addedAt: r.addedAt, now,
      }) as { id: number }
      insertPresence.run(id, instanceId, String(r.externalId), null, r.rootFolder, realFolder, r.monitored ? 1 : 0, r.hasFile ? 1 : 0, r.size, JSON.stringify(r.tags), now, r.addedAt)
      for (const f of r.files) {
        insertFile.run(id, instanceId, f.externalId, f.season, f.episode, tryReal(mappings, f.servicePath), f.size, f.resolution, f.videoCodec,
          JSON.stringify(f.audioLanguages), JSON.stringify(f.subtitleLanguages), f.isRemux ? 1 : 0, f.runtimeSeconds)
        counts.files++
      }
      counts.items++
    }
  })()
  return counts
}

export function storeServerInstance(db: Db, instanceId: number, items: ServerItemRecord[], history: HistoryRecord[], mappings: PathMapping[], now: number): StoreCounts {
  const counts: StoreCounts = { items: 0, files: 0, unmapped: 0 }
  db.transaction(() => {
    db.prepare('DELETE FROM presences WHERE instance_id = ?').run(instanceId)
    db.prepare('DELETE FROM watch_history WHERE server_instance_id = ?').run(instanceId)

    const byFolder = new Map<string, { id: number; type: MediaType }>()
    const folderRows = db.prepare(`SELECT p.real_folder AS folder, p.item_id AS itemId, it.type AS type FROM presences p
      JOIN instances i ON i.id = p.instance_id JOIN items it ON it.id = p.item_id
      WHERE i.kind IN ('radarr', 'sonarr') AND p.real_folder IS NOT NULL`).all() as { folder: string; itemId: number; type: MediaType }[]
    for (const r of folderRows) byFolder.set(r.folder, { id: r.itemId, type: r.type })

    const byId = new Map<string, number>()
    const idRows = db.prepare('SELECT id, type, tmdb_id, tvdb_id, imdb_id FROM items').all() as { id: number; type: MediaType; tmdb_id: number | null; tvdb_id: number | null; imdb_id: string | null }[]
    for (const r of idRows) {
      for (const key of idCandidates({ type: r.type, tmdbId: r.tmdb_id, tvdbId: r.tvdb_id, imdbId: r.imdb_id })) if (!byId.has(key)) byId.set(key, r.id)
    }

    const upsertOrphan = db.prepare(UPSERT_ORPHAN_ITEM)
    const insertPresence = db.prepare(INSERT_PRESENCE)
    const itemOf = new Map<string, number>()

    const seen = new Set<string>()
    for (const it of items) {
      if (seen.has(it.externalId)) continue
      seen.add(it.externalId)
      const folders = it.servicePaths.map(p => tryReal(mappings, p)).filter((p): p is string => p !== null)
      if (it.servicePaths.length > 0 && folders.length === 0) counts.unmapped++
      let itemId = folders.map(f => byFolder.get(f)).find(h => h !== undefined && h.type === it.type)?.id
        ?? idCandidates(it).map(k => byId.get(k)).find((id): id is number => id !== undefined)
      if (itemId === undefined) {
        const fallback = folders[0] ? `path:${folders[0]}` : `server:${instanceId}:${it.externalId}`
        itemId = (upsertOrphan.get({ key: itemKey(it, fallback), type: it.type, title: it.title, year: it.year, tmdbId: it.tmdbId, tvdbId: it.tvdbId, imdbId: it.imdbId, now }) as { id: number }).id
        for (const key of idCandidates(it)) byId.set(key, itemId)
        for (const f of folders) byFolder.set(f, { id: itemId, type: it.type })
      }
      insertPresence.run(itemId, instanceId, it.externalId, it.library, null, folders[0] ?? null, null, null, null, '[]', now, null)
      itemOf.set(it.externalId, itemId)
      counts.items++
    }

    const upsertHistory = db.prepare(UPSERT_HISTORY)
    for (const h of history) {
      const itemId = itemOf.get(h.externalId)
      if (itemId !== undefined) upsertHistory.run(itemId, instanceId, h.user, h.lastWatchedAt, h.playCount)
    }
  })()
  return counts
}

export function pruneItems(db: Db): number {
  return db.prepare('DELETE FROM items WHERE NOT EXISTS (SELECT 1 FROM presences p WHERE p.item_id = items.id)').run().changes
}

/** Remplace les dossiers des racines scannées ; ceux d'une racine gérée en échec sont conservés, ceux d'une racine non gérée supprimés. */
export function replaceDiskEntries(db: Db, managedRoots: string[], scannedRoots: string[], entries: { realPath: string; parent: string }[], now: number): void {
  db.transaction(() => {
    const managed = new Set(managedRoots)
    const scanned = new Set(scannedRoots)
    const rows = db.prepare('SELECT DISTINCT parent_real_path AS parent FROM disk_entries').all() as { parent: string }[]
    const del = db.prepare('DELETE FROM disk_entries WHERE parent_real_path = ?')
    for (const r of rows) if (scanned.has(r.parent) || !managed.has(r.parent)) del.run(r.parent)
    const insert = db.prepare('INSERT OR IGNORE INTO disk_entries (real_path, parent_real_path, scanned_at) VALUES (?, ?, ?)')
    for (const e of entries) insert.run(e.realPath, e.parent, now)
  })()
}
