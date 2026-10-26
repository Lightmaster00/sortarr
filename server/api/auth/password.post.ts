import { passwordChangeSchema } from '#shared/auth'
import { defineApiHandler, parseOrThrow } from '~~/server/lib/api'
import { changePassword, createSession } from '~~/server/lib/auth'
import { setSessionCookie } from '~~/server/lib/sessionCookie'

export default defineApiHandler(async (event) => {
  const input = parseOrThrow(passwordChangeSchema, await readBody(event))
  await changePassword(input.current, input.next)
  setSessionCookie(event, createSession())
  return { ok: true }
})
