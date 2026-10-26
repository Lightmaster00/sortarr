import { defineApiHandler } from '~~/server/lib/api'
import { configDir, mediaRoot } from '~~/server/lib/config'
import { getSyncCron, nextSyncAt } from '~~/server/lib/scheduler'

export default defineApiHandler(() => ({ mediaRoot: mediaRoot(), configDir: configDir(), syncCron: getSyncCron(), nextSyncAt: nextSyncAt() }))
