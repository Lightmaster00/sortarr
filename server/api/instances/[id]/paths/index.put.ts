import { mappingsPutSchema } from '#shared/paths'
import { defineApiHandler, parseId, parseOrThrow } from '~~/server/lib/api'
import { AppError } from '~~/server/lib/errors'
import { getInstance } from '~~/server/lib/instances'
import { replaceMappings } from '~~/server/lib/paths'

export default defineApiHandler(async (event) => {
  const id = parseId(event)
  if (!getInstance(id)) throw new AppError('Instance introuvable.', 404)
  const { mappings } = parseOrThrow(mappingsPutSchema, await readBody(event))
  return replaceMappings(id, mappings)
})
