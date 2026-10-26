import { describe, expect, it, vi } from 'vitest'
import { HttpError, httpJson } from '../../server/lib/http'
import { mapLimit } from '../../server/lib/concurrency'
import { toHttpError } from '../../server/lib/api'
import { mockFetch } from '../helpers/fetch'

const fast = { retryDelayMs: 1 }

describe('httpJson', () => {
  it('renvoie le JSON décodé', async () => {
    mockFetch({ '/ok': { a: 1 } })
    expect(await httpJson('http://svc/ok', fast)).toEqual({ a: 1 })
  })

  it('réessaie sur 503 puis réussit', async () => {
    let n = 0
    const { fn } = mockFetch({ '/flaky': () => (++n === 1 ? new Response('busy', { status: 503 }) : { ok: true }) })
    expect(await httpJson('http://svc/flaky', fast)).toEqual({ ok: true })
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('ne réessaie pas sur 404', async () => {
    const { fn } = mockFetch({})
    await expect(httpJson('http://svc/absent', fast)).rejects.toMatchObject({ status: 404 })
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('explique un 401', async () => {
    const { fn } = mockFetch({ '/secure': new Response('no', { status: 401 }) })
    await expect(httpJson('http://svc/secure', fast)).rejects.toThrow('Accès refusé (HTTP 401) : vérifie la clé API.')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('réessaie quand la lecture du corps échoue (délai) puis échoue en HttpError', async () => {
    const fn = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => { throw Object.assign(new Error('aborted'), { name: 'TimeoutError' }) },
    }) as unknown as Response)
    vi.stubGlobal('fetch', fn)
    const error = await httpJson('http://svc/body', fast).catch(e => e)
    expect(error).toBeInstanceOf(HttpError)
    expect(error.message).toContain('délai de')
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it("fait 3 tentatives sur erreur réseau puis échoue", async () => {
    const fn = vi.fn(async () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }) })
    vi.stubGlobal('fetch', fn)
    const error = await httpJson('http://svc/down', fast).catch(e => e)
    expect(error).toBeInstanceOf(HttpError)
    expect(error.message).toContain('Service injoignable (ECONNREFUSED)')
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it("n'écrit jamais la query string dans l'erreur", async () => {
    mockFetch({})
    const error = await httpJson('http://svc/x?X-Plex-Token=secret123', fast).catch(e => e)
    expect(error.message).not.toContain('secret123')
  })

  it('envoie le corps en JSON', async () => {
    const { calls } = mockFetch({ '/post': { done: true } })
    await httpJson('http://svc/post', { ...fast, method: 'POST', body: { x: 1 } })
    expect(calls[0]!.init!.body).toBe('{"x":1}')
  })
})

describe('mapLimit', () => {
  it('respecte la limite et conserve l\'ordre', async () => {
    let active = 0
    let peak = 0
    const out = await mapLimit([1, 2, 3, 4, 5, 6], 2, async (n) => {
      active++
      peak = Math.max(peak, active)
      await new Promise(r => setTimeout(r, 5))
      active--
      return n * 10
    })
    expect(out).toEqual([10, 20, 30, 40, 50, 60])
    expect(peak).toBe(2)
  })

  it('accepte une liste vide', async () => {
    expect(await mapLimit([], 4, async x => x)).toEqual([])
  })
})

describe('toHttpError', () => {
  it('convertit HttpError en 502', () => {
    const error = toHttpError(new HttpError('x', 503, 'http://svc/')) as { statusCode: number; message: string }
    expect(error.statusCode).toBe(502)
    expect(error.message).toBe('x')
  })
})
