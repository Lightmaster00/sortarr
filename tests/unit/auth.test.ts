import { describe, expect, it } from 'vitest'
import { changePassword, createAdmin, createSession, deleteSession, hasAdmin, isValidSession, SESSION_TTL_MS, verifyCredentials } from '../../server/lib/auth'
import { useTestDb } from '../helpers/db'

const db = useTestDb()

describe('compte admin', () => {
  it('crée le compte une seule fois', async () => {
    expect(hasAdmin()).toBe(false)
    await createAdmin('admin', 'motdepasse1')
    expect(hasAdmin()).toBe(true)
    await expect(createAdmin('autre', 'motdepasse2')).rejects.toMatchObject({ statusCode: 409 })
  })

  it('refuse un mot de passe trop court', async () => {
    await expect(createAdmin('admin', 'court')).rejects.toThrow('au moins 8 caractères')
  })

  it('vérifie les identifiants', async () => {
    await createAdmin('admin', 'motdepasse1')
    expect(await verifyCredentials('admin', 'motdepasse1')).toBe(true)
    expect(await verifyCredentials('admin', 'mauvais')).toBe(false)
    expect(await verifyCredentials('inconnu', 'motdepasse1')).toBe(false)
  })

  it('ne stocke pas le mot de passe en clair', async () => {
    await createAdmin('admin', 'motdepasse1')
    const row = db().prepare('SELECT password_hash FROM users').get() as { password_hash: string }
    expect(row.password_hash).not.toContain('motdepasse1')
    expect(row.password_hash.startsWith('$2')).toBe(true)
  })
})

describe('sessions', () => {
  it('crée, valide et supprime une session', () => {
    const id = createSession()
    expect(id).toMatch(/^[0-9a-f]{64}$/)
    expect(isValidSession(id)).toBe(true)
    deleteSession(id)
    expect(isValidSession(id)).toBe(false)
    expect(isValidSession(undefined)).toBe(false)
  })

  it('expire après SESSION_TTL_MS', () => {
    const now = 1_000_000
    const id = createSession(undefined, now)
    expect(isValidSession(id, undefined, now + SESSION_TTL_MS - 1)).toBe(true)
    expect(isValidSession(id, undefined, now + SESSION_TTL_MS + 1)).toBe(false)
  })

  it('changer le mot de passe ferme toutes les sessions', async () => {
    await createAdmin('admin', 'motdepasse1')
    const id = createSession()
    await expect(changePassword('mauvais', 'nouveaumdp1')).rejects.toMatchObject({ statusCode: 403 })
    await changePassword('motdepasse1', 'nouveaumdp1')
    expect(isValidSession(id)).toBe(false)
    expect(await verifyCredentials('admin', 'nouveaumdp1')).toBe(true)
  })
})
