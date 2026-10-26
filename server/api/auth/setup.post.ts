import { setupSchema } from '#shared/auth'
import { defineApiHandler, parseOrThrow } from '~~/server/lib/api'
import { createAdmin, createSession } from '~~/server/lib/auth'
import { setSessionCookie } from '~~/server/lib/sessionCookie'

export default defineApiHandler(async (event) => {
  const input = parseOrThrow(setupSchema, await readBody(event))
  await createAdmin(input.username, input.password)
  setSessionCookie(event, createSession())
  return { ok: true }
})
