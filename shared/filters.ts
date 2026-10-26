import { z } from 'zod'
import { fold } from './format'

export const FIELD_KEYS = [
  'type', 'title', 'year', 'originalLanguage', 'genres', 'ratingTmdb', 'ratingImdb', 'addedAt', 'sizeGb', 'resolution',
  'videoCodecs', 'audioLanguages', 'subtitleLanguages', 'isRemux', 'instances', 'servers', 'libraries', 'rootFolders', 'tags',
  'monitored', 'hasFile', 'neverWatched', 'lastWatchedAt', 'playCount',
] as const
export type FilterField = typeof FIELD_KEYS[number]

export type FieldType = 'string' | 'number' | 'date' | 'list' | 'boolean' | 'enum'

export interface CatalogRow {
  id: number
  type: 'movie' | 'series'
  title: string
  year: number | null
  originalLanguage: string | null
  genres: string[]
  ratingTmdb: number | null
  ratingImdb: number | null
  addedAt: number | null
  sizeGb: number
  resolution: number | null
  videoCodecs: string[]
  audioLanguages: string[]
  subtitleLanguages: string[]
  isRemux: boolean
  instances: string[]
  servers: string[]
  libraries: string[]
  rootFolders: string[]
  tags: string[]
  monitored: boolean
  hasFile: boolean
  neverWatched: boolean
  lastWatchedAt: number | null
  playCount: number
}

// Erreur de compilation si un champ filtrable manque dans CatalogRow.
type _RowHasEveryField = CatalogRow[FilterField]

export interface FieldDef {
  key: FilterField
  label: string
  type: FieldType
  options?: { value: string; label: string }[]
  dynamicOptions?: boolean
  unit?: string
}

export const FIELDS: FieldDef[] = [
  { key: 'type', label: 'Type', type: 'enum', options: [{ value: 'movie', label: 'Film' }, { value: 'series', label: 'Série' }] },
  { key: 'title', label: 'Titre', type: 'string' },
  { key: 'year', label: 'Année', type: 'number' },
  { key: 'originalLanguage', label: 'Langue originale', type: 'enum', dynamicOptions: true },
  { key: 'genres', label: 'Genres', type: 'list', dynamicOptions: true },
  { key: 'ratingTmdb', label: 'Note TMDB', type: 'number' },
  { key: 'ratingImdb', label: 'Note IMDb', type: 'number' },
  { key: 'addedAt', label: "Date d'ajout", type: 'date' },
  { key: 'sizeGb', label: 'Taille', type: 'number', unit: 'Go' },
  { key: 'resolution', label: 'Résolution (la plus basse)', type: 'number', options: [480, 720, 1080, 2160].map(r => ({ value: String(r), label: r === 2160 ? '4K' : `${r}p` })) },
  { key: 'videoCodecs', label: 'Codecs vidéo', type: 'list', dynamicOptions: true },
  { key: 'audioLanguages', label: 'Langues audio', type: 'list', dynamicOptions: true },
  { key: 'subtitleLanguages', label: 'Sous-titres', type: 'list', dynamicOptions: true },
  { key: 'isRemux', label: 'Remux', type: 'boolean' },
  { key: 'instances', label: 'Instance *arr', type: 'list', dynamicOptions: true },
  { key: 'servers', label: 'Serveur média', type: 'list', dynamicOptions: true },
  { key: 'libraries', label: 'Bibliothèque', type: 'list', dynamicOptions: true },
  { key: 'rootFolders', label: 'Dossier racine', type: 'list', dynamicOptions: true },
  { key: 'tags', label: 'Tags *arr', type: 'list', dynamicOptions: true },
  { key: 'monitored', label: 'Suivi', type: 'boolean' },
  { key: 'hasFile', label: 'A un fichier', type: 'boolean' },
  { key: 'neverWatched', label: 'Jamais vu', type: 'boolean' },
  { key: 'lastWatchedAt', label: 'Dernier visionnage', type: 'date' },
  { key: 'playCount', label: 'Nombre de lectures', type: 'number' },
]

export const FIELD_BY_KEY = Object.fromEntries(FIELDS.map(f => [f.key, f])) as Record<FilterField, FieldDef>

export const ALL_OPS = [
  'eq', 'neq', 'contains', 'not_contains', 'in', 'not_in', 'gt', 'gte', 'lt', 'lte', 'between',
  'older_than_days', 'newer_than_days', 'before', 'after', 'includes', 'excludes', 'includes_any', 'includes_all',
  'is_true', 'is_false', 'empty', 'not_empty',
] as const
export type Op = typeof ALL_OPS[number]
export type ValueKind = 'none' | 'single' | 'pair' | 'multi' | 'days' | 'date'

const EMPTY_OPS = (emptyLabel: string, notEmptyLabel: string) => [
  { op: 'empty' as const, label: emptyLabel, value: 'none' as const },
  { op: 'not_empty' as const, label: notEmptyLabel, value: 'none' as const },
]

export const OPERATORS: Record<FieldType, { op: Op; label: string; value: ValueKind }[]> = {
  string: [
    { op: 'contains', label: 'contient', value: 'single' },
    { op: 'not_contains', label: 'ne contient pas', value: 'single' },
    { op: 'eq', label: 'est', value: 'single' },
    { op: 'neq', label: "n'est pas", value: 'single' },
    ...EMPTY_OPS('est vide', "n'est pas vide"),
  ],
  enum: [
    { op: 'eq', label: 'est', value: 'single' },
    { op: 'neq', label: "n'est pas", value: 'single' },
    { op: 'in', label: 'est parmi', value: 'multi' },
    { op: 'not_in', label: "n'est pas parmi", value: 'multi' },
    ...EMPTY_OPS('est inconnu', 'est connu'),
  ],
  number: [
    { op: 'gt', label: '>', value: 'single' },
    { op: 'gte', label: '≥', value: 'single' },
    { op: 'lt', label: '<', value: 'single' },
    { op: 'lte', label: '≤', value: 'single' },
    { op: 'eq', label: '=', value: 'single' },
    { op: 'neq', label: '≠', value: 'single' },
    { op: 'between', label: 'entre', value: 'pair' },
    ...EMPTY_OPS('est inconnu', 'est connu'),
  ],
  date: [
    { op: 'older_than_days', label: 'il y a plus de', value: 'days' },
    { op: 'newer_than_days', label: 'il y a moins de', value: 'days' },
    { op: 'before', label: 'avant le', value: 'date' },
    { op: 'after', label: 'après le', value: 'date' },
    ...EMPTY_OPS('jamais / inconnue', 'renseignée'),
  ],
  list: [
    { op: 'includes', label: 'contient', value: 'single' },
    { op: 'excludes', label: 'ne contient pas', value: 'single' },
    { op: 'includes_any', label: 'contient au moins un de', value: 'multi' },
    { op: 'includes_all', label: 'contient tous', value: 'multi' },
    ...EMPTY_OPS('est vide', "n'est pas vide"),
  ],
  boolean: [
    { op: 'is_true', label: 'oui', value: 'none' },
    { op: 'is_false', label: 'non', value: 'none' },
  ],
}

export type FilterValue = string | number | boolean | (string | number)[] | null | undefined
export interface FilterCondition { kind: 'cond'; field: FilterField; op: Op; value?: FilterValue }
export interface FilterGroup { kind: 'group'; mode: 'and' | 'or'; children: FilterNode[] }
export type FilterNode = FilterCondition | FilterGroup

const valueSchema = z.union([z.string(), z.number(), z.boolean(), z.array(z.union([z.string(), z.number()])), z.null()]).optional()

export const filterNodeSchema: z.ZodType<FilterNode> = z.lazy(() => z.union([
  z.object({ kind: z.literal('cond'), field: z.enum(FIELD_KEYS), op: z.enum(ALL_OPS), value: valueSchema }),
  z.object({ kind: z.literal('group'), mode: z.enum(['and', 'or']), children: z.array(filterNodeSchema).max(50) }),
]))

export function emptyFilter(): FilterGroup {
  return { kind: 'group', mode: 'and', children: [] }
}

const MAX_DEPTH = 5

const isFiniteNumber = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)
const isNonBlankString = (x: unknown): x is string => typeof x === 'string' && x.trim() !== ''

// Date calendaire stricte « AAAA-MM-JJ », sans débordement (ex. 2026-02-30 refusé).
function isIsoDate(x: unknown): x is string {
  if (typeof x !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(x)) return false
  const t = Date.parse(x)
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === x
}

export function validateFilter(node: FilterNode, depth = 0): string[] {
  if (node.kind === 'group') {
    if (depth >= MAX_DEPTH) return [`Filtre trop imbriqué (${MAX_DEPTH} niveaux maximum)`]
    return node.children.flatMap(c => validateFilter(c, depth + 1))
  }
  if (!Object.hasOwn(FIELD_BY_KEY, node.field)) return [`Champ inconnu : ${node.field}`]
  const field = FIELD_BY_KEY[node.field]
  const def = OPERATORS[field.type].find(o => o.op === node.op)
  if (!def) return [`${field.label} : opérateur « ${node.op} » non disponible`]
  const v = node.value
  switch (def.value) {
    case 'none':
      return []
    case 'single':
      if (field.type === 'number') return isFiniteNumber(v) ? [] : [`${field.label} : nombre attendu`]
      return isNonBlankString(v) ? [] : [`${field.label} : valeur attendue`]
    case 'pair':
      return Array.isArray(v) && v.length === 2 && v.every(isFiniteNumber) ? [] : [`${field.label} : deux nombres attendus`]
    case 'multi': {
      if (!Array.isArray(v) || v.length === 0) return [`${field.label} : choisis au moins une valeur`]
      const valid = v.every(x => field.type === 'number' ? isFiniteNumber(x) : isNonBlankString(x))
      return valid ? [] : [`${field.label} : valeurs invalides`]
    }
    case 'days':
      return isFiniteNumber(v) && v >= 0 ? [] : [`${field.label} : nombre de jours attendu`]
    case 'date':
      return isIsoDate(v) ? [] : [`${field.label} : date invalide`]
  }
}

const DAY_MS = 86_400_000

function asList(value: FilterValue): string[] {
  return (Array.isArray(value) ? value : [value]).map(fold)
}

// Appelée uniquement sur une condition déjà validée par validateFilter.
function matchCondition(row: CatalogRow, c: FilterCondition, now: number): boolean {
  const field = FIELD_BY_KEY[c.field]
  const raw = row[c.field] as unknown
  const isEmpty = raw === null || raw === undefined || raw === '' || (Array.isArray(raw) && raw.length === 0)
  if (c.op === 'empty') return isEmpty
  if (c.op === 'not_empty') return !isEmpty
  // Une valeur absente ne satisfait que « est vide / inconnu » : aucune négation n'est vraie.
  if (isEmpty) return false

  switch (field.type) {
    case 'string':
    case 'enum': {
      const value = fold(raw)
      if (c.op === 'eq') return value === fold(c.value)
      if (c.op === 'neq') return value !== fold(c.value)
      if (c.op === 'contains') return value.includes(fold(c.value))
      if (c.op === 'not_contains') return !value.includes(fold(c.value))
      if (c.op === 'in') return asList(c.value).includes(value)
      if (c.op === 'not_in') return !asList(c.value).includes(value)
      return false
    }
    case 'number': {
      if (typeof raw !== 'number') return false
      if (c.op === 'between') {
        const [a, b] = c.value as [number, number]
        return raw >= Math.min(a, b) && raw <= Math.max(a, b)
      }
      const v = c.value as number
      if (c.op === 'eq') return raw === v
      if (c.op === 'neq') return raw !== v
      if (c.op === 'gt') return raw > v
      if (c.op === 'gte') return raw >= v
      if (c.op === 'lt') return raw < v
      if (c.op === 'lte') return raw <= v
      return false
    }
    case 'date': {
      if (typeof raw !== 'number') return false
      // Date.parse d'une date « AAAA-MM-JJ » donne minuit UTC : bornes en jours UTC.
      if (c.op === 'older_than_days') return raw < now - (c.value as number) * DAY_MS
      if (c.op === 'newer_than_days') return raw >= now - (c.value as number) * DAY_MS
      if (c.op === 'before') return raw < Date.parse(c.value as string)
      if (c.op === 'after') return raw >= Date.parse(c.value as string) + DAY_MS
      return false
    }
    case 'list': {
      const values = (raw as string[]).map(fold)
      if (c.op === 'includes') return values.includes(fold(c.value))
      if (c.op === 'excludes') return values.length > 0 && !values.includes(fold(c.value))
      if (c.op === 'includes_any') return asList(c.value).some(v => values.includes(v))
      if (c.op === 'includes_all') return asList(c.value).every(v => values.includes(v))
      return false
    }
    case 'boolean':
      if (c.op === 'is_true') return raw === true
      if (c.op === 'is_false') return raw === false
      return false
  }
}

export function matches(row: CatalogRow, node: FilterNode, now: number = Date.now()): boolean {
  if (node.kind === 'group') {
    if (node.children.length === 0) return true
    return node.mode === 'and'
      ? node.children.every(c => matches(row, c, now))
      : node.children.some(c => matches(row, c, now))
  }
  // Ferme en cas d'échec : champ inconnu, opérateur ou valeur incompatibles ne sélectionnent rien.
  if (validateFilter(node).length > 0) return false
  return matchCondition(row, node, now)
}

export function defaultValue(field: FieldDef, kind: ValueKind): FilterValue {
  switch (kind) {
    case 'none': return undefined
    case 'single': return field.type === 'number' ? Number(field.options?.[0]?.value ?? 0) : (field.options?.[0]?.value ?? '')
    case 'pair': return [0, 0]
    case 'multi': return []
    case 'days': return 30
    case 'date': return new Date().toISOString().slice(0, 10)
  }
}

export function defaultCondition(field: FieldDef): FilterCondition {
  const first = OPERATORS[field.type][0]!
  return { kind: 'cond', field: field.key, op: first.op, value: defaultValue(field, first.value) }
}
