import { exceptionCreateSchema } from '#shared/rules'
import { defineApiHandler, parseOrThrow } from '~~/server/lib/api'
import { createException } from '~~/server/lib/issues'

export default defineApiHandler(async event => createException(parseOrThrow(exceptionCreateSchema, await readBody(event))))
