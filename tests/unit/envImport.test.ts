import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { importFromEnv, parseMediaEnv, readMediaEnvFile } from '../../server/lib/envImport'
import { createInstance, getInstanceSecret, listInstances } from '../../server/lib/instances'
import { useTestDb } from '../helpers/db'

useTestDb()

const SAMPLE = `# Remplis les URL et clés API
RADARR_URL=http://192.168.1.10:7878
RADARR_KEY=abc
RADARR_4K_URL=http://192.168.1.11:7878/
RADARR_4K_KEY="def"
PLEX_URL=http://192.168.1.20:32400
PLEX_TOKEN=tok
JELLYFIN_URL=http://192.168.1.21:8096
JELLYFIN_KEY=
OTHER_URL=http://x
4K_LIBRARIES=Movies 4K,Series 4K
`

describe('parseMediaEnv', () => {
  it('propose une instance par couple URL + clé', () => {
    expect(parseMediaEnv(SAMPLE)).toEqual([
      { name: 'Radarr', kind: 'radarr', url: 'http://192.168.1.10:7878', apiKey: 'abc' },
      { name: 'Radarr 4K', kind: 'radarr', url: 'http://192.168.1.11:7878', apiKey: 'def' },
      { name: 'Plex', kind: 'plex', url: 'http://192.168.1.20:32400', apiKey: 'tok' },
    ])
  })
})

describe('parseMediaEnv (validation et doublons)', () => {
  it('ignore une URL invalide et une clé vide entre guillemets', () => {
    const content = `RADARR_URL=192.168.1.5:7878
RADARR_KEY=abc
SONARR_URL=ftp://x
SONARR_KEY=abc
PLEX_URL=http://p:32400
PLEX_TOKEN=""
`
    expect(parseMediaEnv(content)).toEqual([])
  })

  it('ne propose qu\'une fois une instance dont le nom se répète (premier gagne)', () => {
    const content = `RADARR_4K_URL=http://a:7878
RADARR_4K_KEY=first
radarr_4k_URL=http://b:7878
radarr_4k_KEY=second
`
    expect(parseMediaEnv(content)).toEqual([
      { name: 'Radarr 4K', kind: 'radarr', url: 'http://a:7878', apiKey: 'first' },
    ])
  })

  it('accepte le préfixe export', () => {
    const content = `export SONARR_URL=http://s:8989
export SONARR_KEY=k
`
    expect(parseMediaEnv(content)).toEqual([
      { name: 'Sonarr', kind: 'sonarr', url: 'http://s:8989', apiKey: 'k' },
    ])
  })
})

describe('readMediaEnvFile', () => {
  it('renvoie null sans fichier et le contenu sinon', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'env-'))
    expect(readMediaEnvFile(dir)).toBeNull()
    fs.writeFileSync(path.join(dir, 'media.env'), SAMPLE)
    expect(readMediaEnvFile(dir)).toBe(SAMPLE)
    fs.rmSync(dir, { recursive: true, force: true })
  })
})

describe('importFromEnv', () => {
  it('crée seulement les instances choisies et absentes', () => {
    createInstance({ kind: 'plex', name: 'Plex', url: 'http://p', apiKey: 'x', enabled: true })
    const created = importFromEnv(['Radarr 4K', 'Plex'], SAMPLE)
    expect(created.map(i => i.name)).toEqual(['Radarr 4K'])
    expect(listInstances().map(i => i.name)).toEqual(['Radarr 4K', 'Plex'])
    expect(getInstanceSecret(created[0]!.id)!.apiKey).toBe('def')
  })
})
