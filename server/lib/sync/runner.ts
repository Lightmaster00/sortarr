import { isArrKind, type InstanceDto } from '#shared/instances'
import type { SyncInstanceResult, SyncState } from '#shared/sync'
import { invalidateCatalog } from '../catalog'
import { getDb, type Db } from '../db'
import { getInstanceSecret, listInstances, setInstanceStatus } from '../instances'
import { listMappings } from '../paths'
import { getSetting, setSetting } from '../settings'
import { defaultSyncDeps } from './fetchers'
import { pruneItems, replaceDiskEntries, storeArrInstance, storeServerInstance } from './store'
import type { StoreCounts, SyncDeps } from './types'

const IDLE: SyncState = { running: false, startedAt: null, finishedAt: null, results: [] }

let state: SyncState = { ...IDLE }
let loaded = false
let current: Promise<SyncState> | null = null

export function getSyncState(db: Db = getDb()): SyncState {
  if (!loaded) {
    loaded = true
    const saved = getSetting('last_sync', db)
    if (saved) {
      try { state = { ...(JSON.parse(saved) as SyncState), running: false } } catch { /* état illisible : on repart de zéro */ }
    }
  }
  return state
}

export function resetSyncStateForTests(): void {
  state = { ...IDLE }
  loaded = false
  current = null
}

/** Lance une synchro, ou renvoie celle qui tourne déjà. */
export function startSync(deps: SyncDeps = defaultSyncDeps): Promise<SyncState> {
  current ??= runSync(deps)
    .catch((error) => {
      console.error('Sortarr : la synchro a échoué', error)
      state = { ...state, running: false, finishedAt: Date.now() }
      return state
    })
    .finally(() => { current = null })
  return current
}

/** Une réponse vide pour une instance qui avait des titres ressemble plus à une panne qu'à une bibliothèque vidée. */
function assertNotEmptied(db: Db, instanceId: number, fetched: number): void {
  if (fetched > 0) return
  const known = db.prepare('SELECT 1 FROM presences WHERE instance_id = ? LIMIT 1').get(instanceId)
  if (known) throw new Error('Réponse vide alors que des titres étaient connus : synchro ignorée (données conservées).')
}

async function syncOne(instance: InstanceDto, deps: SyncDeps, db: Db, clock: () => number): Promise<SyncInstanceResult> {
  const started = clock()
  const base = { instanceId: instance.id, name: instance.name }
  try {
    const secret = getInstanceSecret(instance.id, db)
    if (!secret) throw new Error('Instance introuvable.')
    const mappings = listMappings(instance.id, db)
    let counts: StoreCounts
    let version: string
    if (isArrKind(secret.kind)) {
      const r = await deps.fetchArr(secret)
      version = r.version
      assertNotEmptied(db, instance.id, r.records.length)
      counts = storeArrInstance(db, instance.id, r.records, mappings, clock())
    } else {
      const r = await deps.fetchServer(secret)
      version = r.version
      assertNotEmptied(db, instance.id, r.items.length)
      counts = storeServerInstance(db, instance.id, r.items, r.history, mappings, clock())
    }
    setInstanceStatus(instance.id, { status: 'ok', error: null, version, syncedAt: clock(), syncOk: true }, db)
    return { ...base, ok: true, error: null, ...counts, durationMs: clock() - started }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    setInstanceStatus(instance.id, { status: instance.lastSyncAt ? 'perime' : 'erreur', error: message, syncOk: false }, db)
    return { ...base, ok: false, error: message, items: 0, files: 0, unmapped: 0, durationMs: clock() - started }
  }
}

function scanDisk(db: Db, deps: SyncDeps, now: number): SyncInstanceResult[] {
  const roots = db.prepare(`SELECT DISTINCT m.real_path AS realPath FROM path_mappings m JOIN instances i ON i.id = m.instance_id
    WHERE m.managed = 1 AND i.enabled = 1 AND i.kind IN ('radarr', 'sonarr')`).all() as { realPath: string }[]
  const scanned: string[] = []
  const entries: { realPath: string; parent: string }[] = []
  const failures: SyncInstanceResult[] = []
  for (const { realPath: root } of roots) {
    try {
      for (const realPath of deps.listTopDirs(root)) entries.push({ realPath, parent: root })
      scanned.push(root)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? 'erreur'
      failures.push({ instanceId: 0, name: 'Disque', ok: false, error: `Lecture impossible : ${root} (${code})`, items: 0, files: 0, unmapped: 0, durationMs: 0 })
    }
  }
  replaceDiskEntries(db, roots.map(r => r.realPath), scanned, entries, now)
  return failures
}

export async function runSync(deps: SyncDeps, db: Db = getDb(), clock: () => number = Date.now): Promise<SyncState> {
  getSyncState(db)
  state = { running: true, startedAt: clock(), finishedAt: null, results: [] }
  const all = listInstances(db)

  try {
    db.transaction(() => {
      for (const i of all.filter(x => !x.enabled)) {
        db.prepare('DELETE FROM presences WHERE instance_id = ?').run(i.id)
        db.prepare('DELETE FROM files WHERE instance_id = ?').run(i.id)
        db.prepare('DELETE FROM watch_history WHERE server_instance_id = ?').run(i.id)
      }
    })()

    const enabled = all.filter(i => i.enabled)
    const ordered = [...enabled.filter(i => isArrKind(i.kind)), ...enabled.filter(i => !isArrKind(i.kind))]
    for (const instance of ordered) state.results.push(await syncOne(instance, deps, db, clock))

    pruneItems(db)
    state.results.push(...scanDisk(db, deps, clock()))
    state = { ...state, running: false, finishedAt: clock() }
    setSetting('last_sync', JSON.stringify(state), db)
  } finally {
    invalidateCatalog()
  }
  return state
}
