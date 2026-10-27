import type { InstanceSecret } from '../instances'

export type MediaType = 'movie' | 'series'

export interface FileRecord {
  externalId: number
  season: number | null
  episode: number | null
  servicePath: string
  size: number
  resolution: number | null
  videoCodec: string | null
  audioLanguages: string[]
  subtitleLanguages: string[]
  isRemux: boolean
  runtimeSeconds: number | null
}

export interface ArrItemRecord {
  externalId: number
  type: MediaType
  title: string
  year: number | null
  tmdbId: number | null
  tvdbId: number | null
  imdbId: string | null
  originalLanguage: string | null
  genres: string[]
  ratingTmdb: number | null
  ratingImdb: number | null
  addedAt: number | null
  servicePath: string
  rootFolder: string | null
  monitored: boolean
  hasFile: boolean
  size: number
  tags: string[]
  files: FileRecord[]
}

export interface ServerItemRecord {
  externalId: string
  type: MediaType
  title: string
  year: number | null
  tmdbId: number | null
  tvdbId: number | null
  imdbId: string | null
  servicePaths: string[]
  library: string
}

export interface HistoryRecord {
  externalId: string
  user: string
  lastWatchedAt: number | null
  playCount: number
}

export interface StoreCounts { items: number; files: number; unmapped: number }

export interface SyncDeps {
  fetchArr(instance: InstanceSecret): Promise<{ version: string; records: ArrItemRecord[] }>
  fetchServer(instance: InstanceSecret): Promise<{ version: string; items: ServerItemRecord[]; history: HistoryRecord[] }>
  listTopDirs(realPath: string): string[]
  /** Détecte les chemins d'une instance qui n'en a aucun (facultatif : absent dans les tests). */
  configurePaths?(instanceId: number): Promise<unknown>
}
