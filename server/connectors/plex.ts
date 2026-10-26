import path from 'node:path'
import { trimTrailingSlash } from '#shared/format'
import { httpJson } from '../lib/http'
import type { HistoryRecord, ServerItemRecord } from '../lib/sync/types'

const posix = path.posix

export interface PlexConn { url: string; token: string }
export interface PlexSection { key: string; title: string; type: string; locations: string[] }
export interface PlexMeta {
  ratingKey: string; title: string; year?: number; type: string
  Guid?: { id: string }[]
  Media?: { Part?: { file?: string }[] }[]
  Location?: { path: string }[]
}
export interface PlexHistoryEntry { historyKey?: string; type: string; ratingKey?: string; grandparentRatingKey?: string; grandparentKey?: string; viewedAt: number; accountID: number }

function plex<T>(c: PlexConn, route: string): Promise<T> {
  return httpJson<T>(`${c.url.replace(/\/+$/, '')}${route}`, { headers: { 'X-Plex-Token': c.token, Accept: 'application/json' } })
}

export async function plexIdentity(c: PlexConn): Promise<{ machineIdentifier: string; version: string }> {
  const r = await plex<{ MediaContainer: { machineIdentifier: string; version: string } }>(c, '/identity')
  return { machineIdentifier: r.MediaContainer.machineIdentifier, version: r.MediaContainer.version }
}

export async function plexSections(c: PlexConn): Promise<PlexSection[]> {
  const r = await plex<{ MediaContainer: { Directory?: { key: string; title: string; type: string; Location?: { path: string }[] }[] } }>(c, '/library/sections')
  return (r.MediaContainer.Directory ?? []).map(d => ({ key: d.key, title: d.title, type: d.type, locations: (d.Location ?? []).map(l => l.path) }))
}

/** Plex omet Metadata quand la liste est vide, mais toujours MediaContainer : son absence est une erreur. */
function container<T>(r: { MediaContainer?: T } | null): T {
  if (!r || typeof r.MediaContainer !== 'object' || r.MediaContainer === null) throw new Error('Réponse inattendue de Plex : liste absente.')
  return r.MediaContainer
}

export async function plexSectionItems(c: PlexConn, key: string): Promise<PlexMeta[]> {
  const r = container(await plex<{ MediaContainer?: { Metadata?: PlexMeta[] } } | null>(c, `/library/sections/${encodeURIComponent(key)}/all?includeGuids=1`))
  return r.Metadata ?? []
}

export async function plexMetadata(c: PlexConn, ratingKey: string): Promise<PlexMeta | null> {
  const r = await plex<{ MediaContainer: { Metadata?: PlexMeta[] } }>(c, `/library/metadata/${encodeURIComponent(ratingKey)}`)
  return r.MediaContainer.Metadata?.[0] ?? null
}

/** Historique de tous les comptes du serveur (le jeton doit être celui de l'admin). */
export async function plexHistory(c: PlexConn, pageSize = 1000): Promise<PlexHistoryEntry[]> {
  const out: PlexHistoryEntry[] = []
  const seen = new Set<string>()
  let fetched = 0
  for (let page = 0; page < 500; page++) {
    const start = page * pageSize
    const r = container(await plex<{ MediaContainer?: { totalSize?: number; Metadata?: PlexHistoryEntry[] } } | null>(c, `/status/sessions/history/all?sort=viewedAt:desc&X-Plex-Container-Start=${start}&X-Plex-Container-Size=${pageSize}`))
    const batch = r.Metadata ?? []
    if (batch.length === 0) return out
    fetched += batch.length
    for (const e of batch) {
      if (e.historyKey !== undefined) {
        if (seen.has(e.historyKey)) continue
        seen.add(e.historyKey)
      }
      out.push(e)
    }
    const total = r.totalSize
    if (total !== undefined && fetched >= total) return out
  }
  throw new Error('Historique Plex trop volumineux : pagination interrompue.')
}

export async function plexAccounts(c: PlexConn): Promise<Map<number, string>> {
  const r = await plex<{ MediaContainer: { Account?: { id: number; name: string }[] } }>(c, '/accounts')
  return new Map((r.MediaContainer.Account ?? []).map(a => [a.id, a.name]))
}

export function parsePlexGuids(guids: { id: string }[] | undefined): { tmdbId: number | null; tvdbId: number | null; imdbId: string | null } {
  const out = { tmdbId: null as number | null, tvdbId: null as number | null, imdbId: null as string | null }
  for (const g of guids ?? []) {
    const [scheme, value] = g.id.split('://')
    if (scheme === 'tmdb') out.tmdbId = Number(value) || null
    else if (scheme === 'tvdb') out.tvdbId = Number(value) || null
    else if (scheme === 'imdb') out.imdbId = value || null
  }
  return out
}

export function mapPlexItem(meta: PlexMeta, library: string, libraryRoots: string[] = []): ServerItemRecord {
  const isMovie = meta.type === 'movie'
  // Part.file est toujours un fichier : on prend son dossier, sauf s'il est posé à la racine de la bibliothèque.
  const roots = new Set(libraryRoots.map(trimTrailingSlash))
  const paths = isMovie
    ? (meta.Media ?? []).flatMap(m => m.Part ?? []).map(p => p.file).filter((f): f is string => !!f).map(f => (roots.has(trimTrailingSlash(posix.dirname(f))) ? f : posix.dirname(f)))
    : (meta.Location ?? []).map(l => l.path)
  return {
    externalId: String(meta.ratingKey),
    type: isMovie ? 'movie' : 'series',
    title: meta.title,
    year: meta.year ?? null,
    ...parsePlexGuids(meta.Guid),
    servicePaths: [...new Set(paths)],
    library,
  }
}

function lastSegment(key?: string): string | undefined {
  return key?.split('/').filter(Boolean).pop()
}

export function aggregatePlexHistory(entries: PlexHistoryEntry[], accounts: Map<number, string>): HistoryRecord[] {
  const byKey = new Map<string, HistoryRecord>()
  for (const e of entries) {
    const externalId = e.type === 'episode' ? (e.grandparentRatingKey ?? lastSegment(e.grandparentKey)) : e.ratingKey
    if (!externalId) continue
    const user = accounts.get(e.accountID) || `compte ${e.accountID}`
    const key = `${externalId}\u0000${user}`
    const viewedAt = e.viewedAt * 1000
    const current = byKey.get(key)
    if (current) {
      current.playCount++
      current.lastWatchedAt = Math.max(current.lastWatchedAt ?? 0, viewedAt)
    } else {
      byKey.set(key, { externalId: String(externalId), user, lastWatchedAt: viewedAt, playCount: 1 })
    }
  }
  return [...byKey.values()]
}
