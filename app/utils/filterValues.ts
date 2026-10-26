import type { FieldType, FilterValue, ValueKind } from '#shared/filters'

// Nombre fini ou null : une saisie vidée ou invalide ne devient jamais 0.
function toNumber(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

// Convertit une saisie brute de l'éditeur en valeur de filtre ; null signale une saisie invalide.
export function toFilterValue(kind: ValueKind, fieldType: FieldType, raw: unknown): FilterValue {
  switch (kind) {
    case 'none':
      return undefined
    case 'single':
      return fieldType === 'number' ? toNumber(raw) : String(raw ?? '')
    case 'pair': {
      const pair = Array.isArray(raw) ? raw : []
      return [toNumber(pair[0]), toNumber(pair[1])] as unknown as FilterValue
    }
    case 'multi': {
      const items = Array.isArray(raw) ? raw.map(v => String(v).trim()).filter(Boolean) : []
      return fieldType === 'number' ? items.map(Number).filter(Number.isFinite) : items
    }
    case 'days':
      return toNumber(raw)
    case 'date':
      return String(raw ?? '')
  }
}
