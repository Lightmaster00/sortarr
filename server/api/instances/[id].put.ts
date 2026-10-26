import { instanceUpdateSchema } from '#shared/instances'
import { defineApiHandler, parseId, parseOrThrow } from '~~/server/lib/api'
import { updateInstance } from '~~/server/lib/instances'

export default defineApiHandler(async event => updateInstance(parseId(event), parseOrThrow(instanceUpdateSchema, await readBody(event))))
