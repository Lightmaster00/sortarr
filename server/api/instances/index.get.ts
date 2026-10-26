import { defineApiHandler } from '~~/server/lib/api'
import { listInstances } from '~~/server/lib/instances'

export default defineApiHandler(() => listInstances())
