import { z } from 'zod'
import { filterNodeSchema, type CatalogRow } from './filters'
import type { InstanceDto, InstanceKind } from './instances'
import type { SyncStateDto } from './sync'

export const SORT_FIELDS = ['title', 'year', 'addedAt', 'sizeGb', 'resolution', 'lastWatchedAt', 'playCount', 'ratingTmdb', 'ratingImdb'] as const
export type SortField = typeof SORT_FIELDS[number]

export const catalogQuerySchema = z.object({
  filter: filterNodeSchema.optional(),
  search: z.string().trim().max(200).optional(),
  sort: z.object({ field: z.enum(SORT_FIELDS), dir: z.enum(['asc', 'desc']) }).optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(500).default(50),
})
export type CatalogQuery = z.input<typeof catalogQuerySchema>

export interface CatalogResult { rows: CatalogRow[]; total: number; totalSizeGb: number }

export interface ItemDetail {
  item: {
    id: number; type: 'movie' | 'series'; title: string; year: number | null; tmdbId: number | null; tvdbId: number | null; imdbId: string | null
    originalLanguage: string | null; genres: string[]; ratingTmdb: number | null; ratingImdb: number | null; addedAt: number | null
  }
  presences: {
    instanceId: number; instanceName: string; kind: InstanceKind; externalId: string; library: string | null; rootFolder: string | null
    realFolder: string | null; monitored: boolean | null; hasFile: boolean | null; size: number | null; tags: string[]; syncedAt: number
  }[]
  files: {
    instanceName: string; season: number | null; episode: number | null; realPath: string | null; size: number; resolution: number | null
    videoCodec: string | null; audioLanguages: string[]; subtitleLanguages: string[]; isRemux: boolean
  }[]
  history: { serverName: string; user: string; lastWatchedAt: number | null; playCount: number }[]
}

export interface DashboardDto {
  movies: number
  series: number
  totalSizeGb: number
  neverWatched: number
  instances: InstanceDto[]
  sync: SyncStateDto
}
