import type { SyncStateDto } from '#shared/sync'
import { defineApiHandler } from '~~/server/lib/api'
import { nextSyncAt } from '~~/server/lib/scheduler'
import { getSyncState } from '~~/server/lib/sync/runner'

export default defineApiHandler((): SyncStateDto => ({ ...getSyncState(), nextRunAt: nextSyncAt() }))
