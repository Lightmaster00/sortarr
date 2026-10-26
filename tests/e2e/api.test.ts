import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fetch, setup } from '@nuxt/test-utils/e2e'

process.env.SORTARR_CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sortarr-e2e-'))
process.env.SORTARR_DISABLE_SCHEDULER = '1'

export function post(body: unknown, cookie?: string, method = 'POST'): RequestInit {
  return {
    method,
    headers: { 'content-type': 'application/json', 'x-sortarr': '1', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  }
}

describe('API', async () => {
  await setup({ server: true, browser: false })
  let cookie = ''

  it('répond au healthcheck sans session', async () => {
    const res = await fetch('/api/health')
    expect(await res.json()).toEqual({ ok: true })
  })

  it('refuse les routes protégées sans session', async () => {
    expect((await fetch('/api/instances')).status).toBe(401)
  })

  it('refuse un chemin encodé vers une route protégée sans session', async () => {
    expect((await fetch('/%61pi/instances')).status).toBe(401)
    expect((await fetch('/api%2finstances')).status).toBe(401)
    expect((await fetch('/api/auth/%70assword', post({ current: 'a', next: 'motdepasse1', confirm: 'motdepasse1' }))).status).toBe(401)
    expect((await fetch('/%61pi/auth/password', post({ current: 'a', next: 'motdepasse1', confirm: 'motdepasse1' }))).status).toBe(401)
    const noHeader = await fetch('/%61pi/auth/password', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    expect(noHeader.status).toBe(403)
  })

  it('refuse une écriture sans en-tête x-sortarr', async () => {
    const res = await fetch('/api/auth/setup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'motdepasse1', confirm: 'motdepasse1' }) })
    expect(res.status).toBe(403)
  })

  it('crée le compte admin et ouvre une session', async () => {
    const res = await fetch('/api/auth/setup', post({ username: 'admin', password: 'motdepasse1', confirm: 'motdepasse1' }))
    expect(res.status).toBe(200)
    cookie = res.headers.get('set-cookie')!.split(';')[0]!
    const status = await (await fetch('/api/auth/status', { headers: { cookie } })).json()
    expect(status).toEqual({ hasAdmin: true, authenticated: true })
  })

  it('refuse un second compte', async () => {
    const res = await fetch('/api/auth/setup', post({ username: 'b', password: 'motdepasse2', confirm: 'motdepasse2' }))
    expect(res.status).toBe(409)
  })

  it('refuse un mauvais mot de passe avec un message en français', async () => {
    const res = await fetch('/api/auth/login', post({ username: 'admin', password: 'mauvais' }))
    expect(res.status).toBe(401)
    expect((await res.json()).message).toBe('Identifiants incorrects.')
  })

  it('crée une instance sans jamais renvoyer sa clé', async () => {
    const created = await fetch('/api/instances', post({ kind: 'radarr', name: 'Radarr', url: 'http://127.0.0.1:9/', apiKey: 'cle-tres-secrete' }, cookie))
    expect(created.status).toBe(200)
    const body = await created.text()
    expect(body).not.toContain('cle-tres-secrete')
    expect(JSON.parse(body)).toMatchObject({ name: 'Radarr', url: 'http://127.0.0.1:9', hasKey: true })
    const list = await (await fetch('/api/instances', { headers: { cookie } })).text()
    expect(list).not.toContain('cle-tres-secrete')
  })

  it('n\'envoie jamais la clé enregistrée vers une autre adresse', async () => {
    const other = await fetch('/api/instances/test', post({ id: 1, kind: 'radarr', url: 'http://10.0.0.99:7878' }, cookie))
    expect(other.status).toBe(400)
    expect((await other.json()).message).toBe('Clé API obligatoire pour une nouvelle adresse.')
    const kind = await fetch('/api/instances/test', post({ id: 1, kind: 'sonarr', url: 'http://127.0.0.1:9' }, cookie))
    expect(kind.status).toBe(400)
    const same = await fetch('/api/instances/test', post({ id: 1, kind: 'radarr', url: 'http://127.0.0.1:9' }, cookie))
    expect(same.status).toBe(200)
    const body = await same.json()
    expect(body.ok).toBe(false)
    expect(String(body.error)).not.toContain('cle-tres-secrete')
  })

  it('valide les entrées avec des messages en français', async () => {
    const res = await fetch('/api/instances', post({ kind: 'radarr', name: '', url: 'pas-une-url', apiKey: '' }, cookie))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.message).toBe('Données invalides.')
    expect(body.data.details.join(' ')).toContain('URL invalide')
  })

  it('interroge le catalogue vide et refuse un filtre invalide', async () => {
    const ok = await fetch('/api/catalog/query', post({ page: 1, pageSize: 10 }, cookie))
    expect(await ok.json()).toEqual({ rows: [], total: 0, totalSizeGb: 0 })
    const bad = await fetch('/api/catalog/query', post({ filter: { kind: 'cond', field: 'sizeGb', op: 'gt', value: 'x' } }, cookie))
    expect(bad.status).toBe(400)
    expect((await bad.json()).data.details).toEqual(['Taille : nombre attendu'])
  })

  it('renvoie les champs filtrables et le tableau de bord', async () => {
    const fields = await (await fetch('/api/catalog/fields', { headers: { cookie } })).json()
    expect(fields.fields.find((f: { key: string }) => f.key === 'instances').options).toEqual([{ value: '1', label: 'Radarr' }])
    const dash = await (await fetch('/api/dashboard', { headers: { cookie } })).json()
    expect(dash).toMatchObject({ movies: 0, series: 0, instances: [{ name: 'Radarr' }] })
  })
})
