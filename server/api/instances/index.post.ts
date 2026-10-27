import { instanceCreateSchema } from '#shared/instances'
import { defineApiHandler, parseOrThrow } from '~~/server/lib/api'
import { createInstance, getInstance } from '~~/server/lib/instances'
import { autoConfigurePaths } from '~~/server/lib/paths'

export default defineApiHandler(async (event) => {
  const created = createInstance(parseOrThrow(instanceCreateSchema, await readBody(event)))
  // Les chemins se règlent seuls quand c'est possible ; un échec ici n'empêche pas l'ajout.
  try {
    await autoConfigurePaths(created.id)
  } catch (error) {
    console.warn(`Sortarr : détection des chemins impossible pour ${created.name}`, error instanceof Error ? error.message : error)
  }
  return getInstance(created.id)!
})
