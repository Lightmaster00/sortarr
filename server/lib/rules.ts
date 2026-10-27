import { validateFilter, type FilterGroup } from '#shared/filters'
import { referencedInstanceIds, ruleFilterProblems, ruleInputSchema, type RuleDto, type RuleInput, type RuleTemplate, type Severity } from '#shared/rules'
import { getDb, type Db } from './db'
import { AppError } from './errors'
import { registerDeletionGuard } from './instances'

interface Row { id: number; name: string; description: string; template: RuleTemplate; params: string; filter: string; severity: Severity; enabled: number; created_at: number; updated_at: number }

let version = 0
/** Change à chaque modification de règle : les signalements en cache sont alors recalculés. */
export function rulesVersion(): number {
  return version
}

function toDto(r: Row): RuleDto {
  return {
    id: r.id, name: r.name, description: r.description, template: r.template, params: JSON.parse(r.params) as Record<string, unknown>,
    filter: JSON.parse(r.filter) as FilterGroup, severity: r.severity, enabled: r.enabled === 1, createdAt: r.created_at, updatedAt: r.updated_at,
  }
}

function clean(input: RuleInput) {
  const parsed = ruleInputSchema.safeParse(input)
  if (!parsed.success) throw new AppError('Données invalides.', 400, parsed.error.issues.map(i => (i.path.length ? `${i.path.join('.')} : ${i.message}` : i.message)))
  const problems = [...ruleFilterProblems(parsed.data.filter), ...validateFilter(parsed.data.filter)]
  if (problems.length) throw new AppError('Filtre de la règle invalide.', 400, problems)
  return parsed.data
}

export function listRules(db: Db = getDb()): RuleDto[] {
  return (db.prepare('SELECT * FROM rules ORDER BY name COLLATE NOCASE').all() as Row[]).map(toDto)
}

export function getRule(id: number, db: Db = getDb()): RuleDto | null {
  const r = db.prepare('SELECT * FROM rules WHERE id = ?').get(id) as Row | undefined
  return r ? toDto(r) : null
}

export function createRule(input: RuleInput, db: Db = getDb(), now = Date.now()): RuleDto {
  const r = clean(input)
  const info = db.prepare('INSERT INTO rules (name, description, template, params, filter, severity, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(r.name, r.description, r.template, JSON.stringify(r.params), JSON.stringify(r.filter), r.severity, r.enabled ? 1 : 0, now, now)
  version++
  return getRule(Number(info.lastInsertRowid), db)!
}

export function updateRule(id: number, input: RuleInput, db: Db = getDb(), now = Date.now()): RuleDto {
  if (!getRule(id, db)) throw new AppError('Règle introuvable.', 404)
  const r = clean(input)
  db.prepare('UPDATE rules SET name = ?, description = ?, template = ?, params = ?, filter = ?, severity = ?, enabled = ?, updated_at = ? WHERE id = ?')
    .run(r.name, r.description, r.template, JSON.stringify(r.params), JSON.stringify(r.filter), r.severity, r.enabled ? 1 : 0, now, id)
  version++
  return getRule(id, db)!
}

export function setRuleEnabled(id: number, enabled: boolean, db: Db = getDb()): RuleDto {
  if (!getRule(id, db)) throw new AppError('Règle introuvable.', 404)
  db.prepare('UPDATE rules SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, id)
  version++
  return getRule(id, db)!
}

export function deleteRule(id: number, db: Db = getDb()): void {
  if (!getRule(id, db)) throw new AppError('Règle introuvable.', 404)
  db.transaction(() => {
    db.prepare('DELETE FROM rules WHERE id = ?').run(id)
    db.prepare('DELETE FROM exceptions WHERE source = ?').run(`rule:${id}`)
  })()
  version++
}

// Une instance citée par une règle ne peut pas être supprimée : la règle deviendrait fausse sans prévenir.
registerDeletionGuard((instanceId, db) => listRules(db)
  .filter(r => referencedInstanceIds(r.filter).includes(String(instanceId)))
  .map(r => `Règle « ${r.name} »`))
