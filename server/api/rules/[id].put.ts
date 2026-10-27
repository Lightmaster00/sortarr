import { defineApiHandler, parseId } from '~~/server/lib/api'
import { updateRule } from '~~/server/lib/rules'

export default defineApiHandler(async event => updateRule(parseId(event), await readBody(event)))
