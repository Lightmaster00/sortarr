import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createInstance, getInstance, updateInstance } from '../../../server/lib/instances'
import { getSyncState, resetSyncStateForTests, runSync, startSync } from '../../../server/lib/sync/runner'
import type { SyncDeps } from '../../../server/lib/sync/types'
import { catalogVersion } from '../../../server/lib/catalog'
import { useTestDb } from '../../helpers/db'

const db = useTestDb()
beforeEach(() => resetSyncStateForTests())

const record = { externalId: 1, type: 'movie' as const, title: 'Dune', year: 2021, tmdbId: 1, tvdbId: null, imdbId: null, originalLanguage: 'en', genres: [], ratingTmdb: null, ratingImdb: null, addedAt: null, servicePath: '/movies/Dune', rootFolder: '/movies', monitored: true, hasFile: true, size: 1, tags: [], files: [] }

function deps(overrides: Partial<SyncDeps> = {}): SyncDeps {
  return {
    fetchArr: vi.fn(async () => ({ version: '6.4.4', records: [record] })),
    fetchServer: vi.fn(async () => ({ version: '1.41', items: [{ externalId: 'p1', type: 'movie' as const, title: 'Dune', year: 2021, tmdbId: 1, tvdbId: null, imdbId: null, servicePaths: [], library: 'Movies' }], history: [] })),
    listTopDirs: vi.fn(() => []),
    ...overrides,
  }
}

function setup() {
  createInstance({ kind: 'plex', name: 'Plex', url: 'http://p', apiKey: 'k', enabled: true })
  createInstance({ kind: 'radarr', name: 'Radarr', url: 'http://r', apiKey: 'k', enabled: true })
}

describe('runSync', () => {
  it('synchronise les *arr avant les serveurs et met les statuts à jour', async () => {
    setup()
    const order: string[] = []
    const d = deps({
      fetchArr: vi.fn(async (s) => { order.push(s.name); return { version: '6.4.4', records: [record] } }),
      fetchServer: vi.fn(async (s) => { order.push(s.name); return { version: '1.41', items: [], history: [] } }),
    })
    const before = catalogVersion()
    const state = await runSync(d, db(), () => 1000)
    expect(order).toEqual(['Radarr', 'Plex'])
    expect(state).toMatchObject({ running: false, startedAt: 1000, finishedAt: 1000 })
    expect(state.results.map(r => [r.name, r.ok, r.items])).toEqual([['Radarr', true, 1], ['Plex', true, 0]])
    expect(getInstance(2)).toMatchObject({ lastStatus: 'ok', version: '6.4.4', lastSyncAt: 1000 })
    expect(catalogVersion()).toBeGreaterThan(before)
  })

  it('marque « erreur » la première fois puis « périmée » en gardant les données', async () => {
    setup()
    const failing = deps({ fetchArr: vi.fn(async () => { throw new Error('Service injoignable') }) })
    await runSync(failing, db())
    expect(getInstance(2)).toMatchObject({ lastStatus: 'erreur', lastError: 'Service injoignable' })
    await runSync(deps(), db())
    await runSync(failing, db())
    expect(getInstance(2)).toMatchObject({ lastStatus: 'perime', stale: true })
    expect((db().prepare('SELECT COUNT(*) AS n FROM presences WHERE instance_id = 2').get() as { n: number }).n).toBe(1)
  })

  it('efface « données périmées » à la synchro réussie suivante', async () => {
    setup()
    await runSync(deps(), db())
    expect(getInstance(2)!.stale).toBe(false)
    await runSync(deps({ fetchArr: vi.fn(async () => { throw new Error('Service injoignable') }) }), db())
    expect(getInstance(2)!.stale).toBe(true)
    await runSync(deps(), db())
    expect(getInstance(2)).toMatchObject({ lastStatus: 'ok', stale: false })
  })

  it('ignore une réponse vide quand des titres étaient connus', async () => {
    setup()
    await runSync(deps(), db())
    const state = await runSync(deps({ fetchArr: vi.fn(async () => ({ version: '6.4.4', records: [] })) }), db())
    expect(state.results.find(r => r.name === 'Radarr')).toMatchObject({ ok: false, error: 'Réponse vide alors que des titres étaient connus : synchro ignorée (données conservées).' })
    expect((db().prepare('SELECT COUNT(*) AS n FROM presences WHERE instance_id = 2').get() as { n: number }).n).toBe(1)
    expect(getInstance(2)).toMatchObject({ lastStatus: 'perime', stale: true })
  })

  it('retire les données d\'une instance désactivée', async () => {
    setup()
    await runSync(deps(), db())
    updateInstance(2, { name: 'Radarr', url: 'http://r', enabled: false })
    const d = deps()
    await runSync(d, db())
    expect(d.fetchArr).not.toHaveBeenCalled()
    expect((db().prepare('SELECT COUNT(*) AS n FROM presences WHERE instance_id = 2').get() as { n: number }).n).toBe(0)
  })

  it('enregistre les dossiers vus sur le disque', async () => {
    setup()
    db().prepare("INSERT INTO path_mappings (instance_id, service_path, real_path, managed) VALUES (2, '/movies', '/media/movies', 1)").run()
    await runSync(deps({ listTopDirs: () => ['/media/movies/A', '/media/movies/B'] }), db())
    expect((db().prepare('SELECT COUNT(*) AS n FROM disk_entries').get() as { n: number }).n).toBe(2)
  })

  it('garde les anciens dossiers d\'une racine illisible et signale l\'erreur', async () => {
    setup()
    db().prepare("INSERT INTO path_mappings (instance_id, service_path, real_path, managed) VALUES (2, '/movies', '/media/movies', 1)").run()
    await runSync(deps({ listTopDirs: () => ['/media/movies/A'] }), db())
    const denied = Object.assign(new Error('denied'), { code: 'EACCES' })
    const state = await runSync(deps({ listTopDirs: () => { throw denied } }), db())
    expect((db().prepare('SELECT COUNT(*) AS n FROM disk_entries').get() as { n: number }).n).toBe(1)
    expect(state.results.find(r => r.name === 'Disque')).toMatchObject({ instanceId: 0, ok: false, error: 'Lecture impossible : /media/movies (EACCES)' })
  })

  it('traite une racine absente (ENOENT) comme une erreur de lecture', async () => {
    setup()
    db().prepare("INSERT INTO path_mappings (instance_id, service_path, real_path, managed) VALUES (2, '/movies', '/media/movies', 1)").run()
    await runSync(deps({ listTopDirs: () => ['/media/movies/A'] }), db())
    const missing = Object.assign(new Error('absent'), { code: 'ENOENT' })
    const state = await runSync(deps({ listTopDirs: () => { throw missing } }), db())
    expect((db().prepare('SELECT COUNT(*) AS n FROM disk_entries').get() as { n: number }).n).toBe(1)
    expect(state.results.find(r => r.name === 'Disque')).toMatchObject({ ok: false, error: 'Lecture impossible : /media/movies (ENOENT)' })
  })

  it('garde le dernier état après un redémarrage', async () => {
    setup()
    await runSync(deps(), db(), () => 42)
    resetSyncStateForTests()
    expect(getSyncState(db())).toMatchObject({ running: false, finishedAt: 42 })
  })
})

describe('startSync', () => {
  it('ne lance pas deux synchros en même temps', async () => {
    setup()
    let release!: () => void
    const blocked = new Promise<void>(r => { release = r })
    const d = deps({ fetchArr: vi.fn(async () => { await blocked; return { version: '1', records: [] } }) })
    const first = startSync(d)
    const second = startSync(d)
    expect(second).toBe(first)
    release()
    await first
    expect(d.fetchArr).toHaveBeenCalledTimes(1)
  })
})

describe('détection automatique des chemins', () => {
  it('ne la lance que pour les instances sans correspondance, avant leur synchro', async () => {
    setup()
    const configurePaths = vi.fn(async () => undefined)
    await runSync(deps({ configurePaths }))
    expect(configurePaths.mock.calls.map(c => c[0]).sort()).toEqual([1, 2])
  })

  it('un échec de détection n\'empêche pas la synchro', async () => {
    setup()
    const state = await runSync(deps({ configurePaths: vi.fn(async () => { throw new Error('injoignable') }) }))
    expect(state.results.every(r => r.ok)).toBe(true)
  })
})
