import { defineApiHandler } from '~~/server/lib/api'
import { startSync } from '~~/server/lib/sync/runner'

export default defineApiHandler(() => {
  void startSync()
  return { started: true }
})
