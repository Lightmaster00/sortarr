import { describe, expect, it } from 'vitest'
import { discover } from '../../server/lib/discovery'
import { mockFetch } from '../helpers/fetch'

describe('discover', () => {
  it('découvre un Radarr', async () => {
    mockFetch({
      '/api/v3/system/status': { appName: 'Radarr', version: '6.4.4' },
      '/api/v3/rootfolder': [{ path: '/movies' }, { path: '/animations' }],
      '/api/v3/qualityprofile': [{ id: 1, name: 'Any' }],
    })
    expect(await discover({ kind: 'radarr', url: 'http://r', apiKey: 'k' })).toEqual({
      version: '6.4.4',
      roots: [{ path: '/movies', label: '/movies' }, { path: '/animations', label: '/animations' }],
      qualityProfiles: ['Any'],
      libraries: [],
    })
  })

  it('refuse un Sonarr déclaré comme Radarr', async () => {
    mockFetch({ '/api/v3/system/status': { appName: 'Sonarr', version: '4.0.20' } })
    await expect(discover({ kind: 'radarr', url: 'http://s', apiKey: 'k' })).rejects.toThrow('Ce service est un Sonarr, pas un Radarr.')
  })

  it('ne garde que les bibliothèques films et séries de Plex', async () => {
    mockFetch({
      '/identity': { MediaContainer: { machineIdentifier: 'm', version: '1.41.0' } },
      '/library/sections': { MediaContainer: { Directory: [
        { key: '1', title: 'Movies', type: 'movie', Location: [{ path: '/media/movies' }] },
        { key: '2', title: 'Music', type: 'artist', Location: [{ path: '/music' }] },
        { key: '3', title: 'Animes', type: 'show', Location: [{ path: '/media/animes' }, { path: '/media/animes-extra' }] },
      ] } },
    })
    const d = await discover({ kind: 'plex', url: 'http://p', apiKey: 't' })
    expect(d.libraries.map(l => l.name)).toEqual(['Movies', 'Animes'])
    expect(d.roots).toEqual([
      { path: '/media/movies', label: 'Movies' },
      { path: '/media/animes', label: 'Animes' },
      { path: '/media/animes-extra', label: 'Animes' },
    ])
  })

  it('découvre Jellyfin', async () => {
    mockFetch({
      '/System/Info': { Version: '12.3.0', ServerName: 'Primary' },
      '/Library/VirtualFolders': [
        { Name: 'Series', CollectionType: 'tvshows', Locations: ['/data/tvshows'], ItemId: 'a' },
        { Name: 'Photos', CollectionType: 'homevideos', Locations: ['/data/photos'], ItemId: 'b' },
      ],
    })
    const d = await discover({ kind: 'jellyfin', url: 'http://j', apiKey: 'k' })
    expect(d).toMatchObject({ version: '12.3.0', roots: [{ path: '/data/tvshows', label: 'Series' }] })
  })
})
