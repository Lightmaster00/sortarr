import { catalogQuerySchema } from '#shared/catalog'
import { defineApiHandler, parseOrThrow } from '~~/server/lib/api'
import { queryCatalog } from '~~/server/lib/catalog'

export default defineApiHandler(async event => queryCatalog(parseOrThrow(catalogQuerySchema, await readBody(event))))
