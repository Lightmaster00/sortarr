import path from 'node:path'
import { trimTrailingSlash } from '#shared/format'
import { httpJson } from '../lib/http'
import type { HistoryRecord, ServerItemRecord } from '../lib/sync/types'

const posix = path.posix

export interface JellyfinConn { url: string; apiKey: string }
export interface JellyfinLibrary { id: string; name: string; collectionType: string | null; locations: string[] }
export interface JellyfinItem {
  Id: string; Name: string; ProductionYear?: number; Type: string
  ProviderIds?: Record<string, string>; Path?: string; SeriesId?: string
  UserData?: { PlayCount?: number; LastPlayedDate?: string; Played?: boolean }
}

function jf<T>(c: JellyfinConn, route: string): Promise<T> {
  return httpJson<T>(`${c.url.replace(/\/+$/, '')}${route}`, { headers: { Authorization: `MediaBrowser Token="${c.apiKey}"` } })
}

export async function jellyfinInfo(c: JellyfinConn): Promise<{ version: string; serverName: string }> {
  const r = await jf<{ Version: string; ServerName: string }>(c, '/System/Info')
  return { version: r.Version, serverName: r.ServerName }
}

export async function jellyfinLibraries(c: JellyfinConn): Promise<JellyfinLibrary[]> {
  const r = await jf<{ Name: string; CollectionType?: string; Locations?: string[]; ItemId: string }[]>(c, '/Library/VirtualFolders')
  return r.map(f => ({ id: f.ItemId, name: f.Name, collectionType: f.CollectionType ?? null, locations: f.Locations ?? [] }))
}

const ITEM_FIELDS = 'Fields=ProviderIds,Path&EnableImages=false&EnableUserData=true'

/** Une liste vide est valable ; une réponse sans liste ne l'est pas (on ne veut pas effacer le catalogue). */
function itemsOf(r: { Items?: JellyfinItem[] } | null): JellyfinItem[] {
  if (!r || !Array.isArray(r.Items)) throw new Error('Réponse inattendue de Jellyfin : liste absente.')
  return r.Items
}

export async function jellyfinLibraryItems(c: JellyfinConn, libraryId: string): Promise<JellyfinItem[]> {
  return itemsOf(await jf<{ Items?: JellyfinItem[] } | null>(c, `/Items?ParentId=${encodeURIComponent(libraryId)}&Recursive=true&IncludeItemTypes=Movie,Series&${ITEM_FIELDS}`))
}

export async function jellyfinUsers(c: JellyfinConn): Promise<{ id: string; name: string }[]> {
  const r = await jf<{ Id: string; Name: string }[]>(c, '/Users')
  return r.map(u => ({ id: u.Id, name: u.Name }))
}

export async function jellyfinPlayed(c: JellyfinConn, userId: string): Promise<JellyfinItem[]> {
  return itemsOf(await jf<{ Items?: JellyfinItem[] } | null>(c, `/Items?userId=${encodeURIComponent(userId)}&Recursive=true&IncludeItemTypes=Movie,Episode&Filters=IsPlayed&${ITEM_FIELDS}`))
}

function providerId(item: JellyfinItem, name: string): string | undefined {
  const ids = item.ProviderIds ?? {}
  const key = Object.keys(ids).find(k => k.toLowerCase() === name.toLowerCase())
  return key ? ids[key] : undefined
}

const VIDEO_EXTENSIONS = new Set(['mkv', 'mp4', 'm4v', 'avi', 'mov', 'wmv', 'mpg', 'mpeg', 'ts', 'm2ts', 'iso', 'webm', 'flv', 'vob', 'divx', 'ogm'])

export function mapJellyfinItem(item: JellyfinItem, library: string, libraryRoots: string[] = []): ServerItemRecord {
  const isMovie = item.Type === 'Movie'
  // Un film a pour Path son fichier, sauf s'il est rangé en dossier (BDMV, VIDEO_TS).
  // Un fichier posé directement à la racine de la bibliothèque garde son chemin complet.
  let folder: string | null = null
  if (item.Path) {
    const ext = posix.extname(item.Path).slice(1).toLowerCase()
    if (isMovie && VIDEO_EXTENSIONS.has(ext)) {
      const dir = trimTrailingSlash(posix.dirname(item.Path))
      folder = libraryRoots.some(r => trimTrailingSlash(r) === dir) ? item.Path : dir
    } else {
      folder = item.Path
    }
  }
  return {
    externalId: item.Id,
    type: isMovie ? 'movie' : 'series',
    title: item.Name,
    year: item.ProductionYear ?? null,
    tmdbId: Number(providerId(item, 'Tmdb')) || null,
    tvdbId: Number(providerId(item, 'Tvdb')) || null,
    imdbId: providerId(item, 'Imdb') || null,
    servicePaths: folder ? [folder] : [],
    library,
  }
}

export function aggregateJellyfinPlayed(perUser: { user: string; items: JellyfinItem[] }[]): HistoryRecord[] {
  const byKey = new Map<string, HistoryRecord>()
  for (const { user, items } of perUser) {
    for (const item of items) {
      const externalId = item.Type === 'Episode' ? item.SeriesId : item.Id
      if (!externalId) continue
      const key = `${externalId}\u0000${user}`
      const last = item.UserData?.LastPlayedDate ? Date.parse(item.UserData.LastPlayedDate) : null
      const plays = Math.max(item.UserData?.PlayCount ?? 0, 1)
      const current = byKey.get(key)
      if (current) {
        current.playCount += plays
        if (last !== null) current.lastWatchedAt = Math.max(current.lastWatchedAt ?? 0, last)
      } else {
        byKey.set(key, { externalId, user, lastWatchedAt: last, playCount: plays })
      }
    }
  }
  return [...byKey.values()]
}
