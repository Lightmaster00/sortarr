import type { DashboardDto, QualityBucket } from '#shared/catalog'
import type { InstanceKind } from '#shared/instances'
import { defineApiHandler } from '~~/server/lib/api'
import { loadCatalogRows, totalSizeGb } from '~~/server/lib/catalog'
import { getDb } from '~~/server/lib/db'
import { listInstances } from '~~/server/lib/instances'
import { nextSyncAt } from '~~/server/lib/scheduler'
import { getSyncState } from '~~/server/lib/sync/runner'

const GB = 1024 ** 3
const TOP_LANGUAGES = 6
const RECENT = 12

function bucketOf(resolution: number | null): QualityBucket {
  if (resolution === null) return 'unknown'
  if (resolution >= 2000) return '2160'
  if (resolution >= 1000) return '1080'
  if (resolution >= 700) return '720'
  return 'sd'
}

export default defineApiHandler((): DashboardDto => {
  const rows = loadCatalogRows()

  const space = getDb().prepare(`SELECT i.id, i.name, i.kind,
      COALESCE((SELECT SUM(f.size) FROM files f WHERE f.instance_id = i.id), 0) AS bytes,
      (SELECT COUNT(*) FROM presences p WHERE p.instance_id = i.id) AS titles
    FROM instances i WHERE i.kind IN ('radarr', 'sonarr') AND i.enabled = 1 ORDER BY bytes DESC`)
    .all() as { id: number; name: string; kind: InstanceKind; bytes: number; titles: number }[]

  const quality = new Map<QualityBucket, number>((['2160', '1080', '720', 'sd', 'unknown'] as const).map(b => [b, 0]))
  const languages = new Map<string, number>()
  for (const r of rows) {
    if (r.hasFile || r.resolution !== null) {
      const b = bucketOf(r.resolution)
      quality.set(b, quality.get(b)! + 1)
    }
    if (r.originalLanguage) languages.set(r.originalLanguage, (languages.get(r.originalLanguage) ?? 0) + 1)
  }
  const sortedLanguages = [...languages].sort((a, b) => b[1] - a[1])
  const top = sortedLanguages.slice(0, TOP_LANGUAGES).map(([code, count]) => ({ code, count }))
  const others = sortedLanguages.slice(TOP_LANGUAGES).reduce((n, [, count]) => n + count, 0)

  return {
    movies: rows.filter(r => r.type === 'movie').length,
    series: rows.filter(r => r.type === 'series').length,
    totalSizeGb: totalSizeGb(rows),
    neverWatched: rows.filter(r => r.neverWatched).length,
    spaceByInstance: space.map(s => ({ id: s.id, name: s.name, kind: s.kind, sizeGb: Math.round((s.bytes / GB) * 100) / 100, titles: s.titles })),
    quality: [...quality].map(([bucket, count]) => ({ bucket, count })),
    languages: others ? [...top, { code: 'other', count: others }] : top,
    recent: rows.filter(r => r.addedAt !== null && r.instances.length > 0)
      .sort((a, b) => b.addedAt! - a.addedAt!)
      .slice(0, RECENT)
      .map(r => ({ id: r.id, title: r.title, year: r.year, type: r.type, rating: r.rating })),
    instances: listInstances(),
    sync: { ...getSyncState(), nextRunAt: nextSyncAt() },
  }
})
