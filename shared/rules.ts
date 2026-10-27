import { z } from 'zod'
import { filterNodeSchema, type CatalogRow, type FilterGroup, type FilterNode } from './filters'

export const SEVERITIES = ['erreur', 'avertissement', 'info'] as const
export type Severity = typeof SEVERITIES[number]

export const SEVERITY_LABELS: Record<Severity, string> = { erreur: 'Important', avertissement: 'À vérifier', info: 'Pour info' }
export const SEVERITY_COLORS: Record<Severity, 'error' | 'warning' | 'info'> = { erreur: 'error', avertissement: 'warning', info: 'info' }
export const SEVERITY_ICONS: Record<Severity, string> = { erreur: 'i-lucide-octagon-alert', avertissement: 'i-lucide-triangle-alert', info: 'i-lucide-info' }

export const RULE_TEMPLATES = ['rangement', 'qualite', 'menage', 'personnalise'] as const
export type RuleTemplate = typeof RULE_TEMPLATES[number]

const filterGroupSchema = filterNodeSchema.refine((n): n is FilterGroup => n.kind === 'group', 'Le filtre doit être un groupe.')

export const ruleInputSchema = z.object({
  name: z.string().trim().min(1, 'Nom obligatoire').max(80, '80 caractères maximum'),
  description: z.string().trim().max(500).default(''),
  template: z.enum(RULE_TEMPLATES),
  params: z.record(z.string(), z.unknown()).default({}),
  filter: filterGroupSchema,
  severity: z.enum(SEVERITIES).default('avertissement'),
  enabled: z.boolean().default(true),
})
export type RuleInput = z.input<typeof ruleInputSchema>

export interface RuleDto {
  id: number
  name: string
  description: string
  template: RuleTemplate
  params: Record<string, unknown>
  filter: FilterGroup
  severity: Severity
  enabled: boolean
  createdAt: number
  updatedAt: number
}

/** Une règle n'a de sens qu'avec au moins une condition, et sans groupe vide (un groupe vide correspond à tout). */
export function ruleFilterProblems(filter: FilterNode): string[] {
  if (filter.kind === 'cond') return []
  if (filter.children.length === 0) return ['Ajoute au moins une condition (un groupe vide correspond à tout le catalogue).']
  return filter.children.flatMap(ruleFilterProblems).slice(0, 1)
}

const WATCH_FIELDS = new Set(['neverWatched', 'lastWatchedAt', 'playCount'])

/** Le filtre parle-t-il de visionnage ? (il faut alors au moins un serveur synchronisé pour qu'il ait un sens). */
export function usesWatchFields(filter: FilterNode): boolean {
  return filter.kind === 'cond' ? WATCH_FIELDS.has(filter.field) : filter.children.some(usesWatchFields)
}

/** Les identifiants d'instance cités par le filtre (champs « Instance *arr » et « Serveur média »). */
export function referencedInstanceIds(filter: FilterNode): string[] {
  if (filter.kind === 'group') return [...new Set(filter.children.flatMap(referencedInstanceIds))]
  if (filter.field !== 'instances' && filter.field !== 'servers') return []
  const v = filter.value
  return (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]).map(String)
}

// ── Signalements ────────────────────────────────────────────────────────────

export interface IssueGroupDto {
  /** « check:<contrôle> » ou « rule:<id> ». */
  key: string
  kind: 'check' | 'rule'
  ruleId?: number
  title: string
  description: string
  severity: Severity
  icon: string
  count: number
  sizeGb: number
  /** La règle ne peut pas être évaluée (ex. visionnage sans serveur synchronisé). */
  unavailable?: string
}

export interface IssuesSummary {
  groups: IssueGroupDto[]
  bySeverity: Record<Severity, number>
  /** Titres distincts concernés par au moins un signalement. */
  items: number
}

export interface IssueItemsResult { group: IssueGroupDto; rows: CatalogRow[]; total: number; totalSizeGb: number }

export const issueItemsQuerySchema = z.object({
  key: z.string().min(1).max(40),
  search: z.string().trim().max(200).optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(200).default(48),
})

export interface ExceptionDto { id: number; source: string; sourceTitle: string; itemKey: string; itemId: number | null; title: string; reason: string; createdAt: number }

export const exceptionCreateSchema = z.object({
  source: z.string().regex(/^(check:[a-z-]+|rule:\d+)$/, 'Source invalide'),
  itemId: z.number().int().positive(),
  reason: z.string().trim().max(300).default(''),
})
