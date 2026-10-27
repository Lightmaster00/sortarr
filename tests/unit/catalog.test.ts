import { beforeEach, describe, expect, it } from 'vitest'
import { fieldOptions, getItemDetail, invalidateCatalog, loadCatalogRows, queryCatalog, totalSizeGb } from '../../server/lib/catalog'
import { storeArrInstance, storeServerInstance } from '../../server/lib/sync/store'
import type { ArrItemRecord } from '../../server/lib/sync/types'
import { useTestDb } from '../helpers/db'

const db = useTestDb()
beforeEach(() => invalidateCatalog())

const GB = 1024 ** 3

function file(n: number, size: number, audio: string[], resolution: number) {
  return { externalId: n, season: 1, episode: n, servicePath: `/series/S/e${n}.mkv`, size, resolution, videoCodec: 'h264', audioLanguages: audio, subtitleLanguages: [], isRemux: false, runtimeSeconds: 2400 }
}

function seed() {
  const ins = db().prepare("INSERT INTO instances (kind, name, url, api_key_enc, created_at) VALUES (?, ?, 'http://x', 'k', 0)")
  ins.run('radarr', 'Radarr'); ins.run('sonarr', 'Sonarr'); ins.run('plex', 'Plex')
  const base: Omit<ArrItemRecord, 'externalId' | 'title' | 'type' | 'servicePath' | 'files'> = {
    year: 2020, tmdbId: null, tvdbId: null, imdbId: null, originalLanguage: 'en', genres: ['Drama'], ratingTmdb: 7, ratingImdb: null, ratingSonarr: null,
    addedAt: 1000, rootFolder: '/x', monitored: true, hasFile: true, size: 0, tags: [],
  }
  storeArrInstance(db(), 1, [
    { ...base, externalId: 1, type: 'movie', title: 'Zodiac', tmdbId: 1, servicePath: '/movies/Zodiac', files: [{ ...file(9, 20 * GB, ['en', 'fr'], 2160), season: null, episode: null }] },
    { ...base, externalId: 2, type: 'movie', title: 'Amélie', tmdbId: 2, originalLanguage: 'fr', servicePath: '/movies/Amelie', files: [] , size: 3 * GB },
  ], [], 5)
  storeArrInstance(db(), 2, [
    { ...base, externalId: 3, type: 'series', title: 'Show', tvdbId: 3, servicePath: '/series/S', files: [file(1, GB, ['en', 'fr'], 1080), file(2, GB, ['en'], 720), file(3, GB, [], 1080)] },
  ], [], 5)
  storeServerInstance(db(), 3, [{ externalId: 'p1', type: 'movie', title: 'Zodiac', year: 2007, tmdbId: 1, tvdbId: null, imdbId: null, servicePaths: [], library: 'Movies' }],
    [{ externalId: 'p1', user: 'alice', lastWatchedAt: 500, playCount: 2 }], [], 6)
}

describe('loadCatalogRows', () => {
  it('agrège fichiers, présences et visionnage', () => {
    seed()
    const rows = loadCatalogRows()
    const zodiac = rows.find(r => r.title === 'Zodiac')!
    expect(zodiac).toMatchObject({ sizeGb: 20, resolution: 2160, audioLanguages: ['en', 'fr'], instances: ['1'], servers: ['3'], libraries: ['Movies'], playCount: 2, lastWatchedAt: 500, neverWatched: false })
    const show = rows.find(r => r.title === 'Show')!
    expect(show).toMatchObject({ type: 'series', sizeGb: 3, resolution: 720, audioLanguages: ['en'], neverWatched: true, instances: ['2'] })
    expect(rows.find(r => r.title === 'Amélie')!.sizeGb).toBe(3)
  })
})

describe('date d\'ajout', () => {
  it('se recalcule sur les présences actuelles', () => {
    const ins = db().prepare("INSERT INTO instances (kind, name, url, api_key_enc, created_at) VALUES ('radarr', ?, 'http://x', 'k', 0)")
    ins.run('A'); ins.run('B')
    const rec = (addedAt: number): ArrItemRecord => ({
      externalId: 1, type: 'movie', title: 'Dune', year: 2021, tmdbId: 1, tvdbId: null, imdbId: null, originalLanguage: 'en', genres: [], ratingTmdb: null, ratingImdb: null, ratingSonarr: null,
      addedAt, servicePath: '/movies/Dune', rootFolder: '/movies', monitored: true, hasFile: true, size: 0, tags: [], files: [],
    })
    const y2020 = Date.UTC(2020, 0, 1)
    const y2025 = Date.UTC(2025, 0, 1)
    storeArrInstance(db(), 1, [rec(y2020)], [], 1)
    storeArrInstance(db(), 2, [rec(y2025)], [], 2)
    invalidateCatalog()
    expect(loadCatalogRows()[0]!.addedAt).toBe(y2020)
    storeArrInstance(db(), 1, [], [], 3)
    invalidateCatalog()
    const row = loadCatalogRows()[0]!
    expect(row.addedAt).toBe(y2025)
    expect(getItemDetail(row.id)!.item.addedAt).toBe(y2025)
  })
})

describe('totalSizeGb', () => {
  it('additionne les octets avant d\'arrondir', () => {
    db().prepare("INSERT INTO instances (kind, name, url, api_key_enc, created_at) VALUES ('radarr', 'R', 'http://x', 'k', 0)").run()
    const rec = (n: number): ArrItemRecord => ({
      externalId: n, type: 'movie', title: `T${n}`, year: null, tmdbId: n, tvdbId: null, imdbId: null, originalLanguage: null, genres: [], ratingTmdb: null, ratingImdb: null, ratingSonarr: null,
      addedAt: null, servicePath: `/movies/T${n}`, rootFolder: '/movies', monitored: true, hasFile: true, size: 0.004 * GB, tags: [], files: [],
    })
    storeArrInstance(db(), 1, [rec(1), rec(2), rec(3)], [], 1)
    const rows = loadCatalogRows()
    expect(rows.map(r => r.sizeGb)).toEqual([0, 0, 0])
    expect(totalSizeGb(rows)).toBe(0.01)
    expect(queryCatalog({ page: 1, pageSize: 50 }).totalSizeGb).toBe(0.01)
  })
})

describe('queryCatalog', () => {
  it('filtre, recherche, trie et pagine', () => {
    seed()
    const all = queryCatalog({ page: 1, pageSize: 50, sort: { field: 'sizeGb', dir: 'desc' } })
    expect(all.rows.map(r => r.title)).toEqual(['Zodiac', 'Amélie', 'Show'])
    expect(all.totalSizeGb).toBe(26)
    expect(queryCatalog({ page: 1, pageSize: 50, search: 'amelie' }).rows.map(r => r.title)).toEqual(['Amélie'])
    const filtered = queryCatalog({ page: 1, pageSize: 50, filter: { kind: 'group', mode: 'and', children: [{ kind: 'cond', field: 'type', op: 'eq', value: 'movie' }] } })
    expect(filtered.total).toBe(2)
    const page2 = queryCatalog({ page: 2, pageSize: 2, sort: { field: 'title', dir: 'asc' } })
    expect(page2.rows.map(r => r.title)).toEqual(['Zodiac'])
    expect(page2.total).toBe(3)
  })

  it('met les valeurs absentes en dernier quel que soit le sens', () => {
    seed()
    const asc = queryCatalog({ page: 1, pageSize: 50, sort: { field: 'lastWatchedAt', dir: 'asc' } })
    expect(asc.rows[0]!.title).toBe('Zodiac')
    const desc = queryCatalog({ page: 1, pageSize: 50, sort: { field: 'lastWatchedAt', dir: 'desc' } })
    expect(desc.rows[0]!.title).toBe('Zodiac')
    expect(desc.rows[2]!.lastWatchedAt).toBeNull()
    for (const dir of ['asc', 'desc'] as const) {
      const byRating = queryCatalog({ page: 1, pageSize: 50, sort: { field: 'ratingImdb', dir } })
      expect(byRating.rows.map(r => r.title)).toEqual(['Amélie', 'Show', 'Zodiac'])
    }
  })

  it('met le catalogue en cache jusqu\'à invalidation', () => {
    seed()
    const first = loadCatalogRows()
    expect(loadCatalogRows()).toBe(first)
    db().prepare("INSERT INTO items (item_key, type, title, genres, updated_at) VALUES ('k-nouveau', 'movie', 'Nouveau', '[]', 0)").run()
    expect(loadCatalogRows()).toHaveLength(first.length)
    invalidateCatalog()
    expect(loadCatalogRows().some(r => r.title === 'Nouveau')).toBe(true)
  })

  it('refuse un filtre invalide', () => {
    expect(() => queryCatalog({ page: 1, pageSize: 50, filter: { kind: 'cond', field: 'sizeGb', op: 'gt', value: 'x' } })).toThrow('Filtre invalide.')
  })
})

describe('détail et options', () => {
  it('renvoie la fiche détaillée', () => {
    seed()
    const id = loadCatalogRows().find(r => r.title === 'Zodiac')!.id
    const detail = getItemDetail(id)!
    expect(detail.item).toMatchObject({ title: 'Zodiac', tmdbId: 1, genres: ['Drama'] })
    expect(detail.presences.map(p => [p.instanceName, p.kind])).toEqual([['Radarr', 'radarr'], ['Plex', 'plex']])
    expect(detail.history).toEqual([{ serverName: 'Plex', user: 'alice', lastWatchedAt: 500, playCount: 2 }])
    expect(getItemDetail(999)).toBeNull()
  })

  it('remplit les options des champs dynamiques', () => {
    seed()
    const fields = fieldOptions()
    expect(fields.find(f => f.key === 'instances')!.options).toEqual([{ value: '1', label: 'Radarr' }, { value: '2', label: 'Sonarr' }])
    expect(fields.find(f => f.key === 'servers')!.options).toEqual([{ value: '3', label: 'Plex' }])
    expect(fields.find(f => f.key === 'originalLanguage')!.options).toEqual([{ value: 'en', label: 'Anglais' }, { value: 'fr', label: 'Français' }])
  })
})
