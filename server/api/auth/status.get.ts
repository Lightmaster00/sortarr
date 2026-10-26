import { defineApiHandler } from '~~/server/lib/api'
import { hasAdmin, isValidSession } from '~~/server/lib/auth'
import { readSessionId } from '~~/server/lib/sessionCookie'

export default defineApiHandler(event => ({
  hasAdmin: hasAdmin(),
  authenticated: isValidSession(readSessionId(event)),
}))
