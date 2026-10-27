import { defineApiHandler, parseId } from '~~/server/lib/api'
import { deleteException } from '~~/server/lib/issues'

export default defineApiHandler((event) => {
  deleteException(parseId(event))
  return { ok: true }
})
