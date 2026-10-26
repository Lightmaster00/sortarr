import { loginSchema } from '#shared/auth'
import { defineApiHandler, parseOrThrow } from '~~/server/lib/api'
import { createSession, deleteSession, hasAdmin, verifyCredentials } from '~~/server/lib/auth'
import { AppError } from '~~/server/lib/errors'
import { readSessionId, setSessionCookie } from '~~/server/lib/sessionCookie'

export default defineApiHandler(async (event) => {
  const input = parseOrThrow(loginSchema, await readBody(event))
  if (!hasAdmin()) throw new AppError("Aucun compte n'existe encore.", 409)
  if (!(await verifyCredentials(input.username, input.password))) throw new AppError('Identifiants incorrects.', 401)
  deleteSession(readSessionId(event)) // pas de fixation de session : l'ancienne ne survit pas à la connexion
  setSessionCookie(event, createSession())
  return { ok: true }
})
