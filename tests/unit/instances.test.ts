import { describe, expect, it } from 'vitest'
import { createInstance, deleteInstance, getInstance, getInstanceSecret, listInstances, registerDeletionGuard, setInstanceStatus, updateInstance } from '../../server/lib/instances'
import { useTestDb } from '../helpers/db'

const db = useTestDb()
const radarr = { kind: 'radarr' as const, name: 'Radarr', url: 'http://192.168.1.10:7878', apiKey: 'cle-secrete', enabled: true }

describe('instances', () => {
  it('crée une instance sans jamais exposer la clé', () => {
    const dto = createInstance(radarr)
    expect(dto).toMatchObject({ id: 1, kind: 'radarr', name: 'Radarr', hasKey: true, enabled: true, lastStatus: 'inconnu' })
    expect(JSON.stringify(dto)).not.toContain('cle-secrete')
    const row = db().prepare('SELECT api_key_enc FROM instances').get() as { api_key_enc: string }
    expect(row.api_key_enc).not.toContain('cle-secrete')
    expect(getInstanceSecret(1)!.apiKey).toBe('cle-secrete')
  })

  it('refuse deux instances du même nom (sans tenir compte de la casse)', () => {
    createInstance(radarr)
    expect(() => createInstance({ ...radarr, name: 'radarr' })).toThrow('Une instance porte déjà ce nom.')
  })

  it('garde la clé si aucune nouvelle clé n\'est fournie', () => {
    createInstance(radarr)
    updateInstance(1, { name: 'Radarr HD', url: radarr.url, enabled: false })
    expect(getInstance(1)).toMatchObject({ name: 'Radarr HD', url: radarr.url, enabled: false })
    expect(getInstanceSecret(1)!.apiKey).toBe('cle-secrete')
    updateInstance(1, { name: 'Radarr HD', url: radarr.url, enabled: true, apiKey: 'nouvelle' })
    expect(getInstanceSecret(1)!.apiKey).toBe('nouvelle')
  })

  it('supprime une instance et refuse si une garde la bloque', () => {
    createInstance(radarr)
    createInstance({ ...radarr, name: 'Radarr 4K' })
    registerDeletionGuard(id => (id === 2 ? ['Règle « Films anglais → 4K »'] : []))
    deleteInstance(1)
    expect(listInstances().map(i => i.name)).toEqual(['Radarr 4K'])
    expect(() => deleteInstance(2)).toThrow('Instance utilisée')
    expect(() => deleteInstance(99)).toThrow('Instance introuvable')
  })

  it('met à jour le statut', () => {
    createInstance(radarr)
    setInstanceStatus(1, { status: 'ok', error: null, version: '6.4.4', syncedAt: 123 })
    expect(getInstance(1)).toMatchObject({ lastStatus: 'ok', version: '6.4.4', lastSyncAt: 123, lastError: null })
    setInstanceStatus(1, { status: 'perime', error: 'Service injoignable' })
    expect(getInstance(1)).toMatchObject({ lastStatus: 'perime', version: '6.4.4', lastSyncAt: 123, lastError: 'Service injoignable' })
  })

  it('garde « données périmées » après un test de connexion réussi', () => {
    createInstance(radarr)
    expect(getInstance(1)!.stale).toBe(false)
    setInstanceStatus(1, { status: 'ok', error: null, syncedAt: 100, syncOk: true })
    setInstanceStatus(1, { status: 'perime', error: 'Service injoignable', syncOk: false })
    expect(getInstance(1)).toMatchObject({ lastStatus: 'perime', stale: true })
    // ce que fait la route de test de connexion :
    setInstanceStatus(1, { status: 'ok', error: null, version: '6.4.4' })
    expect(getInstance(1)).toMatchObject({ lastStatus: 'ok', stale: true })
    updateInstance(1, { name: 'Radarr', url: 'http://autre:7878', enabled: true, apiKey: 'cle' })
    expect(getInstance(1)).toMatchObject({ lastStatus: 'inconnu', stale: true })
  })

  it('réinitialise le statut quand l\'adresse change', () => {
    createInstance(radarr)
    setInstanceStatus(1, { status: 'ok', version: '6.4.4' })
    updateInstance(1, { name: 'Radarr', url: radarr.url, enabled: true })
    expect(getInstance(1)!.lastStatus).toBe('ok')
    updateInstance(1, { name: 'Radarr', url: 'http://autre:7878', enabled: true, apiKey: 'cle' })
    expect(getInstance(1)).toMatchObject({ lastStatus: 'inconnu', lastError: null })
  })

  it('signale en français une clé illisible', () => {
    createInstance(radarr)
    db().prepare("UPDATE instances SET api_key_enc = 'v1:AAAAAAAAAAAAAAAA:AAAAAAAAAAAAAAAAAAAAAA==:AAAA' WHERE id = 1").run()
    expect(() => getInstanceSecret(1)).toThrow('Clé API illisible (fichier /config/secret changé ?) : ressaisis-la.')
  })

  it('exige la clé API quand l\'adresse change', () => {
    createInstance(radarr)
    expect(() => updateInstance(1, { name: 'Radarr', url: 'http://autre:7878', enabled: true })).toThrow('Clé API obligatoire pour une nouvelle adresse.')
    expect(getInstance(1)!.url).toBe(radarr.url)
  })
})
