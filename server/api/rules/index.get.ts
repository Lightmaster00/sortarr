import { defineApiHandler } from '~~/server/lib/api'
import { issuesSummary } from '~~/server/lib/issues'
import { listRules } from '~~/server/lib/rules'

/** Les règles, avec le nombre de titres signalés par chacune (règles actives seulement). */
export default defineApiHandler(() => {
  const groups = new Map(issuesSummary().groups.filter(g => g.ruleId !== undefined).map(g => [g.ruleId!, g]))
  return listRules().map(r => ({ ...r, count: groups.get(r.id)?.count ?? null, sizeGb: groups.get(r.id)?.sizeGb ?? null, unavailable: groups.get(r.id)?.unavailable ?? null }))
})
