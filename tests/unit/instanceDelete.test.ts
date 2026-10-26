import { describe, expect, it } from 'vitest'
import type { H3Event } from 'h3'
import handler from '../../server/api/instances/[id].delete'
import { loadCatalogRows } from '../../server/lib/catalog'
import { createInstance } from '../../server/lib/instances'
import { storeArrInstance } from '../../server/lib/sync/store'
import type { ArrItemRecord } from '../../server/lib/sync/types'
import { useTestDb } from '../helpers/db'

const db = useTestDb()

function movie(externalId: number, title: string, tmdbId: number): ArrItemRecord {
  return {
    externalId, type: 'movie', title, year: 2021, tmdbId, tvdbId: null, imdbId: null, originalLanguage: 'en', genres: [], ratingTmdb: null, ratingImdb: null,
    addedAt: null, servicePath: `/movies/${title}`, rootFolder: '/movies', monitored: true, hasFile: true, size: 0, tags: [], files: [],
  }
}

describe('DELETE /api/instances/:id', () => {
  it('retire aussitôt du catalogue les titres que seule cette instance référençait', async () => {
    createInstance({ kind: 'radarr', name: 'A', url: 'http://a', apiKey: 'k', enabled: true })
    createInstance({ kind: 'radarr', name: 'B', url: 'http://b', apiKey: 'k', enabled: true })
    storeArrInstance(db(), 1, [movie(1, 'Dune', 1), movie(2, 'Alien', 2)], [], 1)
    storeArrInstance(db(), 2, [movie(1, 'Dune', 1)], [], 1)
    expect(loadCatalogRows().map(r => r.title)).toEqual(['Alien', 'Dune'])
    const event = { context: { params: { id: '1' } } } as unknown as H3Event
    expect(await handler(event)).toEqual({ ok: true })
    expect(loadCatalogRows().map(r => r.title)).toEqual(['Dune'])
    expect((db().prepare('SELECT COUNT(*) AS n FROM items').get() as { n: number }).n).toBe(1)
  })
})
