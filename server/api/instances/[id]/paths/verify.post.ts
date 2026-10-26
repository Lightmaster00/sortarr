import { defineApiHandler, parseId } from '~~/server/lib/api'
import { verifyInstancePaths } from '~~/server/lib/paths'

export default defineApiHandler(event => verifyInstancePaths(parseId(event)))
