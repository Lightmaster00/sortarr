import { defineApiHandler } from '~~/server/lib/api'
import { fieldOptions } from '~~/server/lib/catalog'

export default defineApiHandler(() => ({ fields: fieldOptions() }))
