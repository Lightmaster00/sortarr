export class HttpError extends Error {
  constructor(message: string, public readonly status: number | null, public readonly url: string) {
    super(message)
    this.name = 'HttpError'
  }
}

export interface HttpOptions {
  method?: string
  headers?: Record<string, string>
  body?: unknown
  timeoutMs?: number
  attempts?: number
  retryDelayMs?: number
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/** URL sans query string : les jetons ne finissent jamais dans un message ou un journal. */
function displayUrl(url: string): string {
  try {
    const u = new URL(url)
    u.search = ''
    u.username = ''
    u.password = ''
    return u.toString()
  } catch {
    return url.split('?')[0]!
  }
}

function networkReason(error: unknown, timeoutMs: number): string {
  const e = error as { name?: string; message?: string; cause?: { code?: string } }
  if (e?.name === 'TimeoutError') return `délai de ${timeoutMs / 1000} s dépassé`
  return e?.cause?.code ?? e?.message ?? 'erreur réseau'
}

export async function httpJson<T>(url: string, opts: HttpOptions = {}): Promise<T> {
  const attempts = opts.attempts ?? 3
  const delay = opts.retryDelayMs ?? 500
  const timeoutMs = opts.timeoutMs ?? 15_000
  const shown = displayUrl(url)
  let lastError: HttpError | null = null

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const canRetry = attempt < attempts
    let res: Response
    try {
      res = await fetch(url, {
        method: opts.method ?? 'GET',
        headers: {
          Accept: 'application/json',
          ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...opts.headers,
        },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (error) {
      lastError = new HttpError(`Service injoignable (${networkReason(error, timeoutMs)}) : ${shown}`, null, shown)
      if (canRetry) { await sleep(delay * 2 ** (attempt - 1)); continue }
      throw lastError
    }

    if (res.ok) {
      let text: string
      try {
        text = res.status === 204 ? '' : await res.text()
      } catch (error) {
        lastError = new HttpError(`Service injoignable (${networkReason(error, timeoutMs)}) : ${shown}`, null, shown)
        if (canRetry) { await sleep(delay * 2 ** (attempt - 1)); continue }
        throw lastError
      }
      if (!text) return undefined as T
      try {
        return JSON.parse(text) as T
      } catch {
        throw new HttpError(`Réponse non JSON : ${shown}`, res.status, shown)
      }
    }

    const snippet = (await res.text().catch(() => '')).slice(0, 200).trim()
    const message = res.status === 401 || res.status === 403
      ? `Accès refusé (HTTP ${res.status}) : vérifie la clé API.`
      : `HTTP ${res.status} sur ${shown}${snippet ? ` : ${snippet}` : ''}`
    lastError = new HttpError(message, res.status, shown)
    if (res.status >= 500 && canRetry) { await sleep(delay * 2 ** (attempt - 1)); continue }
    throw lastError
  }
  throw lastError ?? new HttpError(`Échec de la requête : ${shown}`, null, shown)
}

/** Télécharge une image (affiche) : une seule tentative, taille plafonnée, type vérifié. */
export async function httpImage(url: string, opts: { headers?: Record<string, string>; timeoutMs?: number; maxBytes?: number } = {}): Promise<{ type: string; data: Buffer }> {
  const shown = displayUrl(url)
  const timeoutMs = opts.timeoutMs ?? 10_000
  const maxBytes = opts.maxBytes ?? 5 * 1024 * 1024
  let res: Response
  try {
    res = await fetch(url, { headers: { Accept: 'image/*', ...opts.headers }, signal: AbortSignal.timeout(timeoutMs) })
  } catch (error) {
    throw new HttpError(`Service injoignable (${networkReason(error, timeoutMs)}) : ${shown}`, null, shown)
  }
  if (!res.ok) throw new HttpError(`HTTP ${res.status} sur ${shown}`, res.status, shown)
  const type = (res.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase()
  if (!/^image\/(jpeg|png|webp|gif)$/.test(type)) throw new HttpError(`Réponse qui n'est pas une image : ${shown}`, res.status, shown)
  const length = Number(res.headers.get('content-length') ?? 0)
  if (length > maxBytes) throw new HttpError(`Image trop lourde : ${shown}`, res.status, shown)
  const data = Buffer.from(await res.arrayBuffer())
  if (data.length > maxBytes) throw new HttpError(`Image trop lourde : ${shown}`, res.status, shown)
  return { type, data }
}
