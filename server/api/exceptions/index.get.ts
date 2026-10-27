import { defineApiHandler } from '~~/server/lib/api'
import { listExceptions } from '~~/server/lib/issues'

export default defineApiHandler(() => listExceptions())
