import { defineApiHandler, parseId } from '~~/server/lib/api'
import { AppError } from '~~/server/lib/errors'
import { getRule } from '~~/server/lib/rules'

export default defineApiHandler((event) => {
  const rule = getRule(parseId(event))
  if (!rule) throw new AppError('Règle introuvable.', 404)
  return rule
})
