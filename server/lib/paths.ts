import fs from 'node:fs'
import path from 'node:path'
import type { MappingInput, PathCheck, PathMapping } from '#shared/paths'
import { arrRootFolders, radarrMovies, sonarrSeries } from '../connectors/arr'
import { mediaRoot } from './config'
import { getDb, type Db } from './db'
import { discover } from './discovery'
import { AppError } from './errors'
import { getInstanceSecret } from './instances'

const posix = path.posix

export class PathMappingError extends AppError {}

interface MappingLike { servicePath: string; realPath: string }

export function normalizeDir(p: string): string {
  const n = posix.normalize(p.trim().replace(/\\/g, '/'))
  return n.length > 1 ? n.replace(/\/+$/, '') : n
}

export function isUnder(child: string, parent: string): boolean {
  const c = normalizeDir(child)
  const p = normalizeDir(parent)
  return p === '/' ? c.startsWith('/') : c === p || c.startsWith(`${p}/`)
}

function convert(mappings: MappingLike[], value: string, from: keyof MappingLike, to: keyof MappingLike): string | null {
  const target = normalizeDir(value)
  let best: MappingLike | null = null
  for (const m of mappings) {
    if (isUnder(target, m[from]) && (!best || normalizeDir(m[from]).length > normalizeDir(best[from]).length)) best = m
  }
  if (!best) return null
  const prefix = normalizeDir(best[from])
  const rest = prefix === '/' ? target.slice(1) : target.slice(prefix.length).replace(/^\//, '')
  return rest ? posix.join(normalizeDir(best[to]), rest) : normalizeDir(best[to])
}

export function toRealWith(mappings: MappingLike[], servicePath: string): string {
  const real = convert(mappings, servicePath, 'servicePath', 'realPath')
  if (real === null) throw new PathMappingError(`Aucune correspondance de chemin pour ${servicePath}`)
  return real
}

export function toServiceWith(mappings: MappingLike[], realPath: string): string {
  const service = convert(mappings, realPath, 'realPath', 'servicePath')
  if (service === null) throw new PathMappingError(`Aucune correspondance de chemin pour ${realPath}`)
  return service
}

export function tryReal(mappings: MappingLike[], servicePath: string): string | null {
  return convert(mappings, servicePath, 'servicePath', 'realPath')
}

interface Row { id: number; instance_id: number; service_path: string; real_path: string; managed: number }

export function listMappings(instanceId: number, db: Db = getDb()): PathMapping[] {
  return (db.prepare('SELECT * FROM path_mappings WHERE instance_id = ? ORDER BY service_path').all(instanceId) as Row[])
    .map(r => ({ id: r.id, instanceId: r.instance_id, servicePath: r.service_path, realPath: r.real_path, managed: r.managed === 1 }))
}

export function assertUnderMediaRoot(realPath: string): void {
  const root = normalizeDir(mediaRoot())
  if (!isUnder(realPath, root)) throw new PathMappingError(`Le chemin réel ${realPath} doit être sous ${root}.`)
}

export function replaceMappings(instanceId: number, rows: MappingInput[], db: Db = getDb()): PathMapping[] {
  const seen = new Set<string>()
  const clean = rows.map((r) => {
    const servicePath = normalizeDir(r.servicePath)
    const realPath = normalizeDir(r.realPath)
    if (seen.has(servicePath)) throw new PathMappingError(`Le chemin ${servicePath} est en double.`)
    seen.add(servicePath)
    assertUnderMediaRoot(realPath)
    return { servicePath, realPath, managed: r.managed }
  })
  db.transaction(() => {
    db.prepare('DELETE FROM path_mappings WHERE instance_id = ?').run(instanceId)
    const insert = db.prepare('INSERT INTO path_mappings (instance_id, service_path, real_path, managed) VALUES (?, ?, ?, ?)')
    for (const r of clean) insert.run(instanceId, r.servicePath, r.realPath, r.managed ? 1 : 0)
  })()
  return listMappings(instanceId, db)
}

export function toReal(instanceId: number, servicePath: string, db: Db = getDb()): string {
  return toRealWith(listMappings(instanceId, db), servicePath)
}

export function toService(instanceId: number, realPath: string, db: Db = getDb()): string {
  return toServiceWith(listMappings(instanceId, db), realPath)
}

function isDir(p: string): boolean {
  try { return fs.statSync(p).isDirectory() } catch { return false }
}

function subDirs(dir: string): string[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory() && !d.name.startsWith('.')).map(d => d.name).sort()
  } catch {
    return []
  }
}

/** Propose le dossier de /media qui correspond à un chemin vu par un service. */
export function suggestRealPath(servicePath: string, root: string = mediaRoot()): string | null {
  const sp = normalizeDir(servicePath)
  const base = normalizeDir(root)
  if (isUnder(sp, base) && isDir(sp)) return sp
  const name = posix.basename(sp)
  if (!name) return null
  const direct = posix.join(base, name)
  if (isDir(direct)) return direct
  for (const child of subDirs(base)) {
    const candidate = posix.join(base, child, name)
    if (isDir(candidate)) return candidate
  }
  return null
}

export interface VerifyDeps {
  roots: () => Promise<string[]>
  samples: () => Promise<string[]>
}

function liveDeps(instanceId: number): VerifyDeps {
  const secret = getInstanceSecret(instanceId)
  if (!secret) throw new AppError('Instance introuvable.', 404)
  const arr = { url: secret.url, apiKey: secret.apiKey }
  return {
    roots: async () => secret.kind === 'radarr' || secret.kind === 'sonarr'
      ? (await arrRootFolders(arr)).map(r => r.path)
      : (await discover(secret)).roots.map(r => r.path),
    samples: async () => {
      if (secret.kind === 'radarr') return (await radarrMovies(arr)).filter(m => m.hasFile).slice(0, 5).map(m => m.path)
      if (secret.kind === 'sonarr') return (await sonarrSeries(arr)).filter(s => (s.statistics?.episodeFileCount ?? 0) > 0).slice(0, 5).map(s => s.path)
      return []
    },
  }
}

/** Vérifie que les dossiers racines (ou bibliothèques) et quelques titres existent sous /media. */
export async function verifyInstancePaths(instanceId: number, deps: VerifyDeps = liveDeps(instanceId)): Promise<{ ok: boolean; checks: PathCheck[] }> {
  const mappings = listMappings(instanceId)
  const paths = [...(await deps.roots()), ...(await deps.samples())]
  const checks = paths.map((servicePath): PathCheck => {
    const realPath = tryReal(mappings, servicePath)
    if (realPath === null) return { servicePath, realPath, exists: false, message: 'Aucune correspondance' }
    const exists = isDir(realPath)
    return { servicePath, realPath, exists, message: exists ? 'OK' : `Dossier introuvable : ${realPath}` }
  })
  return { ok: checks.length > 0 && checks.every(c => c.exists), checks }
}
