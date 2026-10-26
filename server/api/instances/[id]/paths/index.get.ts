import { defineApiHandler, parseId } from '~~/server/lib/api'
import { listMappings } from '~~/server/lib/paths'

export default defineApiHandler(event => listMappings(parseId(event)))
