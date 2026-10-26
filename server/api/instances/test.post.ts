import { instanceTestSchema, type TestResult } from '#shared/instances'
import { defineApiHandler, parseOrThrow } from '~~/server/lib/api'
import { discover } from '~~/server/lib/discovery'
import { AppError } from '~~/server/lib/errors'
import { getInstanceSecret, setInstanceStatus } from '~~/server/lib/instances'

export default defineApiHandler(async (event): Promise<TestResult> => {
  const input = parseOrThrow(instanceTestSchema, await readBody(event))
  const saved = input.id ? getInstanceSecret(input.id) : null
  if (!input.apiKey && saved && (input.url !== saved.url || input.kind !== saved.kind)) {
    throw new AppError('Clé API obligatoire pour une nouvelle adresse.')
  }
  const apiKey = input.apiKey ?? saved?.apiKey
  if (!apiKey) throw new AppError('Clé API obligatoire.')
  // Le statut enregistré ne change que si l'on teste la configuration enregistrée.
  const testsSaved = saved !== null && saved.url === input.url && saved.kind === input.kind && (!input.apiKey || input.apiKey === saved.apiKey)
  try {
    const discovery = await discover({ kind: input.kind, url: input.url, apiKey })
    if (testsSaved && saved) setInstanceStatus(saved.id, { status: 'ok', error: null, version: discovery.version })
    return { ok: true, discovery }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (testsSaved && saved) setInstanceStatus(saved.id, { status: 'erreur', error: message })
    return { ok: false, error: message }
  }
})
