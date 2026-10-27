import { z } from 'zod'
import { defineApiHandler, parseId, parseOrThrow } from '~~/server/lib/api'
import { setRuleEnabled } from '~~/server/lib/rules'

export default defineApiHandler(async event => setRuleEnabled(parseId(event), parseOrThrow(z.object({ enabled: z.boolean() }), await readBody(event)).enabled))
