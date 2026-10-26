import { describe, expect, it } from 'vitest'
import { aggregateJellyfinPlayed, jellyfinLibraries, jellyfinLibraryItems, jellyfinPlayed, mapJellyfinItem } from '../../../server/connectors/jellyfin'
import { headerOf, mockFetch } from '../../helpers/fetch'

describe('Jellyfin', () => {
  it("utilise le dossier parent du fichier d'un film", () => {
    const r = mapJellyfinItem({ Id: 'a', Name: 'Dune', ProductionYear: 2021, Type: 'Movie', ProviderIds: { Tmdb: '438631', Imdb: 'tt1160419' }, Path: '/data/movies/Dune (2021)/Dune.mkv' }, 'Movies')
    expect(r).toEqual({ externalId: 'a', type: 'movie', title: 'Dune', year: 2021, tmdbId: 438631, tvdbId: null, imdbId: 'tt1160419', servicePaths: ['/data/movies/Dune (2021)'], library: 'Movies' })
  })

  it("garde le chemin d'un film rangé en dossier (BDMV) et d'une série", () => {
    expect(mapJellyfinItem({ Id: 'b', Name: 'B', Type: 'Movie', Path: '/data/movies/B (2000)' }, 'M').servicePaths).toEqual(['/data/movies/B (2000)'])
    expect(mapJellyfinItem({ Id: 'c', Name: 'C', Type: 'Series', Path: '/data/tvshows/C', ProviderIds: { Tvdb: '5' } }, 'S')).toMatchObject({ type: 'series', tvdbId: 5, servicePaths: ['/data/tvshows/C'] })
  })

  it("garde un dossier dont le nom contient un point (Dune.2021)", () => {
    expect(mapJellyfinItem({ Id: 'd', Name: 'D', Type: 'Movie', Path: '/data/movies/Dune.2021' }, 'M').servicePaths).toEqual(['/data/movies/Dune.2021'])
  })

  it("garde le fichier lui-même quand il est posé à la racine de la bibliothèque", () => {
    expect(mapJellyfinItem({ Id: 'e', Name: 'E', Type: 'Movie', Path: '/data/movies/Dune.mkv' }, 'M', ['/data/movies/']).servicePaths).toEqual(['/data/movies/Dune.mkv'])
    expect(mapJellyfinItem({ Id: 'f', Name: 'F', Type: 'Movie', Path: '/data/movies/Dune (2021)/Dune.mkv' }, 'M', ['/data/movies']).servicePaths).toEqual(['/data/movies/Dune (2021)'])
  })

  it('agrège le visionnage par film ou par série', () => {
    const out = aggregateJellyfinPlayed([
      { user: 'alice', items: [
        { Id: 'm1', Name: 'M', Type: 'Movie', UserData: { PlayCount: 2, LastPlayedDate: '2026-01-02T00:00:00Z' } },
        { Id: 'e1', Name: 'E1', Type: 'Episode', SeriesId: 's1', UserData: { PlayCount: 1, LastPlayedDate: '2026-02-01T00:00:00Z' } },
        { Id: 'e2', Name: 'E2', Type: 'Episode', SeriesId: 's1', UserData: { PlayCount: 0, LastPlayedDate: '2026-03-01T00:00:00Z' } },
      ] },
    ])
    expect(out).toEqual([
      { externalId: 'm1', user: 'alice', lastWatchedAt: Date.parse('2026-01-02T00:00:00Z'), playCount: 2 },
      { externalId: 's1', user: 'alice', lastWatchedAt: Date.parse('2026-03-01T00:00:00Z'), playCount: 2 },
    ])
  })

  it("s'authentifie avec l'en-tête MediaBrowser", async () => {
    const { calls } = mockFetch({ '/Library/VirtualFolders': [{ Name: 'Movies', CollectionType: 'movies', Locations: ['/data/movies'], ItemId: 'lib1' }] })
    expect(await jellyfinLibraries({ url: 'http://jf:8096', apiKey: 'k' })).toEqual([{ id: 'lib1', name: 'Movies', collectionType: 'movies', locations: ['/data/movies'] }])
    expect(headerOf(calls[0]!.init, 'Authorization')).toBe('MediaBrowser Token="k"')
  })

  it('refuse une réponse sans liste mais accepte une liste vide', async () => {
    const c = { url: 'http://jf:8096', apiKey: 'k' }
    mockFetch({ '/Items': {} })
    await expect(jellyfinLibraryItems(c, 'lib1')).rejects.toThrow('Réponse inattendue de Jellyfin : liste absente.')
    await expect(jellyfinPlayed(c, 'u1')).rejects.toThrow('Réponse inattendue de Jellyfin : liste absente.')
    mockFetch({ '/Items': { Items: [] } })
    expect(await jellyfinLibraryItems(c, 'lib1')).toEqual([])
  })
})
