import { defineApiHandler } from '~~/server/lib/api'
import { deleteSession } from '~~/server/lib/auth'
import { clearSessionCookie, readSessionId } from '~~/server/lib/sessionCookie'

export default defineApiHandler((event) => {
  deleteSession(readSessionId(event))
  clearSessionCookie(event)
  return { ok: true }
})
