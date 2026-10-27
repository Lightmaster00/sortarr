import type { InstanceDto, InstanceKind, InstanceStatus } from '#shared/instances'
import { getDb, type Db } from './db'
import { AppError } from './errors'
import { decrypt, encrypt } from './secrets'

interface Row {
  id: number; kind: InstanceKind; name: string; url: string; api_key_enc: string; enabled: number
  version: string | null; last_status: InstanceStatus; last_status_at: number | null; last_error: string | null; last_sync_at: number | null
  last_sync_ok: number | null; path_count: number
}

export interface InstanceSecret { id: number; kind: InstanceKind; name: string; url: string; apiKey: string }

function toDto(r: Row): InstanceDto {
  return {
    id: r.id, kind: r.kind, name: r.name, url: r.url, enabled: r.enabled === 1, hasKey: r.api_key_enc.length > 0,
    version: r.version, lastStatus: r.last_status, lastStatusAt: r.last_status_at, lastError: r.last_error, lastSyncAt: r.last_sync_at,
    stale: r.last_sync_at !== null && r.last_sync_ok === 0, pathCount: r.path_count,
  }
}

const SELECT = 'SELECT i.*, (SELECT COUNT(*) FROM path_mappings m WHERE m.instance_id = i.id) AS path_count FROM instances i'

function row(id: number, db: Db): Row | undefined {
  return db.prepare(`${SELECT} WHERE i.id = ?`).get(id) as Row | undefined
}

function assertNameFree(db: Db, name: string, exceptId?: number): void {
  const other = db.prepare('SELECT id FROM instances WHERE name = ? COLLATE NOCASE AND id IS NOT ?').get(name, exceptId ?? null)
  if (other) throw new AppError('Une instance porte déjà ce nom.', 409)
}

export function listInstances(db: Db = getDb()): InstanceDto[] {
  const order = "CASE i.kind WHEN 'radarr' THEN 1 WHEN 'sonarr' THEN 2 WHEN 'plex' THEN 3 ELSE 4 END"
  return (db.prepare(`${SELECT} ORDER BY ${order}, i.name COLLATE NOCASE`).all() as Row[]).map(toDto)
}

export function getInstance(id: number, db: Db = getDb()): InstanceDto | null {
  const r = row(id, db)
  return r ? toDto(r) : null
}

export function getInstanceSecret(id: number, db: Db = getDb()): InstanceSecret | null {
  const r = row(id, db)
  if (!r) return null
  let apiKey: string
  try {
    apiKey = decrypt(r.api_key_enc)
  } catch {
    throw new AppError('Clé API illisible (fichier /config/secret changé ?) : ressaisis-la.', 500)
  }
  return { id: r.id, kind: r.kind, name: r.name, url: r.url, apiKey }
}

export function createInstance(input: { kind: InstanceKind; name: string; url: string; apiKey: string; enabled: boolean }, db: Db = getDb()): InstanceDto {
  assertNameFree(db, input.name)
  const info = db.prepare('INSERT INTO instances (kind, name, url, api_key_enc, enabled, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(input.kind, input.name, input.url, encrypt(input.apiKey), input.enabled ? 1 : 0, Date.now())
  return getInstance(Number(info.lastInsertRowid), db)!
}

export function updateInstance(id: number, input: { name: string; url: string; enabled: boolean; apiKey?: string }, db: Db = getDb()): InstanceDto {
  const current = row(id, db)
  if (!current) throw new AppError('Instance introuvable.', 404)
  assertNameFree(db, input.name, id)
  if (current.url !== input.url && !input.apiKey) throw new AppError('Clé API obligatoire pour une nouvelle adresse.')
  if (current.url !== input.url) db.prepare("UPDATE instances SET last_status = 'inconnu', last_error = NULL WHERE id = ?").run(id)
  db.prepare('UPDATE instances SET name = ?, url = ?, enabled = ? WHERE id = ?').run(input.name, input.url, input.enabled ? 1 : 0, id)
  if (input.apiKey) db.prepare('UPDATE instances SET api_key_enc = ? WHERE id = ?').run(encrypt(input.apiKey), id)
  return getInstance(id, db)!
}

type DeletionGuard = (id: number, db: Db) => string[]
const guards: DeletionGuard[] = []

/** Les phases suivantes (règles) enregistrent ici ce qui empêche de supprimer une instance. */
export function registerDeletionGuard(guard: DeletionGuard): void {
  guards.push(guard)
}

export function deleteInstance(id: number, db: Db = getDb()): void {
  if (!row(id, db)) throw new AppError('Instance introuvable.', 404)
  const blockers = guards.flatMap(g => g(id, db))
  if (blockers.length) throw new AppError('Instance utilisée : retire-la d\'abord de ces éléments.', 409, blockers)
  db.prepare('DELETE FROM instances WHERE id = ?').run(id)
}

export function setInstanceStatus(
  id: number,
  patch: { status: InstanceStatus; error?: string | null; version?: string | null; syncedAt?: number; syncOk?: boolean },
  db: Db = getDb(),
): void {
  const syncOk = patch.syncOk === undefined ? null : patch.syncOk ? 1 : 0
  db.prepare(`UPDATE instances SET last_status = ?, last_status_at = ?, last_error = ?,
    version = COALESCE(?, version), last_sync_at = COALESCE(?, last_sync_at), last_sync_ok = COALESCE(?, last_sync_ok) WHERE id = ?`)
    .run(patch.status, Date.now(), patch.error ?? null, patch.version ?? null, patch.syncedAt ?? null, syncOk, id)
}
