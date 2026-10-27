import { defineApiHandler, parseId } from '~~/server/lib/api'
import { deleteRule } from '~~/server/lib/rules'

export default defineApiHandler((event) => {
  deleteRule(parseId(event))
  return { ok: true }
})
