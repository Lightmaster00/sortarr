export interface SyncInstanceResult {
  /** 0 = pas une instance (scan du disque). */
  instanceId: number
  name: string
  ok: boolean
  error: string | null
  items: number
  files: number
  unmapped: number
  durationMs: number
}

export interface SyncState {
  running: boolean
  startedAt: number | null
  finishedAt: number | null
  results: SyncInstanceResult[]
}

export type SyncStateDto = SyncState & { nextRunAt: number | null }
