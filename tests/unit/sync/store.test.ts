import { describe, expect, it } from 'vitest'
import { itemKey, pruneItems, replaceDiskEntries, storeArrInstance, storeServerInstance } from '../../../server/lib/sync/store'
import type { ArrItemRecord, ServerItemRecord } from '../../../server/lib/sync/types'
import type { PathMapping } from '#shared/paths'
import { useTestDb } from '../../helpers/db'

const db = useTestDb()

function seedInstances() {
  const insert = db().prepare("INSERT INTO instances (kind, name, url, api_key_enc, created_at) VALUES (?, ?, 'http://x', 'k', 0)")
  insert.run('radarr', 'Radarr')  // id 1
  insert.run('plex', 'Plex')      // id 2
  insert.run('radarr', 'Radarr 4K') // id 3
}

const map = (instanceId: number, servicePath: string, realPath: string): PathMapping => ({ id: 0, instanceId, servicePath, realPath, managed: true })
const radarrMaps = [map(1, '/movies', '/media/movies')]
const plexMaps = [map(2, '/media', '/media')]

function movie(overrides: Partial<ArrItemRecord> = {}): ArrItemRecord {
  return {
    externalId: 7, type: 'movie', title: 'Dune', year: 2021, tmdbId: 438631, tvdbId: null, imdbId: 'tt1160419',
    originalLanguage: 'en', genres: ['SF'], ratingTmdb: 7.8, ratingImdb: 8, addedAt: 1000,
    servicePath: '/movies/Dune (2021)', rootFolder: '/movies', monitored: true, hasFile: true, size: 9000, tags: ['4k'],
    files: [{ externalId: 70, season: null, episode: null, servicePath: '/movies/Dune (2021)/Dune.mkv', size: 9000, resolution: 1080, videoCodec: 'hevc', audioLanguages: ['en'], subtitleLanguages: ['fr'], isRemux: false, runtimeSeconds: 9300 }],
    ...overrides,
  }
}

function plexItem(overrides: Partial<ServerItemRecord> = {}): ServerItemRecord {
  return { externalId: '10', type: 'movie', title: 'Dune', year: 2021, tmdbId: null, tvdbId: null, imdbId: null, servicePaths: ['/media/movies/Dune (2021)'], library: 'Movies', ...overrides }
}

const count = (table: string) => (db().prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n

describe('itemKey', () => {
  it('préfère TMDB pour un film et TVDB pour une série', () => {
    expect(itemKey({ type: 'movie', tmdbId: 1, tvdbId: null, imdbId: 'tt' }, 'x')).toBe('movie:tmdb:1')
    expect(itemKey({ type: 'series', tmdbId: 1, tvdbId: 2, imdbId: null }, 'x')).toBe('series:tvdb:2')
    expect(itemKey({ type: 'movie', tmdbId: null, tvdbId: null, imdbId: null }, 'path:/a')).toBe('movie:path:/a')
  })
})

describe('storeArrInstance', () => {
  it('écrit le titre, la présence et les fichiers avec les chemins réels', () => {
    seedInstances()
    expect(storeArrInstance(db(), 1, [movie()], radarrMaps, 5)).toEqual({ items: 1, files: 1, unmapped: 0 })
    expect(db().prepare('SELECT item_key, original_language, genres FROM items').get()).toEqual({ item_key: 'movie:tmdb:438631', original_language: 'en', genres: '["SF"]' })
    expect(db().prepare('SELECT real_folder, root_folder, monitored, tags FROM presences').get()).toEqual({ real_folder: '/media/movies/Dune (2021)', root_folder: '/movies', monitored: 1, tags: '["4k"]' })
    expect(db().prepare('SELECT real_path, audio_languages FROM files').get()).toEqual({ real_path: '/media/movies/Dune (2021)/Dune.mkv', audio_languages: '["en"]' })
  })

  it('remplace les données de l\'instance à chaque synchro sans changer l\'id du titre', () => {
    seedInstances()
    storeArrInstance(db(), 1, [movie()], radarrMaps, 5)
    storeArrInstance(db(), 1, [movie({ title: 'Dune: Part One' })], radarrMaps, 6)
    expect(count('presences')).toBe(1)
    expect(count('files')).toBe(1)
    expect(db().prepare('SELECT id, title FROM items').get()).toEqual({ id: 1, title: 'Dune: Part One' })
  })

  it('compte les chemins sans correspondance', () => {
    seedInstances()
    expect(storeArrInstance(db(), 1, [movie()], [], 5).unmapped).toBe(1)
  })

  it('réunit un même film géré par deux instances', () => {
    seedInstances()
    storeArrInstance(db(), 1, [movie()], radarrMaps, 5)
    storeArrInstance(db(), 3, [movie({ externalId: 99 })], [], 5)
    expect(count('items')).toBe(1)
    expect(count('presences')).toBe(2)
  })
})

describe('storeServerInstance', () => {
  it('relie un élément Plex par son dossier réel', () => {
    seedInstances()
    storeArrInstance(db(), 1, [movie()], radarrMaps, 5)
    storeServerInstance(db(), 2, [plexItem()], [], plexMaps, 6)
    expect(count('items')).toBe(1)
    expect(db().prepare('SELECT item_id, library, real_folder FROM presences WHERE instance_id = 2').get()).toEqual({ item_id: 1, library: 'Movies', real_folder: '/media/movies/Dune (2021)' })
  })

  it('relie par identifiant sans correspondance de chemin', () => {
    seedInstances()
    storeArrInstance(db(), 1, [movie()], radarrMaps, 5)
    expect(storeServerInstance(db(), 2, [plexItem({ tmdbId: 438631 })], [], [], 6)).toEqual({ items: 1, files: 0, unmapped: 1 })
    expect(count('items')).toBe(1)
  })

  it('crée un titre orphelin quand rien ne correspond', () => {
    seedInstances()
    storeServerInstance(db(), 2, [plexItem({ externalId: '11', title: 'Inconnu', servicePaths: ['/media/animes-extra/X'] })], [], plexMaps, 6)
    expect(db().prepare('SELECT item_key, title FROM items').get()).toEqual({ item_key: 'movie:path:/media/animes-extra/X', title: 'Inconnu' })
  })

  it('ignore les doublons d\'identifiant externe', () => {
    seedInstances()
    expect(() => storeServerInstance(db(), 2, [plexItem(), plexItem({ library: 'Autre' })], [], plexMaps, 6)).not.toThrow()
    expect(count('presences')).toBe(1)
  })

  it('ne relie pas par dossier un titre de type différent', () => {
    seedInstances()
    storeArrInstance(db(), 1, [movie()], radarrMaps, 5)
    storeServerInstance(db(), 2, [plexItem({ type: 'series' })], [], plexMaps, 6)
    expect(count('items')).toBe(2)
  })

  it('cumule l\'historique d\'un titre présent dans deux bibliothèques', () => {
    seedInstances()
    storeArrInstance(db(), 1, [movie()], radarrMaps, 5)
    storeServerInstance(db(), 2, [plexItem(), plexItem({ externalId: '12', library: 'Movies 4K' })], [
      { externalId: '10', user: 'alice', lastWatchedAt: 100, playCount: 1 },
      { externalId: '12', user: 'alice', lastWatchedAt: 300, playCount: 2 },
      { externalId: '404', user: 'alice', lastWatchedAt: 1, playCount: 1 },
    ], plexMaps, 6)
    expect(db().prepare('SELECT user, last_watched_at, play_count FROM watch_history').all()).toEqual([{ user: 'alice', last_watched_at: 300, play_count: 3 }])
  })
})

describe('nettoyage', () => {
  it('supprime les titres sans présence', () => {
    seedInstances()
    storeArrInstance(db(), 1, [movie()], radarrMaps, 5)
    storeArrInstance(db(), 1, [], radarrMaps, 6)
    expect(pruneItems(db())).toBe(1)
    expect(count('items')).toBe(0)
  })

  it('remplace les dossiers d\'une racine gérée scannée', () => {
    replaceDiskEntries(db(), ['/media/movies'], ['/media/movies'], [{ realPath: '/media/movies/A', parent: '/media/movies' }], 1)
    replaceDiskEntries(db(), ['/media/movies'], ['/media/movies'], [{ realPath: '/media/movies/B', parent: '/media/movies' }], 2)
    expect(db().prepare('SELECT real_path, scanned_at FROM disk_entries').all()).toEqual([{ real_path: '/media/movies/B', scanned_at: 2 }])
  })

  it('garde les dossiers d\'une racine gérée non scannée (échec)', () => {
    replaceDiskEntries(db(), ['/media/movies'], ['/media/movies'], [{ realPath: '/media/movies/A', parent: '/media/movies' }], 1)
    replaceDiskEntries(db(), ['/media/movies'], [], [], 2)
    expect(count('disk_entries')).toBe(1)
  })

  it('supprime les dossiers d\'une racine qui n\'est plus gérée', () => {
    replaceDiskEntries(db(), ['/media/movies'], ['/media/movies'], [{ realPath: '/media/movies/A', parent: '/media/movies' }], 1)
    replaceDiskEntries(db(), [], [], [], 2)
    expect(count('disk_entries')).toBe(0)
  })
})
