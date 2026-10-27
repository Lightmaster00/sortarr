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

/** Explication en clair des pannes réseau les plus courantes (Docker, Unraid, HTTPS). */
export function networkHint(error: unknown, url: string): string {
  const e = error as { name?: string; cause?: { code?: string } }
  const code = e?.cause?.code ?? ''
  let host = ''
  try { host = new URL(url).hostname } catch { /* adresse illisible */ }
  if (/^(localhost|127\.|::1|\[::1\])/.test(host)) {
    return 'Dans Docker, « localhost » désigne Sortarr lui-même : mets l\'adresse IP du serveur (ex. http://192.168.1.10:32400).'
  }
  if (/CERT|TLS|SSL|SELF_SIGNED|UNABLE_TO_VERIFY|ALTNAME/i.test(code)) {
    return 'Certificat HTTPS refusé : utilise plutôt http:// avec l\'adresse IP et le port (ex. http://192.168.1.10:32400).'
  }
  if (code === 'ECONNREFUSED') return 'Rien n\'écoute à cette adresse : vérifie l\'IP et le port, et que le service est démarré.'
  if (code === 'EHOSTUNREACH' || code === 'ENETUNREACH' || code === 'ETIMEDOUT' || e?.name === 'TimeoutError') {
    return 'Machine inaccessible depuis Sortarr. Sur Unraid, si Sortarr ou ce service a sa propre IP (réseau br0), active « Host access to custom networks » dans Réglages › Docker, ou mets les deux conteneurs sur le réseau bridge.'
  }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'Nom de machine inconnu : utilise plutôt l\'adresse IP.'
  return ''
}

function unreachable(error: unknown, timeoutMs: number, url: string, shown: string): HttpError {
  const hint = networkHint(error, url)
  return new HttpError(`Service injoignable (${networkReason(error, timeoutMs)}) : ${shown}${hint ? ` — ${hint}` : ''}`, null, shown)
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
      lastError = unreachable(error, timeoutMs, url, shown)
      if (canRetry) { await sleep(delay * 2 ** (attempt - 1)); continue }
      throw lastError
    }

    if (res.ok) {
      let text: string
      try {
        text = res.status === 204 ? '' : await res.text()
      } catch (error) {
        lastError = unreachable(error, timeoutMs, url, shown)
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
    throw unreachable(error, timeoutMs, url, shown)
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
