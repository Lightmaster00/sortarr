import fs from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { configDir } from '../../server/lib/config'
import { createInstance } from '../../server/lib/instances'
import { getPoster, posterRequest, resetPostersForTests } from '../../server/lib/posters'
import { useTestDb } from '../helpers/db'

const db = useTestDb()
beforeEach(() => {
  resetPostersForTests()
  fs.rmSync(path.join(configDir(), 'cache'), { recursive: true, force: true })
})

function item(id: number) {
  db().prepare("INSERT INTO items (id, item_key, type, title, updated_at) VALUES (?, ?, 'movie', 'Dune', 0)").run(id, `k${id}`)
}
function presence(itemId: number, instanceId: number, externalId: string) {
  db().prepare('INSERT INTO presences (item_id, instance_id, external_id, synced_at) VALUES (?, ?, ?, 0)').run(itemId, instanceId, externalId)
}
const jpeg = { type: 'image/jpeg', data: Buffer.from([0xff, 0xd8, 0xff]) }

describe('posterRequest', () => {
  it('garde la clé dans les en-têtes', () => {
    expect(posterRequest({ kind: 'radarr', url: 'http://r/', apiKey: 'secret' }, '12')).toEqual({ url: 'http://r/api/v3/mediacover/12/poster-250.jpg', headers: { 'X-Api-Key': 'secret' } })
    expect(posterRequest({ kind: 'plex', url: 'http://p', apiKey: 't' }, '5').url).toBe('http://p/library/metadata/5/thumb')
    expect(posterRequest({ kind: 'jellyfin', url: 'http://j', apiKey: 't' }, 'a/b').url).toContain('/Items/a%2Fb/Images/Primary')
  })
})

describe('getPoster', () => {
  it('préfère Radarr/Sonarr, passe au serveur suivant en cas d\'échec, puis sert le cache', async () => {
    createInstance({ kind: 'plex', name: 'Plex', url: 'http://p', apiKey: 'k', enabled: true })
    createInstance({ kind: 'radarr', name: 'Radarr', url: 'http://r', apiKey: 'k', enabled: true })
    item(1)
    presence(1, 1, '50')
    presence(1, 2, '7')
    const download = vi.fn(async (url: string) => {
      if (url.startsWith('http://r')) throw new Error('404')
      return jpeg
    })
    expect(await getPoster(1, db(), download)).toEqual(jpeg)
    expect(download.mock.calls.map(c => c[0])).toEqual(['http://r/api/v3/mediacover/7/poster-250.jpg', 'http://p/library/metadata/50/thumb'])
    expect(await getPoster(1, db(), download)).toEqual(jpeg)
    expect(download).toHaveBeenCalledTimes(2)
  })

  it('mémorise l\'absence d\'affiche pendant quelques heures', async () => {
    item(1)
    const download = vi.fn(async () => jpeg)
    expect(await getPoster(1, db(), download, 0)).toBeNull()
    createInstance({ kind: 'radarr', name: 'Radarr', url: 'http://r', apiKey: 'k', enabled: true })
    presence(1, 1, '7')
    expect(await getPoster(1, db(), download, 1000)).toBeNull()
    expect(await getPoster(1, db(), download, 7 * 60 * 60 * 1000)).toEqual(jpeg)
  })
})
