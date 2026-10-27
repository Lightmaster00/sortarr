import { matches, type CatalogRow } from '#shared/filters'
import { isArrKind, type InstanceDto, type InstanceKind } from '#shared/instances'
import { SEVERITIES, usesWatchFields, type ExceptionDto, type IssueGroupDto, type IssueItemsResult, type IssuesSummary, type Severity } from '#shared/rules'
import { fold } from '#shared/format'
import { catalogVersion, loadCatalogRows, totalSizeGb } from './catalog'
import { getDb, type Db } from './db'
import { AppError } from './errors'
import { listInstances } from './instances'
import { listRules, rulesVersion } from './rules'

interface CheckContext { kindOf: Map<string, InstanceKind>; freshServers: string[] }

interface Check {
  key: string
  title: string
  description: string
  severity: Severity
  icon: string
  /** Contrôle impossible sans ces données (ex. aucun serveur synchronisé). */
  needs?: (ctx: CheckContext) => string | null
  test: (row: CatalogRow, ctx: CheckContext) => boolean
}

const needsServer = (ctx: CheckContext) => (ctx.freshServers.length ? null : 'Ajoute et synchronise Plex ou Jellyfin pour ce contrôle.')

/** Contrôles intégrés, toujours actifs. */
export const CHECKS: Check[] = [
  {
    key: 'orphelin-serveur',
    title: 'Sur Plex/Jellyfin, sans Radarr/Sonarr',
    description: 'Visibles sur un serveur média, mais aucun Radarr ni Sonarr ne les gère : ils ne seront ni mis à jour ni surveillés.',
    severity: 'avertissement',
    icon: 'i-lucide-unlink',
    test: r => r.instances.length === 0 && r.servers.length > 0,
  },
  {
    key: 'doublon',
    title: 'En double dans deux gestionnaires',
    description: 'Le même titre est géré par deux Radarr (ou deux Sonarr) : il occupe probablement deux fois la place.',
    severity: 'erreur',
    icon: 'i-lucide-copy',
    test: (r, ctx) => {
      const kinds = r.instances.map(id => ctx.kindOf.get(id))
      return kinds.filter(k => k === 'radarr').length > 1 || kinds.filter(k => k === 'sonarr').length > 1
    },
  },
  {
    key: 'absent-serveurs',
    title: 'Téléchargés mais invisibles',
    description: 'Le fichier existe, mais le titre n\'apparaît ni sur Plex ni sur Jellyfin (bibliothèque manquante ou pas encore analysée).',
    severity: 'avertissement',
    icon: 'i-lucide-monitor-off',
    needs: needsServer,
    test: r => r.hasFile && r.instances.length > 0 && r.servers.length === 0,
  },
  {
    key: 'sans-fichier',
    title: 'Suivis sans fichier',
    description: 'Radarr ou Sonarr les surveille, mais aucun fichier n\'a encore été téléchargé.',
    severity: 'info',
    icon: 'i-lucide-file-x',
    test: r => r.instances.length > 0 && r.monitored && !r.hasFile,
  },
  {
    key: 'ecart-serveurs',
    title: 'Sur un seul serveur',
    description: 'Présents sur Plex ou sur Jellyfin, mais pas sur les deux.',
    severity: 'info',
    icon: 'i-lucide-split',
    needs: ctx => (ctx.freshServers.length >= 2 ? null : 'Il faut deux serveurs synchronisés (Plex et Jellyfin) pour comparer.'),
    test: (r, ctx) => r.servers.length > 0 && ctx.freshServers.some(id => !r.servers.includes(id)),
  },
]

let exceptionsVersionValue = 0
export function bumpExceptions(): void {
  exceptionsVersionValue++
}

interface Computed { groups: IssueGroupDto[]; rowsByKey: Map<string, CatalogRow[]> }
let cache: { stamp: string; value: Computed } | null = null

function contextOf(instances: InstanceDto[]): CheckContext {
  const kindOf = new Map(instances.map(i => [String(i.id), i.kind]))
  const freshServers = instances.filter(i => i.enabled && !isArrKind(i.kind) && i.lastSyncAt !== null && !i.stale).map(i => String(i.id))
  return { kindOf, freshServers }
}

function excludedKeys(db: Db): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>()
  for (const e of db.prepare('SELECT source, item_key FROM exceptions').all() as { source: string; item_key: string }[]) {
    if (!out.has(e.source)) out.set(e.source, new Set())
    out.get(e.source)!.add(e.item_key)
  }
  return out
}

function compute(db: Db, now: number): Computed {
  const instances = listInstances(db)
  const stamp = `${catalogVersion()}:${rulesVersion()}:${exceptionsVersionValue}:${instances.map(i => `${i.id}${i.enabled ? 1 : 0}${i.stale ? 1 : 0}${i.lastSyncAt ?? 0}`).join(',')}`
  // Les règles de date (« il y a plus de N jours ») bougent avec le temps : le cache expire au bout d'une heure.
  const hour = Math.floor(now / 3_600_000)
  if (cache && cache.stamp === `${stamp}:${hour}`) return cache.value

  const rows = loadCatalogRows(db)
  const ctx = contextOf(instances)
  const keyOf = new Map((db.prepare('SELECT id, item_key FROM items').all() as { id: number; item_key: string }[]).map(r => [r.id, r.item_key]))
  const excluded = excludedKeys(db)
  const keep = (source: string) => {
    const skip = excluded.get(source)
    return (r: CatalogRow) => !skip || !skip.has(keyOf.get(r.id) ?? '')
  }

  const groups: IssueGroupDto[] = []
  const rowsByKey = new Map<string, CatalogRow[]>()
  const add = (group: Omit<IssueGroupDto, 'count' | 'sizeGb'>, matched: CatalogRow[]) => {
    rowsByKey.set(group.key, matched)
    groups.push({ ...group, count: matched.length, sizeGb: totalSizeGb(matched) })
  }

  for (const c of CHECKS) {
    const key = `check:${c.key}`
    const unavailable = c.needs?.(ctx) ?? undefined
    const base = { key, kind: 'check' as const, title: c.title, description: c.description, severity: c.severity, icon: c.icon }
    add(unavailable ? { ...base, unavailable } : base, unavailable ? [] : rows.filter(r => c.test(r, ctx)).filter(keep(key)))
  }

  for (const rule of listRules(db).filter(r => r.enabled)) {
    const key = `rule:${rule.id}`
    const unavailable = usesWatchFields(rule.filter) && !ctx.freshServers.length
      ? 'Cette règle parle de visionnage : il faut au moins un Plex ou Jellyfin synchronisé.'
      : undefined
    const base = { key, kind: 'rule' as const, ruleId: rule.id, title: rule.name, description: rule.description, severity: rule.severity, icon: 'i-lucide-list-checks' }
    add(unavailable ? { ...base, unavailable } : base, unavailable ? [] : rows.filter(r => matches(r, rule.filter, now)).filter(keep(key)))
  }

  const value = { groups, rowsByKey }
  cache = { stamp: `${stamp}:${hour}`, value }
  return value
}

const SEVERITY_ORDER: Record<Severity, number> = { erreur: 0, avertissement: 1, info: 2 }

export function issuesSummary(db: Db = getDb(), now = Date.now()): IssuesSummary {
  const { groups, rowsByKey } = compute(db, now)
  const bySeverity = Object.fromEntries(SEVERITIES.map(s => [s, 0])) as Record<Severity, number>
  const items = new Set<number>()
  for (const g of groups) {
    bySeverity[g.severity] += g.count
    for (const r of rowsByKey.get(g.key) ?? []) items.add(r.id)
  }
  const sorted = [...groups].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || b.count - a.count)
  return { groups: sorted, bySeverity, items: items.size }
}

export function issueItems(input: { key: string; search?: string; page: number; pageSize: number }, db: Db = getDb(), now = Date.now()): IssueItemsResult {
  const { groups, rowsByKey } = compute(db, now)
  const group = groups.find(g => g.key === input.key)
  if (!group) throw new AppError('Signalement introuvable.', 404)
  const search = input.search ? fold(input.search) : null
  // Les plus gros d'abord : c'est là qu'il y a le plus à gagner.
  const rows = (rowsByKey.get(group.key) ?? []).filter(r => !search || fold(r.title).includes(search)).sort((a, b) => b.sizeGb - a.sizeGb || a.title.localeCompare(b.title, 'fr'))
  const start = (input.page - 1) * input.pageSize
  return { group, rows: rows.slice(start, start + input.pageSize), total: rows.length, totalSizeGb: totalSizeGb(rows) }
}

/** Les signalements qui concernent un titre (pour sa fiche). */
export function issuesOfItem(itemId: number, db: Db = getDb(), now = Date.now()): IssueGroupDto[] {
  const { groups, rowsByKey } = compute(db, now)
  return groups.filter(g => (rowsByKey.get(g.key) ?? []).some(r => r.id === itemId))
}

// ── Exceptions (« Ignorer ») ────────────────────────────────────────────────

function sourceTitle(source: string, db: Db): string {
  if (source.startsWith('check:')) return CHECKS.find(c => `check:${c.key}` === source)?.title ?? source
  const id = Number(source.slice(5))
  return (db.prepare('SELECT name FROM rules WHERE id = ?').get(id) as { name: string } | undefined)?.name ?? 'Règle supprimée'
}

export function listExceptions(db: Db = getDb()): ExceptionDto[] {
  const rows = db.prepare(`SELECT e.*, i.id AS item_id FROM exceptions e LEFT JOIN items i ON i.item_key = e.item_key ORDER BY e.created_at DESC`).all() as
    { id: number; source: string; item_key: string; title: string; reason: string; created_at: number; item_id: number | null }[]
  return rows.map(r => ({ id: r.id, source: r.source, sourceTitle: sourceTitle(r.source, db), itemKey: r.item_key, itemId: r.item_id, title: r.title, reason: r.reason, createdAt: r.created_at }))
}

export function createException(input: { source: string; itemId: number; reason: string }, db: Db = getDb(), now = Date.now()): ExceptionDto {
  const item = db.prepare('SELECT item_key, title FROM items WHERE id = ?').get(input.itemId) as { item_key: string; title: string } | undefined
  if (!item) throw new AppError('Titre introuvable.', 404)
  const known = input.source.startsWith('check:')
    ? CHECKS.some(c => `check:${c.key}` === input.source)
    : !!db.prepare('SELECT 1 FROM rules WHERE id = ?').get(Number(input.source.slice(5)))
  if (!known) throw new AppError('Signalement introuvable.', 404)
  db.prepare(`INSERT INTO exceptions (source, item_key, title, reason, created_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(source, item_key) DO UPDATE SET reason = excluded.reason`).run(input.source, item.item_key, item.title, input.reason, now)
  bumpExceptions()
  return listExceptions(db).find(e => e.source === input.source && e.itemKey === item.item_key)!
}

export function deleteException(id: number, db: Db = getDb()): void {
  if (db.prepare('DELETE FROM exceptions WHERE id = ?').run(id).changes === 0) throw new AppError('Exception introuvable.', 404)
  bumpExceptions()
}

export function resetIssuesCacheForTests(): void {
  cache = null
}
