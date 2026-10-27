import { describe, expect, it } from 'vitest'
import { arrStatus, arrTags, mapRadarrMovie, mapSonarrSeries, type RadarrMovie, type SonarrEpisode, type SonarrSeries, type ArrFile } from '../../../server/connectors/arr'
import { headerOf, mockFetch } from '../../helpers/fetch'

const tags = new Map([[1, 'kids'], [2, '4k']])

const movie: RadarrMovie = {
  id: 7, title: 'Dune', year: 2021, tmdbId: 438631, imdbId: 'tt1160419',
  originalLanguage: { name: 'English' }, genres: ['Science Fiction'],
  ratings: { imdb: { value: 8 }, tmdb: { value: 7.8 } },
  added: '2024-01-05T10:00:00Z', path: '/movies/Dune (2021)', rootFolderPath: '/movies/',
  monitored: true, hasFile: true, sizeOnDisk: 9_000_000_000, tags: [2],
  movieFile: {
    id: 70, path: '/movies/Dune (2021)/Dune.mkv', size: 9_000_000_000,
    quality: { quality: { name: 'Bluray-1080p Remux', resolution: 1080, modifier: 'remux' } },
    mediaInfo: { audioLanguages: 'eng/fre', subtitles: 'French / English', videoCodec: 'x265', resolution: '1920x800', runTime: '2:35:00' },
  },
}

describe('mapRadarrMovie', () => {
  it('normalise un film', () => {
    expect(mapRadarrMovie(movie, tags)).toEqual({
      externalId: 7, type: 'movie', title: 'Dune', year: 2021, tmdbId: 438631, tvdbId: null, imdbId: 'tt1160419',
      originalLanguage: 'en', genres: ['Science Fiction'], ratingTmdb: 7.8, ratingImdb: 8, ratingSonarr: null,
      addedAt: Date.parse('2024-01-05T10:00:00Z'), servicePath: '/movies/Dune (2021)', rootFolder: '/movies',
      monitored: true, hasFile: true, size: 9_000_000_000, tags: ['4k'],
      files: [{
        externalId: 70, season: null, episode: null, servicePath: '/movies/Dune (2021)/Dune.mkv', size: 9_000_000_000,
        resolution: 1080, videoCodec: 'hevc', audioLanguages: ['en', 'fr'], subtitleLanguages: ['fr', 'en'],
        isRemux: true, runtimeSeconds: 9300,
      }],
    })
  })

  it('gère un film sans fichier ni métadonnées', () => {
    const r = mapRadarrMovie({ id: 1, title: 'X', path: '/movies/X', monitored: false, hasFile: false, year: 0, added: '0001-01-01T00:00:00Z' }, tags)
    expect(r).toMatchObject({ year: null, addedAt: null, originalLanguage: null, files: [], size: 0, rootFolder: null })
  })

  it('reconstruit le chemin du fichier depuis relativePath', () => {
    const r = mapRadarrMovie({ ...movie, movieFile: { id: 1, relativePath: 'Dune.mkv', size: 1 } }, tags)
    expect(r.files[0]!.servicePath).toBe('/movies/Dune (2021)/Dune.mkv')
  })
})

describe('mapSonarrSeries', () => {
  const series: SonarrSeries = {
    id: 3, title: 'The Expanse', year: 2015, tvdbId: 280619, tmdbId: 63639, imdbId: 'tt3230854',
    originalLanguage: { name: 'English' }, genres: ['Drama'], added: '2023-02-01T00:00:00Z',
    path: '/series/The Expanse', rootFolderPath: '/series', monitored: true, tags: [1],
    statistics: { episodeFileCount: 2, sizeOnDisk: 3000 },
  }
  const episodes: SonarrEpisode[] = [
    { id: 1, seasonNumber: 1, episodeNumber: 1, hasFile: true, episodeFileId: 11 },
    { id: 2, seasonNumber: 1, episodeNumber: 2, hasFile: true, episodeFileId: 12 },
    { id: 3, seasonNumber: 1, episodeNumber: 3, hasFile: true, episodeFileId: 12 },
    { id: 4, seasonNumber: 1, episodeNumber: 4, hasFile: false },
  ]
  const files: ArrFile[] = [
    { id: 11, path: '/series/The Expanse/S01/e1.mkv', size: 1000, quality: { quality: { resolution: 720 } }, mediaInfo: { audioLanguages: 'English' } },
    { id: 12, path: '/series/The Expanse/S01/e2-e3.mkv', size: 2000, quality: { quality: { resolution: 1080 } }, mediaInfo: { audioLanguages: 'English/French' } },
  ]

  it('normalise une série et ses fichiers (un fichier multi-épisodes compte une fois)', () => {
    const r = mapSonarrSeries(series, episodes, files, tags)
    expect(r).toMatchObject({ type: 'series', tvdbId: 280619, tmdbId: 63639, hasFile: true, size: 3000, tags: ['kids'], ratingTmdb: null })
    expect(r.files).toHaveLength(2)
    expect(r.files[1]).toMatchObject({ externalId: 12, season: 1, episode: 2, resolution: 1080, audioLanguages: ['en', 'fr'] })
  })

  it('reprend la note Sonarr, sauf une note sans votes', () => {
    expect(mapSonarrSeries({ ...series, ratings: { value: 8.4, votes: 1200 } }, [], [], tags).ratingSonarr).toBe(8.4)
    expect(mapSonarrSeries({ ...series, ratings: { value: 0, votes: 0 } }, [], [], tags).ratingSonarr).toBeNull()
    expect(mapSonarrSeries(series, [], [], tags).ratingSonarr).toBeNull()
  })

  it('a hasFile faux sans fichier', () => {
    expect(mapSonarrSeries({ ...series, statistics: { episodeFileCount: 0 } }, [], [], tags).hasFile).toBe(false)
  })
})

describe('appels API', () => {
  it('envoie X-Api-Key sur /api/v3', async () => {
    const { calls } = mockFetch({ '/api/v3/system/status': { appName: 'Radarr', version: '6.4.4' } })
    expect(await arrStatus({ url: 'http://radarr:7878/', apiKey: 'k1' })).toEqual({ appName: 'Radarr', version: '6.4.4' })
    expect(calls[0]!.url.toString()).toBe('http://radarr:7878/api/v3/system/status')
    expect(headerOf(calls[0]!.init, 'X-Api-Key')).toBe('k1')
  })

  it('transforme les tags en dictionnaire', async () => {
    mockFetch({ '/api/v3/tag': [{ id: 1, label: 'kids' }] })
    expect(await arrTags({ url: 'http://r', apiKey: 'k' })).toEqual(new Map([[1, 'kids']]))
  })
})
