import { vi } from 'vitest'

type Handler = unknown | ((url: URL, init?: RequestInit) => unknown)

/** Remplace fetch : chaque route renvoie du JSON (ou une Response). Route absente → 404. */
export function mockFetch(routes: Record<string, Handler>) {
  const calls: { url: URL; init?: RequestInit }[] = []
  const fn = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    calls.push({ url, init })
    const handler = routes[url.pathname + url.search] ?? routes[url.pathname]
    if (handler === undefined) return new Response('not found', { status: 404 })
    const body = typeof handler === 'function' ? (handler as (u: URL, i?: RequestInit) => unknown)(url, init) : handler
    if (body instanceof Response) return body
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  })
  vi.stubGlobal('fetch', fn)
  return { fn, calls }
}

export function headerOf(init: RequestInit | undefined, name: string): string | undefined {
  const headers = (init?.headers ?? {}) as Record<string, string>
  const key = Object.keys(headers).find(k => k.toLowerCase() === name.toLowerCase())
  return key ? headers[key] : undefined
}
