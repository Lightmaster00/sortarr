import { defineApiHandler, parseId } from '~~/server/lib/api'
import { invalidateCatalog } from '~~/server/lib/catalog'
import { getDb } from '~~/server/lib/db'
import { deleteInstance } from '~~/server/lib/instances'
import { pruneItems } from '~~/server/lib/sync/store'

export default defineApiHandler((event) => {
  deleteInstance(parseId(event))
  // Ici plutôt que dans lib/instances.ts : importer sync/store ou catalog depuis instances créerait un cycle.
  pruneItems(getDb())
  invalidateCatalog()
  return { ok: true }
})
