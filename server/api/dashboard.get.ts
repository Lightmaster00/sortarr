import type { DashboardDto } from '#shared/catalog'
import { defineApiHandler } from '~~/server/lib/api'
import { loadCatalogRows, totalSizeGb } from '~~/server/lib/catalog'
import { listInstances } from '~~/server/lib/instances'
import { nextSyncAt } from '~~/server/lib/scheduler'
import { getSyncState } from '~~/server/lib/sync/runner'

export default defineApiHandler((): DashboardDto => {
  const rows = loadCatalogRows()
  return {
    movies: rows.filter(r => r.type === 'movie').length,
    series: rows.filter(r => r.type === 'series').length,
    totalSizeGb: totalSizeGb(rows),
    neverWatched: rows.filter(r => r.neverWatched).length,
    instances: listInstances(),
    sync: { ...getSyncState(), nextRunAt: nextSyncAt() },
  }
})
