import { instanceCreateSchema } from '#shared/instances'
import { defineApiHandler, parseOrThrow } from '~~/server/lib/api'
import { createInstance } from '~~/server/lib/instances'

export default defineApiHandler(async event => createInstance(parseOrThrow(instanceCreateSchema, await readBody(event))))
