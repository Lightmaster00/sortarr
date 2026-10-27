import fs from 'node:fs'
import path from 'node:path'
import type { InstanceKind } from '#shared/instances'
import { configDir } from './config'
import { getDb, type Db } from './db'
import { httpImage } from './http'
import { getInstanceSecret, type InstanceSecret } from './instances'

export interface Poster { type: string; data: Buffer }

const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' }
const TYPE_OF = Object.fromEntries(Object.entries(EXT).map(([type, ext]) => [ext, type]))
/** Un titre sans affiche n'est pas redemandé avant ce délai. */
const MISS_TTL_MS = 6 * 60 * 60 * 1000
const MAX_PARALLEL = 4

const misses = new Map<number, number>()
const inflight = new Map<number, Promise<Poster | null>>()
let active = 0
const waiting: (() => void)[] = []

function cacheDir(): string {
  return path.join(configDir(), 'cache', 'posters')
}

function readCached(itemId: number): Poster | null {
  for (const [ext, type] of Object.entries(TYPE_OF)) {
    try {
      return { type, data: fs.readFileSync(path.join(cacheDir(), `${itemId}.${ext}`)) }
    } catch { /* pas en cache sous cette extension */ }
  }
  return null
}

function writeCached(itemId: number, poster: Poster): void {
  try {
    fs.mkdirSync(cacheDir(), { recursive: true })
    const file = path.join(cacheDir(), `${itemId}.${EXT[poster.type]}`)
    fs.writeFileSync(`${file}.tmp`, poster.data)
    fs.renameSync(`${file}.tmp`, file)
  } catch (error) {
    console.warn('Sortarr : affiche non mise en cache', error instanceof Error ? error.message : error)
  }
}

/** Adresse et en-têtes de l'affiche d'un titre chez un service (la clé reste dans les en-têtes). */
export function posterRequest(s: Pick<InstanceSecret, 'kind' | 'url' | 'apiKey'>, externalId: string): { url: string; headers: Record<string, string> } {
  const base = s.url.replace(/\/+$/, '')
  const id = encodeURIComponent(externalId)
  switch (s.kind) {
    case 'radarr':
    case 'sonarr':
      return { url: `${base}/api/v3/mediacover/${id}/poster-250.jpg`, headers: { 'X-Api-Key': s.apiKey } }
    case 'jellyfin':
      return { url: `${base}/Items/${id}/Images/Primary?fillHeight=375&quality=85`, headers: { Authorization: `MediaBrowser Token="${s.apiKey}"` } }
    case 'plex':
      return { url: `${base}/library/metadata/${id}/thumb`, headers: { 'X-Plex-Token': s.apiKey } }
  }
}

const KIND_ORDER: Record<InstanceKind, number> = { radarr: 1, sonarr: 1, jellyfin: 2, plex: 3 }

async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= MAX_PARALLEL) await new Promise<void>(resolve => waiting.push(resolve))
  active++
  try {
    return await fn()
  } finally {
    active--
    waiting.shift()?.()
  }
}

async function fetchPoster(itemId: number, db: Db, download: typeof httpImage): Promise<Poster | null> {
  const sources = (db.prepare(`SELECT p.external_id AS externalId, i.id AS instanceId, i.kind AS kind FROM presences p
    JOIN instances i ON i.id = p.instance_id WHERE p.item_id = ? AND i.enabled = 1`).all(itemId) as { externalId: string; instanceId: number; kind: InstanceKind }[])
    .sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind])
  for (const source of sources) {
    try {
      const secret = getInstanceSecret(source.instanceId, db)
      if (!secret) continue
      const req = posterRequest(secret, source.externalId)
      const poster = await withSlot(() => download(req.url, { headers: req.headers }))
      writeCached(itemId, poster)
      return poster
    } catch { /* source suivante */ }
  }
  return null
}

/** Affiche d'un titre : depuis le cache disque, sinon chez Radarr/Sonarr, puis Jellyfin, puis Plex. */
export async function getPoster(itemId: number, db: Db = getDb(), download: typeof httpImage = httpImage, now = Date.now()): Promise<Poster | null> {
  const cached = readCached(itemId)
  if (cached) return cached
  const missedAt = misses.get(itemId)
  if (missedAt !== undefined && now - missedAt < MISS_TTL_MS) return null
  let pending = inflight.get(itemId)
  if (!pending) {
    pending = fetchPoster(itemId, db, download).finally(() => inflight.delete(itemId))
    inflight.set(itemId, pending)
  }
  const poster = await pending
  if (poster) misses.delete(itemId)
  else misses.set(itemId, now)
  return poster
}

export function resetPostersForTests(): void {
  misses.clear()
  inflight.clear()
}
