import { beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { decrypt, encrypt, resetSecretCacheForTests } from '../../server/lib/secrets'
import { configDir } from '../../server/lib/config'

beforeEach(() => resetSecretCacheForTests())

describe('secrets', () => {
  it('chiffre et déchiffre', () => {
    const token = encrypt('ma-cle-api')
    expect(token.startsWith('v1:')).toBe(true)
    expect(token).not.toContain('ma-cle-api')
    expect(decrypt(token)).toBe('ma-cle-api')
  })

  it('produit un chiffré différent à chaque appel', () => {
    expect(encrypt('x')).not.toBe(encrypt('x'))
  })

  it('refuse un chiffré modifié', () => {
    const [v, iv, tag, data] = encrypt('ma-cle-api').split(':')
    const flipped = Buffer.from(data!, 'base64')
    flipped[0] = flipped[0]! ^ 0xff
    expect(() => decrypt([v, iv, tag, flipped.toString('base64')].join(':'))).toThrow()
  })

  it('réutilise la clé maître enregistrée après un redémarrage', () => {
    const token = encrypt('persistante')
    expect(fs.existsSync(path.join(configDir(), 'secret'))).toBe(true)
    resetSecretCacheForTests()
    expect(decrypt(token)).toBe('persistante')
  })

  it('refuse un tag tronqué', () => {
    const [v, iv, tag, data] = encrypt('ma-cle-api').split(':')
    const short = Buffer.from(tag!, 'base64').subarray(0, 8)
    expect(() => decrypt([v, iv, short.toString('base64'), data].join(':'))).toThrow('Secret chiffré illisible')
  })

  it('refuse un tag altéré', () => {
    const [v, iv, tag, data] = encrypt('ma-cle-api').split(':')
    const flipped = Buffer.from(tag!, 'base64')
    flipped[0] = flipped[0]! ^ 0xff
    expect(() => decrypt([v, iv, flipped.toString('base64'), data].join(':'))).toThrow()
  })

  it('rejette un format inconnu', () => {
    expect(() => decrypt('pas-un-secret')).toThrow('Secret chiffré illisible')
  })
})
