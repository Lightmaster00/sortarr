import { describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { autoConfigurePaths, isUnder, listMappings, normalizeDir, replaceMappings, suggestRealPath, toRealWith, toServiceWith, tryReal, verifyInstancePaths } from '../../server/lib/paths'
import { createInstance, getInstance } from '../../server/lib/instances'
import { mediaRoot } from '../../server/lib/config'
import { useTestDb } from '../helpers/db'

useTestDb()

const jellyfin = [
  { servicePath: '/data/', realPath: '/media' },
  { servicePath: '/data/tvshows', realPath: '/media/series' },
]

describe('fonctions pures', () => {
  it('normalise les dossiers', () => {
    expect(normalizeDir('/data//tvshows/')).toBe('/data/tvshows')
    expect(normalizeDir('/')).toBe('/')
  })

  it('teste l\'inclusion sans confondre les préfixes', () => {
    expect(isUnder('/media/movies-4k/X', '/media/movies')).toBe(false)
    expect(isUnder('/media/movies/X', '/media/movies')).toBe(true)
    expect(isUnder('/anything', '/')).toBe(true)
  })

  it('convertit avec le plus long préfixe', () => {
    expect(toRealWith(jellyfin, '/data/tvshows/The Expanse')).toBe('/media/series/The Expanse')
    expect(toRealWith(jellyfin, '/data/movies/Dune (2021)')).toBe('/media/movies/Dune (2021)')
    expect(toRealWith(jellyfin, '/data')).toBe('/media')
  })

  it('lève une erreur explicite sans correspondance', () => {
    expect(() => toRealWith(jellyfin, '/autre/x')).toThrow('Aucune correspondance de chemin pour /autre/x')
    expect(tryReal(jellyfin, '/autre/x')).toBeNull()
  })

  it('convertit dans l\'autre sens', () => {
    expect(toServiceWith([{ servicePath: '/movies', realPath: '/media/movies-4k' }], '/media/movies-4k/Film')).toBe('/movies/Film')
  })
})

describe('stockage', () => {
  it('remplace les correspondances d\'une instance', () => {
    createInstance({ kind: 'radarr', name: 'Radarr', url: 'http://r', apiKey: 'k', enabled: true })
    const root = mediaRoot()
    replaceMappings(1, [{ servicePath: '/movies/', realPath: `${root}/movies`, managed: true }])
    replaceMappings(1, [{ servicePath: '/animations', realPath: `${root}/animations`, managed: false }])
    expect(listMappings(1)).toEqual([{ id: 2, instanceId: 1, servicePath: '/animations', realPath: `${root}/animations`, managed: false }])
  })

  it('refuse un chemin réel hors de la racine médias et les doublons', () => {
    createInstance({ kind: 'radarr', name: 'Radarr', url: 'http://r', apiKey: 'k', enabled: true })
    expect(() => replaceMappings(1, [{ servicePath: '/movies', realPath: '/etc', managed: true }])).toThrow('doit être sous')
    const real = `${mediaRoot()}/movies`
    expect(() => replaceMappings(1, [{ servicePath: '/movies', realPath: real, managed: true }, { servicePath: '/movies/', realPath: real, managed: true }])).toThrow('en double')
  })
})

describe('suggestRealPath', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nas-'))
  fs.mkdirSync(path.join(root, 'movies'))
  fs.mkdirSync(path.join(root, 'films', 'movies-4k'), { recursive: true })

  it('trouve un dossier de même nom directement sous la racine', () => {
    expect(suggestRealPath('/movies', root)).toBe(`${root}/movies`)
  })

  it('cherche aussi un niveau plus bas', () => {
    expect(suggestRealPath('/data/movies-4k', root)).toBe(`${root}/films/movies-4k`)
  })

  it('garde un chemin qui existe déjà sous la racine', () => {
    expect(suggestRealPath(`${root}/movies`, root)).toBe(`${root}/movies`)
  })

  it('renvoie null sans correspondance', () => {
    expect(suggestRealPath('/data/tvshows', root)).toBeNull()
  })
})

describe('verifyInstancePaths', () => {
  it('vérifie les dossiers racines et un échantillon', async () => {
    createInstance({ kind: 'radarr', name: 'Radarr', url: 'http://r', apiKey: 'k', enabled: true })
    const root = mediaRoot()
    fs.mkdirSync(`${root}/movies/Dune (2021)`, { recursive: true })
    replaceMappings(1, [{ servicePath: '/movies', realPath: `${root}/movies`, managed: true }])
    const result = await verifyInstancePaths(1, {
      roots: async () => ['/movies', '/animations'],
      samples: async () => ['/movies/Dune (2021)', '/movies/Absent (1999)'],
    })
    expect(result.ok).toBe(false)
    expect(result.checks.map(c => [c.servicePath, c.exists, c.message])).toEqual([
      ['/movies', true, 'OK'],
      ['/animations', false, 'Aucune correspondance'],
      ['/movies/Dune (2021)', true, 'OK'],
      ['/movies/Absent (1999)', false, `Dossier introuvable : ${root}/movies/Absent (1999)`],
    ])
  })
})

describe('autoConfigurePaths', () => {
  it('enregistre les dossiers retrouvés et compte ceux qui manquent', async () => {
    createInstance({ kind: 'radarr', name: 'Radarr', url: 'http://r', apiKey: 'k', enabled: true })
    const root = mediaRoot()
    fs.mkdirSync(`${root}/films/movies-4k`, { recursive: true })
    const result = await autoConfigurePaths(1, { roots: async () => ['/data/movies-4k/', '/data/movies-4k', '/introuvable'] })
    expect(result).toEqual({ found: 1, missing: 1 })
    expect(listMappings(1).map(m => [m.servicePath, m.realPath, m.managed])).toEqual([['/data/movies-4k', `${root}/films/movies-4k`, true]])
    expect(getInstance(1)?.pathCount).toBe(1)
  })

  it('ne touche pas à des correspondances déjà enregistrées', async () => {
    createInstance({ kind: 'radarr', name: 'Radarr', url: 'http://r', apiKey: 'k', enabled: true })
    const root = mediaRoot()
    fs.mkdirSync(`${root}/movies`, { recursive: true })
    replaceMappings(1, [{ servicePath: '/films', realPath: `${root}/movies`, managed: false }])
    const roots = vi.fn(async () => ['/movies'])
    expect(await autoConfigurePaths(1, { roots })).toEqual({ found: 0, missing: 0 })
    expect(roots).not.toHaveBeenCalled()
    expect(listMappings(1)).toHaveLength(1)
  })
})
