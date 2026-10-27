import { issueItemsQuerySchema } from '#shared/rules'
import { defineApiHandler, parseOrThrow } from '~~/server/lib/api'
import { issueItems } from '~~/server/lib/issues'

export default defineApiHandler(async event => issueItems(parseOrThrow(issueItemsQuerySchema, await readBody(event))))
