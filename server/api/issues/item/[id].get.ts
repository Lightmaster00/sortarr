import { defineApiHandler, parseId } from '~~/server/lib/api'
import { issuesOfItem } from '~~/server/lib/issues'

export default defineApiHandler(event => issuesOfItem(parseId(event)))
