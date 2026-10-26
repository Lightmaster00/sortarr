export function formatSize(gb: number): string {
  if (!Number.isFinite(gb)) return '—'
  if (gb >= 1024) return `${(gb / 1024).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} To`
  return `${gb.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Go`
}

export function formatDate(ts: number | null): string {
  if (ts === null) return '—'
  return new Date(ts).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' })
}

export function formatDateTime(ts: number | null): string {
  if (ts === null) return '—'
  return new Date(ts).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'short', timeStyle: 'short' })
}

/** Forme comparable d'un texte : sans accents, apostrophe typographique normalisée, en minuscules. */
export function fold(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\u2019/g, "'")
    .toLowerCase()
    .trim()
}

/** Retire les « / » finaux d'un chemin (la racine reste « / »). */
export function trimTrailingSlash(p: string): string {
  return p.replace(/\/+$/, '') || '/'
}
