import { fold } from './format'

const LANGUAGE_CODES: Record<string, string> = {
  en: 'en', eng: 'en', english: 'en', anglais: 'en',
  fr: 'fr', fre: 'fr', fra: 'fr', french: 'fr', francais: 'fr',
  ja: 'ja', jpn: 'ja', japanese: 'ja', japonais: 'ja',
  de: 'de', ger: 'de', deu: 'de', german: 'de', allemand: 'de',
  es: 'es', spa: 'es', spanish: 'es', espagnol: 'es',
  it: 'it', ita: 'it', italian: 'it', italien: 'it',
  ko: 'ko', kor: 'ko', korean: 'ko', coreen: 'ko',
  zh: 'zh', chi: 'zh', zho: 'zh', chinese: 'zh', mandarin: 'zh', cantonese: 'zh', chinois: 'zh',
  pt: 'pt', por: 'pt', portuguese: 'pt', 'portuguese (brazil)': 'pt', portugais: 'pt',
  ru: 'ru', rus: 'ru', russian: 'ru', russe: 'ru',
  nl: 'nl', dut: 'nl', nld: 'nl', dutch: 'nl', flemish: 'nl', neerlandais: 'nl',
  sv: 'sv', swe: 'sv', swedish: 'sv',
  no: 'no', nor: 'no', nob: 'no', norwegian: 'no',
  da: 'da', dan: 'da', danish: 'da',
  fi: 'fi', fin: 'fi', finnish: 'fi',
  pl: 'pl', pol: 'pl', polish: 'pl',
  tr: 'tr', tur: 'tr', turkish: 'tr',
  ar: 'ar', ara: 'ar', arabic: 'ar',
  hi: 'hi', hin: 'hi', hindi: 'hi',
  th: 'th', tha: 'th', thai: 'th',
  he: 'he', heb: 'he', hebrew: 'he',
  cs: 'cs', cze: 'cs', ces: 'cs', czech: 'cs',
  hu: 'hu', hun: 'hu', hungarian: 'hu',
  uk: 'uk', ukr: 'uk', ukrainian: 'uk',
  vi: 'vi', vie: 'vi', vietnamese: 'vi',
  id: 'id', ind: 'id', indonesian: 'id',
  el: 'el', gre: 'el', ell: 'el', greek: 'el',
  ro: 'ro', rum: 'ro', ron: 'ro', romanian: 'ro',
  ta: 'ta', tam: 'ta', tamil: 'ta',
  te: 'te', tel: 'te', telugu: 'te',
}

const LANGUAGE_LABELS: Record<string, string> = {
  en: 'Anglais', fr: 'Français', ja: 'Japonais', de: 'Allemand', es: 'Espagnol', it: 'Italien', ko: 'Coréen',
  zh: 'Chinois', pt: 'Portugais', ru: 'Russe', nl: 'Néerlandais', sv: 'Suédois', no: 'Norvégien', da: 'Danois',
  fi: 'Finnois', pl: 'Polonais', tr: 'Turc', ar: 'Arabe', hi: 'Hindi', th: 'Thaï', he: 'Hébreu', cs: 'Tchèque',
  hu: 'Hongrois', uk: 'Ukrainien', vi: 'Vietnamien', id: 'Indonésien', el: 'Grec', ro: 'Roumain', ta: 'Tamoul', te: 'Télougou',
}

const UNKNOWN_LANGUAGES = new Set(['', 'und', 'unknown', 'any', 'original', 'mul', 'zxx', 'n/a'])

export function normalizeLanguage(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const key = fold(raw)
  if (UNKNOWN_LANGUAGES.has(key)) return null
  return LANGUAGE_CODES[key] ?? key
}

export function parseLanguageList(raw: unknown): string[] {
  const parts = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/\s*[/,|]\s*/) : []
  const codes = parts.map(normalizeLanguage).filter((c): c is string => c !== null)
  return [...new Set(codes)]
}

export function languageLabel(code: string): string {
  return LANGUAGE_LABELS[code] ?? code
}

export const RESOLUTIONS = [480, 720, 1080, 2160] as const

function fromHeight(h: number): number | null {
  if (!(h > 0)) return null
  return h >= 1600 ? 2160 : h >= 900 ? 1080 : h >= 600 ? 720 : 480
}

function fromWidth(w: number): number | null {
  if (!(w > 0)) return null
  return w >= 3200 ? 2160 : w >= 1700 ? 1080 : w >= 1100 ? 720 : 480
}

export function normalizeResolution(raw: unknown): number | null {
  if (typeof raw === 'number') return fromHeight(raw)
  if (typeof raw !== 'string') return null
  // La largeur compte : un film en 2.39:1 encodé en 1920x800 est bien du 1080p.
  // On garde la plus haute des deux estimations (1440x1080 est du 1080p).
  const size = raw.match(/^\s*(\d+)\s*x\s*(\d+)\s*$/i)
  if (size) return Math.max(fromWidth(Number(size[1])) ?? 0, fromHeight(Number(size[2])) ?? 0) || null
  if (/^\s*\d{3,4}\s*$/.test(raw)) return fromHeight(Number(raw))
  const p = raw.match(/(\d{3,4})\s*[pi]\b/i)
  if (p) return fromHeight(Number(p[1]))
  if (/\b(4k|uhd)\b/i.test(raw)) return 2160
  return null
}

export function resolutionLabel(resolution: number | null): string {
  if (resolution === null) return '—'
  return resolution === 2160 ? '4K' : `${resolution}p`
}

export function normalizeCodec(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null
  const v = raw.toLowerCase()
  if (/265|hevc/.test(v)) return 'hevc'
  if (/264|avc/.test(v)) return 'h264'
  if (/av1/.test(v)) return 'av1'
  if (/vc-?1/.test(v)) return 'vc1'
  if (/mpeg-?2/.test(v)) return 'mpeg2'
  if (/xvid|divx|mpeg-?4/.test(v)) return 'mpeg4'
  return v.trim()
}

export function parseRuntime(raw: unknown): number | null {
  if (typeof raw !== 'string') return null
  const m = raw.trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{2})(?:\.\d+)?$/)
  if (!m) return null
  return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3])
}
