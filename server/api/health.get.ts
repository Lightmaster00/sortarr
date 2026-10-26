import { getDb } from '~~/server/lib/db'

export default defineEventHandler((event) => {
  try {
    getDb().prepare('SELECT 1').get()
    return { ok: true }
  } catch {
    setResponseStatus(event, 503)
    return { ok: false }
  }
})
