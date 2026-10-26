import path from 'node:path'
import { trimTrailingSlash } from '#shared/format'
import { normalizeCodec, normalizeLanguage, normalizeResolution, parseLanguageList, parseRuntime } from '#shared/media'
import { httpJson } from '../lib/http'
import type { ArrItemRecord, FileRecord } from '../lib/sync/types'

const posix = path.posix

export interface ArrConn { url: string; apiKey: string }

interface Quality { quality?: { name?: string; resolution?: number; modifier?: string } }
interface MediaInfo { audioLanguages?: string; subtitles?: string; videoCodec?: string; resolution?: string; runTime?: string }
export interface ArrFile { id: number; path?: string; relativePath?: string; size?: number; seasonNumber?: number; quality?: Quality; mediaInfo?: MediaInfo }
interface Ratings { imdb?: { value?: number }; tmdb?: { value?: number } }

export interface RadarrMovie {
  id: number; title: string; year?: number; tmdbId?: number; imdbId?: string
  originalLanguage?: { name?: string }; genres?: string[]; ratings?: Ratings; added?: string
  path: string; rootFolderPath?: string; monitored: boolean; hasFile: boolean; sizeOnDisk?: number; tags?: number[]
  movieFile?: ArrFile
}

export interface SonarrSeries {
  id: number; title: string; year?: number; tvdbId?: number; tmdbId?: number; imdbId?: string
  originalLanguage?: { name?: string }; genres?: string[]; added?: string
  path: string; rootFolderPath?: string; monitored: boolean; tags?: number[]
  statistics?: { episodeFileCount?: number; sizeOnDisk?: number }
}

export interface SonarrEpisode { id: number; seasonNumber: number; episodeNumber: number; hasFile: boolean; episodeFileId?: number }

function arr<T>(c: ArrConn, route: string): Promise<T> {
  return httpJson<T>(`${c.url.replace(/\/+$/, '')}/api/v3${route}`, { headers: { 'X-Api-Key': c.apiKey } })
}

export const arrStatus = (c: ArrConn) => arr<{ appName: string; version: string }>(c, '/system/status')
export const arrRootFolders = (c: ArrConn) => arr<{ path: string; freeSpace?: number }[]>(c, '/rootfolder')
export const arrQualityProfiles = (c: ArrConn) => arr<{ id: number; name: string }[]>(c, '/qualityprofile')
export const radarrMovies = (c: ArrConn) => arr<RadarrMovie[]>(c, '/movie')
export const sonarrSeries = (c: ArrConn) => arr<SonarrSeries[]>(c, '/series')
export const sonarrEpisodes = (c: ArrConn, seriesId: number) => arr<SonarrEpisode[]>(c, `/episode?seriesId=${seriesId}`)
export const sonarrEpisodeFiles = (c: ArrConn, seriesId: number) => arr<ArrFile[]>(c, `/episodefile?seriesId=${seriesId}`)

export async function arrTags(c: ArrConn): Promise<Map<number, string>> {
  const list = await arr<{ id: number; label: string }[]>(c, '/tag')
  return new Map(list.map(t => [t.id, t.label]))
}

/** Date ISO → ms ; les dates « 0001-01-01 » des *arr deviennent null. */
function parseDate(value?: string): number | null {
  if (!value) return null
  const ts = Date.parse(value)
  return Number.isFinite(ts) && ts > 0 ? ts : null
}

const orNull = <T>(value: T | undefined | null): T | null => (value ? value : null)
const trimDir = (p?: string) => (p ? trimTrailingSlash(p) : null)
const tagLabels = (ids: number[] | undefined, tags: Map<number, string>) => (ids ?? []).map(id => tags.get(id)).filter((t): t is string => !!t)

export function mapArrFile(file: ArrFile, folder: string, season: number | null, episode: number | null): FileRecord {
  const info = file.mediaInfo ?? {}
  const quality = file.quality?.quality ?? {}
  return {
    externalId: file.id,
    season,
    episode,
    servicePath: file.path ?? posix.join(folder, file.relativePath ?? ''),
    size: file.size ?? 0,
    resolution: normalizeResolution(quality.resolution || null) ?? normalizeResolution(info.resolution ?? null),
    videoCodec: normalizeCodec(info.videoCodec),
    audioLanguages: parseLanguageList(info.audioLanguages),
    subtitleLanguages: parseLanguageList(info.subtitles),
    isRemux: quality.modifier === 'remux' || /remux/i.test(quality.name ?? ''),
    runtimeSeconds: parseRuntime(info.runTime),
  }
}

export function mapRadarrMovie(m: RadarrMovie, tags: Map<number, string>): ArrItemRecord {
  return {
    externalId: m.id,
    type: 'movie',
    title: m.title,
    year: orNull(m.year),
    tmdbId: orNull(m.tmdbId),
    tvdbId: null,
    imdbId: orNull(m.imdbId),
    originalLanguage: normalizeLanguage(m.originalLanguage?.name),
    genres: m.genres ?? [],
    ratingTmdb: orNull(m.ratings?.tmdb?.value),
    ratingImdb: orNull(m.ratings?.imdb?.value),
    addedAt: parseDate(m.added),
    servicePath: m.path,
    rootFolder: trimDir(m.rootFolderPath),
    monitored: m.monitored,
    hasFile: m.hasFile,
    size: m.sizeOnDisk ?? m.movieFile?.size ?? 0,
    tags: tagLabels(m.tags, tags),
    files: m.movieFile ? [mapArrFile(m.movieFile, m.path, null, null)] : [],
  }
}

export function mapSonarrSeries(s: SonarrSeries, episodes: SonarrEpisode[], files: ArrFile[], tags: Map<number, string>): ArrItemRecord {
  // Un fichier peut contenir plusieurs épisodes : on garde le plus petit numéro.
  const firstEpisode = new Map<number, SonarrEpisode>()
  for (const e of episodes) {
    if (!e.episodeFileId) continue
    const current = firstEpisode.get(e.episodeFileId)
    if (!current || e.episodeNumber < current.episodeNumber) firstEpisode.set(e.episodeFileId, e)
  }
  return {
    externalId: s.id,
    type: 'series',
    title: s.title,
    year: orNull(s.year),
    tmdbId: orNull(s.tmdbId),
    tvdbId: orNull(s.tvdbId),
    imdbId: orNull(s.imdbId),
    originalLanguage: normalizeLanguage(s.originalLanguage?.name),
    genres: s.genres ?? [],
    ratingTmdb: null,
    ratingImdb: null,
    addedAt: parseDate(s.added),
    servicePath: s.path,
    rootFolder: trimDir(s.rootFolderPath),
    monitored: s.monitored,
    hasFile: (s.statistics?.episodeFileCount ?? 0) > 0,
    size: s.statistics?.sizeOnDisk ?? files.reduce((n, f) => n + (f.size ?? 0), 0),
    tags: tagLabels(s.tags, tags),
    files: files.map((f) => {
      const ep = firstEpisode.get(f.id)
      return mapArrFile(f, s.path, ep?.seasonNumber ?? f.seasonNumber ?? null, ep?.episodeNumber ?? null)
    }),
  }
}
