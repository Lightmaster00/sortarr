import { describe, expect, it } from 'vitest'
import { aggregatePlexHistory, mapPlexItem, parsePlexGuids, plexHistory, plexSectionItems, plexSections } from '../../../server/connectors/plex'
import { headerOf, mockFetch } from '../../helpers/fetch'

const conn = { url: 'http://plex:32400', token: 'tok' }

describe('Plex', () => {
  it('lit les GUID externes', () => {
    expect(parsePlexGuids([{ id: 'imdb://tt1' }, { id: 'tmdb://42' }, { id: 'tvdb://7' }])).toEqual({ imdbId: 'tt1', tmdbId: 42, tvdbId: 7 })
    expect(parsePlexGuids(undefined)).toEqual({ imdbId: null, tmdbId: null, tvdbId: null })
  })

  it("prend le dossier d'un film à partir de ses fichiers", () => {
    const r = mapPlexItem({ ratingKey: '10', type: 'movie', title: 'Dune', year: 2021, Guid: [{ id: 'tmdb://438631' }], Media: [{ Part: [{ file: '/media/movies/Dune (2021)/Dune.mkv' }] }, { Part: [{ file: '/media/movies/Dune (2021)/Dune.4k.mkv' }] }] }, 'Movies')
    expect(r).toEqual({ externalId: '10', type: 'movie', title: 'Dune', year: 2021, tmdbId: 438631, tvdbId: null, imdbId: null, servicePaths: ['/media/movies/Dune (2021)'], library: 'Movies' })
  })

  it("garde le fichier lui-même quand il est posé à la racine de la bibliothèque", () => {
    const r = mapPlexItem({ ratingKey: '11', type: 'movie', title: 'Dune', Media: [{ Part: [{ file: '/media/movies/Dune.mkv' }] }] }, 'Movies', ['/media/movies'])
    expect(r.servicePaths).toEqual(['/media/movies/Dune.mkv'])
  })

  it("prend les dossiers d'une série dans Location", () => {
    const r = mapPlexItem({ ratingKey: '20', type: 'show', title: 'X', Location: [{ path: '/media/series/X' }] }, 'Series')
    expect(r).toMatchObject({ type: 'series', servicePaths: ['/media/series/X'], year: null })
  })

  it('agrège l\'historique par titre et par compte', () => {
    const accounts = new Map([[1, 'alice']])
    const out = aggregatePlexHistory([
      { type: 'movie', ratingKey: '10', viewedAt: 100, accountID: 1 },
      { type: 'movie', ratingKey: '10', viewedAt: 300, accountID: 1 },
      { type: 'episode', ratingKey: '99', grandparentKey: '/library/metadata/20', viewedAt: 200, accountID: 2 },
    ], accounts)
    expect(out).toEqual([
      { externalId: '10', user: 'alice', lastWatchedAt: 300_000, playCount: 2 },
      { externalId: '20', user: 'compte 2', lastWatchedAt: 200_000, playCount: 1 },
    ])
  })

  it('lit les sections avec le jeton en en-tête', async () => {
    const { calls } = mockFetch({ '/library/sections': { MediaContainer: { Directory: [{ key: '1', title: 'Movies', type: 'movie', Location: [{ path: '/media/movies' }] }] } } })
    expect(await plexSections(conn)).toEqual([{ key: '1', title: 'Movies', type: 'movie', locations: ['/media/movies'] }])
    expect(headerOf(calls[0]!.init, 'X-Plex-Token')).toBe('tok')
    expect(calls[0]!.url.search).not.toContain('tok')
  })

  it("pagine l'historique", async () => {
    const { calls } = mockFetch({
      '/status/sessions/history/all': (url: URL) => {
        const start = Number(url.searchParams.get('X-Plex-Container-Start'))
        const size = start === 0 ? 2 : start === 2 ? 1 : 0
        return { MediaContainer: { Metadata: Array.from({ length: size }, (_, i) => ({ type: 'movie', ratingKey: String(start + i), viewedAt: 1, accountID: 1 })) } }
      },
    })
    expect(await plexHistory(conn, 2)).toHaveLength(3)
    expect(calls).toHaveLength(3)
  })

  it('s\'arrête dès que totalSize est atteint', async () => {
    const { calls } = mockFetch({
      '/status/sessions/history/all': (url: URL) => {
        const start = Number(url.searchParams.get('X-Plex-Container-Start'))
        const size = start === 0 ? 2 : 1
        return { MediaContainer: { totalSize: 3, Metadata: Array.from({ length: size }, (_, i) => ({ type: 'movie', ratingKey: String(start + i), viewedAt: 1, accountID: 1 })) } }
      },
    })
    expect(await plexHistory(conn, 2)).toHaveLength(3)
    expect(calls).toHaveLength(2)
  })

  it('garde une seule fois une entrée de même historyKey', async () => {
    mockFetch({
      '/status/sessions/history/all': (url: URL) => {
        const start = Number(url.searchParams.get('X-Plex-Container-Start'))
        const pages: Record<number, string[]> = { 0: ['a', 'b'], 2: ['b', 'c'] }
        const keys = pages[start] ?? []
        return { MediaContainer: { Metadata: keys.map(k => ({ historyKey: k, type: 'movie', ratingKey: '10', viewedAt: 1, accountID: 1 })) } }
      },
    })
    const out = await plexHistory(conn, 2)
    expect(out.map(e => e.historyKey)).toEqual(['a', 'b', 'c'])
  })

  it('lève une erreur si la pagination dépasse la limite', async () => {
    mockFetch({
      '/status/sessions/history/all': { MediaContainer: { Metadata: [{ type: 'movie', ratingKey: '10', viewedAt: 1, accountID: 1 }] } },
    })
    await expect(plexHistory(conn, 1)).rejects.toThrow('Historique Plex trop volumineux : pagination interrompue.')
  })

  it('utilise le nom du compte, ou compte N si le nom est vide', () => {
    const out = aggregatePlexHistory([{ type: 'movie', ratingKey: '10', viewedAt: 1, accountID: 1 }], new Map([[1, '']]))
    expect(out).toEqual([{ externalId: '10', user: 'compte 1', lastWatchedAt: 1000, playCount: 1 }])
  })

  it('refuse une réponse sans MediaContainer mais accepte une section vide', async () => {
    mockFetch({ '/library/sections/1/all': {}, '/status/sessions/history/all': {} })
    await expect(plexSectionItems(conn, '1')).rejects.toThrow('Réponse inattendue de Plex : liste absente.')
    await expect(plexHistory(conn)).rejects.toThrow('Réponse inattendue de Plex : liste absente.')
    mockFetch({ '/library/sections/1/all': { MediaContainer: { size: 0 } } })
    expect(await plexSectionItems(conn, '1')).toEqual([])
  })
})
