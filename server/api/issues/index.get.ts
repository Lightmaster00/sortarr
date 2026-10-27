import { defineApiHandler } from '~~/server/lib/api'
import { issuesSummary } from '~~/server/lib/issues'

export default defineApiHandler(() => issuesSummary())
