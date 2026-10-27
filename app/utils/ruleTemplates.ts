import type { FilterCondition, FilterGroup, FilterNode } from '#shared/filters'
import type { RuleTemplate, Severity } from '#shared/rules'

export type MediaType = 'movie' | 'series' | 'all'

export interface RangementParams { mediaType: MediaType; langMode: 'in' | 'not_in'; languages: string[]; instanceId: string; mode: 'doit' | 'interdit' }
export interface QualiteParams { instances: string[]; minResolution: number; audio: string[]; subtitles: string[] }
export interface MenageParams { mediaType: MediaType; neverWatched: boolean; addedOlderThanDays: number | null; maxRating: number | null; minSizeGb: number | null; notWatchedForDays: number | null }

export interface TemplateInfo {
  key: RuleTemplate
  label: string
  icon: string
  pitch: string
  example: string
  severity: Severity
}

export const TEMPLATES: TemplateInfo[] = [
  { key: 'rangement', label: 'Rangement', icon: 'i-lucide-folder-input', pitch: 'Vérifie que chaque titre est dans la bonne instance.', example: 'Les films en anglais doivent être dans Radarr VO.', severity: 'avertissement' },
  { key: 'qualite', label: 'Qualité minimale', icon: 'i-lucide-badge-check', pitch: 'Signale les fichiers sous ton niveau d\'exigence.', example: 'Au moins 1080p, avec l\'audio français.', severity: 'avertissement' },
  { key: 'menage', label: 'Ménage', icon: 'i-lucide-brush-cleaning', pitch: 'Repère ce qui prend de la place pour rien.', example: 'Jamais vus, ajoutés il y a plus d\'un an.', severity: 'info' },
  { key: 'personnalise', label: 'Sur mesure', icon: 'i-lucide-sliders-horizontal', pitch: 'Combine librement toutes les conditions du catalogue.', example: 'Remux de plus de 50 Go sans sous-titres.', severity: 'avertissement' },
]
export const TEMPLATE_BY_KEY = Object.fromEntries(TEMPLATES.map(t => [t.key, t])) as Record<RuleTemplate, TemplateInfo>

export const RESOLUTIONS = [
  { value: 720, label: '720p' },
  { value: 1080, label: '1080p' },
  { value: 2160, label: '4K' },
]

export function defaultParams(template: RuleTemplate): Record<string, unknown> {
  switch (template) {
    case 'rangement': return { mediaType: 'movie', langMode: 'in', languages: ['en'], instanceId: '', mode: 'doit' } satisfies RangementParams
    case 'qualite': return { instances: [], minResolution: 1080, audio: [], subtitles: [] } satisfies QualiteParams
    case 'menage': return { mediaType: 'all', neverWatched: true, addedOlderThanDays: 365, maxRating: null, minSizeGb: null, notWatchedForDays: null } satisfies MenageParams
    case 'personnalise': return {}
  }
}

const cond = (field: FilterCondition['field'], op: FilterCondition['op'], value?: FilterCondition['value']): FilterCondition => ({ kind: 'cond', field, op, value })
const and = (children: FilterNode[]): FilterGroup => ({ kind: 'group', mode: 'and', children })
const or = (children: FilterNode[]): FilterGroup => ({ kind: 'group', mode: 'or', children })
const typeCond = (t: MediaType) => (t === 'all' ? [] : [cond('type', 'eq', t)])

/** Traduit les réglages simples d'un modèle en filtre du catalogue. `null` = réglages incomplets. */
export function buildFilter(template: RuleTemplate, params: Record<string, unknown>, custom: FilterGroup): FilterGroup | null {
  if (template === 'personnalise') return custom
  if (template === 'rangement') {
    const p = params as unknown as RangementParams
    if (!p.instanceId) return null
    return and([
      ...typeCond(p.mediaType),
      ...(p.languages.length ? [cond('originalLanguage', p.langMode, p.languages)] : []),
      // Un titre sans gestionnaire relève du contrôle « orphelins », pas du rangement.
      cond('instances', 'not_empty'),
      cond('instances', p.mode === 'doit' ? 'excludes' : 'includes', p.instanceId),
    ])
  }
  if (template === 'qualite') {
    const p = params as unknown as QualiteParams
    const problems: FilterNode[] = [
      ...(p.minResolution ? [cond('resolution', 'lt', p.minResolution)] : []),
      ...p.audio.map(l => cond('audioLanguages', 'excludes', l)),
      ...p.subtitles.map(l => cond('subtitleLanguages', 'excludes', l)),
    ]
    if (!problems.length) return null
    return and([
      cond('hasFile', 'is_true'),
      ...(p.instances.length ? [cond('instances', 'includes_any', p.instances)] : []),
      problems.length === 1 ? problems[0]! : or(problems),
    ])
  }
  const p = params as unknown as MenageParams
  const criteria: FilterNode[] = [
    ...(p.neverWatched ? [cond('neverWatched', 'is_true')] : []),
    ...(p.notWatchedForDays ? [or([cond('lastWatchedAt', 'older_than_days', p.notWatchedForDays), cond('neverWatched', 'is_true')])] : []),
    ...(p.addedOlderThanDays ? [cond('addedAt', 'older_than_days', p.addedOlderThanDays)] : []),
    ...(p.maxRating !== null && p.maxRating !== undefined ? [cond('rating', 'lt', p.maxRating)] : []),
    ...(p.minSizeGb ? [cond('sizeGb', 'gte', p.minSizeGb)] : []),
  ]
  if (!criteria.length) return null
  return and([...typeCond(p.mediaType), cond('hasFile', 'is_true'), ...criteria])
}

/** Un nom proposé, en français courant, à partir des réglages. */
export function suggestName(template: RuleTemplate, params: Record<string, unknown>, labels: { language: (c: string) => string; instance: (id: string) => string }): string {
  const what = (t: MediaType) => (t === 'movie' ? 'Films' : t === 'series' ? 'Séries' : 'Titres')
  if (template === 'rangement') {
    const p = params as unknown as RangementParams
    const langs = p.languages.map(labels.language).join(', ').toLowerCase()
    const scope = langs ? `${what(p.mediaType)} ${p.langMode === 'in' ? 'en' : 'hors'} ${langs}` : what(p.mediaType)
    return p.instanceId ? `${scope} ${p.mode === 'doit' ? '→' : 'hors de'} ${labels.instance(p.instanceId)}` : scope
  }
  if (template === 'qualite') {
    const p = params as unknown as QualiteParams
    const parts = [p.minResolution ? `${RESOLUTIONS.find(r => r.value === p.minResolution)?.label ?? p.minResolution} minimum` : '', p.audio.length ? `audio ${p.audio.map(labels.language).join('/').toLowerCase()}` : ''].filter(Boolean)
    return `Qualité : ${parts.join(', ') || 'à préciser'}`
  }
  if (template === 'menage') {
    const p = params as unknown as MenageParams
    const parts = [p.neverWatched ? 'jamais vus' : '', p.addedOlderThanDays ? `ajoutés il y a plus de ${p.addedOlderThanDays} j` : '', p.maxRating !== null && p.maxRating !== undefined ? `notés sous ${p.maxRating}` : ''].filter(Boolean)
    return `${what(p.mediaType)} ${parts.join(', ') || 'à trier'}`
  }
  return 'Nouvelle règle'
}
