import { defineApiHandler } from '~~/server/lib/api'
import { createRule } from '~~/server/lib/rules'

export default defineApiHandler(async event => createRule(await readBody(event)))
