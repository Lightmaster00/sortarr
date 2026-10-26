import { createError, defineEventHandler, getHeader, getRequestURL } from 'h3'
import { isValidSession } from '../lib/auth'
import { readSessionId } from '../lib/sessionCookie'

const PUBLIC = new Set(['/api/health', '/api/auth/status', '/api/auth/login', '/api/auth/setup'])
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

export default defineEventHandler((event) => {
  // Le routeur Nitro compare le chemin décodé : on contrôle donc le même chemin.
  let path: string
  try {
    path = decodeURIComponent(getRequestURL(event).pathname).replace(/\/{2,}/g, '/').replace(/\/+$/, '')
  } catch {
    throw createError({ statusCode: 400, statusMessage: 'Bad Request', message: 'Chemin invalide.' })
  }
  if (!path.startsWith('/api/')) return
  // Un formulaire d'un autre site ne peut pas ajouter d'en-tête personnalisé : protection CSRF.
  if (MUTATING.has(event.method) && getHeader(event, 'x-sortarr') !== '1') {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden', message: 'En-tête x-sortarr manquant.' })
  }
  if (PUBLIC.has(path)) return
  if (!isValidSession(readSessionId(event))) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized', message: 'Connexion requise.' })
  }
})
