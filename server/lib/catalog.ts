import { FIELDS, matches, validateFilter, type CatalogRow, type FieldDef, type FilterField } from '#shared/filters'
import { catalogQuerySchema, type CatalogQuery, type CatalogResult, type ItemDetail, type SortField } from '#shared/catalog'
import { isArrKind, type InstanceKind } from '#shared/instances'
import { fold } from '#shared/format'
import { languageLabel } from '#shared/media'
import { getDb, type Db } from './db'
import { AppError } from './errors'
import { listInstances } from './instances'

let version = 0
let cache: { version: number; rows: CatalogRow[] } | null = null

/** Appelé après chaque synchro : le catalogue en mémoire devra être recalculé. */
export function invalidateCatalog(): void {
  version++
  cache = null
}

export function catalogVersion(): number {
  return version
}

const GB = 1024 ** 3
const parseList = (json: string): string[] => JSON.parse(json) as string[]
const round2 = (n: number) => Math.round(n * 100) / 100
/** Taille exacte de chaque ligne, pour arrondir une seule fois les totaux. */
const bytesOf = new WeakMap<CatalogRow, number>()

/** Taille totale en Go : somme des octets, arrondie une fois. */
export function totalSizeGb(rows: CatalogRow[]): number {
  return round2(rows.reduce((n, r) => n + (bytesOf.get(r) ?? r.sizeGb * GB), 0) / GB)
}

interface ItemRow { id: number; type: 'movie' | 'series'; title: string; year: number | null; tmdb_id: number | null; tvdb_id: number | null; imdb_id: string | null; original_language: string | null; genres: string; rating_tmdb: number | null; rating_imdb: number | null; added_at: number | null }
interface PresenceRow { item_id: number; instance_id: number; kind: InstanceKind; name: string; external_id: string; library: string | null; root_folder: string | null; real_folder: string | null; monitored: number | null; has_file: number | null; size: number | null; tags: string; synced_at: number; added_at: number | null }
interface FileRow { item_id: number; instance_name: string; season: number | null; episode: number | null; real_path: string | null; size: number; resolution: number | null; video_codec: string | null; audio_languages: string; subtitle_languages: string; is_remux: number }
interface HistoryRow { item_id: number; server_name: string; user: string; last_watched_at: number | null; play_count: number }

function groupBy<T extends { item_id: number }>(rows: T[]): Map<number, T[]> {
  const out = new Map<number, T[]>()
  for (const r of rows) {
    const list = out.get(r.item_id)
    if (list) list.push(r)
    else out.set(r.item_id, [r])
  }
  return out
}

function intersection(lists: string[][]): string[] {
  const declared = lists.filter(l => l.length > 0)
  if (declared.length === 0) return []
  return declared[0]!.filter(v => declared.every(l => l.includes(v)))
}

const unique = (values: (string | null)[]) => [...new Set(values.filter((v): v is string => !!v))]

/** Date d'ajout : la plus ancienne des présences *arr actuelles ; celle du titre seulement si aucune n'en a. */
function addedAtOf(it: ItemRow, presences: PresenceRow[]): number | null {
  const dates = presences.filter(p => isArrKind(p.kind) && p.added_at !== null).map(p => p.added_at as number)
  return dates.length ? Math.min(...dates) : it.added_at
}

const PRESENCES_SQL = `SELECT p.*, i.kind, i.name FROM presences p JOIN instances i ON i.id = p.instance_id ORDER BY i.kind = 'plex', i.kind = 'jellyfin', i.name`
const FILES_SQL = `SELECT f.*, i.name AS instance_name FROM files f JOIN instances i ON i.id = f.instance_id ORDER BY f.season, f.episode, f.real_path`
const HISTORY_SQL = `SELECT h.*, i.name AS server_name FROM watch_history h JOIN instances i ON i.id = h.server_instance_id ORDER BY h.last_watched_at DESC`

export function loadCatalogRows(db: Db = getDb()): CatalogRow[] {
  if (cache && cache.version === version) return cache.rows
  const items = db.prepare('SELECT * FROM items ORDER BY title COLLATE NOCASE').all() as ItemRow[]
  const presences = groupBy(db.prepare(PRESENCES_SQL).all() as PresenceRow[])
  const files = groupBy(db.prepare(FILES_SQL).all() as FileRow[])
  const history = groupBy(db.prepare(HISTORY_SQL).all() as HistoryRow[])

  const rows = items.map((it): CatalogRow => {
    const pres = presences.get(it.id) ?? []
    const arr = pres.filter(p => isArrKind(p.kind))
    const servers = pres.filter(p => !isArrKind(p.kind))
    const fs = files.get(it.id) ?? []
    const hs = history.get(it.id) ?? []
    const fileBytes = fs.reduce((n, f) => n + f.size, 0)
    const bytes = fileBytes > 0 ? fileBytes : Math.max(0, ...arr.map(p => p.size ?? 0))
    const resolutions = fs.map(f => f.resolution).filter((r): r is number => r !== null)
    const playCount = hs.reduce((n, h) => n + h.play_count, 0)
    const watched = hs.map(h => h.last_watched_at).filter((t): t is number => t !== null)
    const row: CatalogRow = {
      id: it.id,
      type: it.type,
      title: it.title,
      year: it.year,
      originalLanguage: it.original_language,
      genres: parseList(it.genres),
      ratingTmdb: it.rating_tmdb,
      ratingImdb: it.rating_imdb,
      addedAt: addedAtOf(it, arr),
      sizeGb: round2(bytes / GB),
      resolution: resolutions.length ? Math.min(...resolutions) : null,
      videoCodecs: unique(fs.map(f => f.video_codec)),
      audioLanguages: intersection(fs.map(f => parseList(f.audio_languages))),
      subtitleLanguages: intersection(fs.map(f => parseList(f.subtitle_languages))),
      isRemux: fs.some(f => f.is_remux === 1),
      instances: unique(arr.map(p => String(p.instance_id))),
      servers: unique(servers.map(p => String(p.instance_id))),
      libraries: unique(servers.map(p => p.library)),
      rootFolders: unique(arr.map(p => p.root_folder)),
      tags: unique(arr.flatMap(p => parseList(p.tags))),
      monitored: arr.some(p => p.monitored === 1),
      hasFile: arr.some(p => p.has_file === 1),
      neverWatched: playCount === 0,
      lastWatchedAt: watched.length ? Math.max(...watched) : null,
      playCount,
    }
    bytesOf.set(row, bytes)
    return row
  })
  cache = { version, rows }
  return rows
}

function compare(a: CatalogRow, b: CatalogRow, field: SortField, dir: 'asc' | 'desc'): number {
  const x = a[field]
  const y = b[field]
  if (x === null && y === null) return 0
  if (x === null) return 1
  if (y === null) return -1
  const order = typeof x === 'string' ? fold(x).localeCompare(fold(String(y)), 'fr') : (x as number) - (y as number)
  return dir === 'asc' ? order : -order
}

export function queryCatalog(input: CatalogQuery, now: number = Date.now()): CatalogResult {
  const q = catalogQuerySchema.parse(input)
  if (q.filter) {
    const errors = validateFilter(q.filter)
    if (errors.length) throw new AppError('Filtre invalide.', 400, errors)
  }
  const search = q.search ? fold(q.search) : null
  let rows = loadCatalogRows().filter(r => (!search || fold(r.title).includes(search)) && (!q.filter || matches(r, q.filter, now)))
  if (q.sort) {
    const { field, dir } = q.sort
    rows = [...rows].sort((a, b) => compare(a, b, field, dir) || fold(a.title).localeCompare(fold(b.title), 'fr'))
  }
  const start = (q.page - 1) * q.pageSize
  return {
    rows: rows.slice(start, start + q.pageSize),
    total: rows.length,
    totalSizeGb: totalSizeGb(rows),
  }
}

export function getItemDetail(id: number, db: Db = getDb()): ItemDetail | null {
  const it = db.prepare('SELECT * FROM items WHERE id = ?').get(id) as ItemRow | undefined
  if (!it) return null
  const presences = (db.prepare(PRESENCES_SQL.replace('ORDER BY', 'WHERE p.item_id = ? ORDER BY')).all(id) as PresenceRow[])
  const files = (db.prepare(FILES_SQL.replace('ORDER BY', 'WHERE f.item_id = ? ORDER BY')).all(id) as FileRow[])
  const history = (db.prepare(HISTORY_SQL.replace('ORDER BY', 'WHERE h.item_id = ? ORDER BY')).all(id) as HistoryRow[])
  const bool = (v: number | null) => (v === null ? null : v === 1)
  return {
    item: {
      id: it.id, type: it.type, title: it.title, year: it.year, tmdbId: it.tmdb_id, tvdbId: it.tvdb_id, imdbId: it.imdb_id,
      originalLanguage: it.original_language, genres: parseList(it.genres), ratingTmdb: it.rating_tmdb, ratingImdb: it.rating_imdb, addedAt: addedAtOf(it, presences),
    },
    presences: presences.map(p => ({
      instanceId: p.instance_id, instanceName: p.name, kind: p.kind, externalId: p.external_id, library: p.library, rootFolder: p.root_folder,
      realFolder: p.real_folder, monitored: bool(p.monitored), hasFile: bool(p.has_file), size: p.size, tags: parseList(p.tags), syncedAt: p.synced_at,
    })),
    files: files.map(f => ({
      instanceName: f.instance_name, season: f.season, episode: f.episode, realPath: f.real_path, size: f.size, resolution: f.resolution,
      videoCodec: f.video_codec, audioLanguages: parseList(f.audio_languages), subtitleLanguages: parseList(f.subtitle_languages), isRemux: f.is_remux === 1,
    })),
    history: history.map(h => ({ serverName: h.server_name, user: h.user, lastWatchedAt: h.last_watched_at, playCount: h.play_count })),
  }
}

function valuesOf(rows: CatalogRow[], key: FilterField): string[] {
  const set = new Set<string>()
  for (const r of rows) {
    const v = r[key]
    if (Array.isArray(v)) v.forEach(x => set.add(String(x)))
    else if (v !== null && v !== undefined && v !== '') set.add(String(v))
  }
  return [...set].sort((a, b) => a.localeCompare(b, 'fr'))
}

const LANGUAGE_FIELDS = new Set<FilterField>(['originalLanguage', 'audioLanguages', 'subtitleLanguages'])

/** Les champs filtrables avec leurs choix possibles, calculés sur le catalogue. */
export function fieldOptions(rows: CatalogRow[] = loadCatalogRows()): FieldDef[] {
  const instances = listInstances()
  return FIELDS.map((field) => {
    if (!field.dynamicOptions) return field
    if (field.key === 'instances' || field.key === 'servers') {
      const wantArr = field.key === 'instances'
      return { ...field, options: instances.filter(i => isArrKind(i.kind) === wantArr).map(i => ({ value: String(i.id), label: i.name })) }
    }
    const label = LANGUAGE_FIELDS.has(field.key) ? languageLabel : (v: string) => v
    const options = valuesOf(rows, field.key).map(v => ({ value: v, label: label(v) }))
    if (LANGUAGE_FIELDS.has(field.key)) options.sort((a, b) => a.label.localeCompare(b.label, 'fr'))
    return { ...field, options }
  })
}
