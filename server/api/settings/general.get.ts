import { defineApiHandler } from '~~/server/lib/api'
import { configDir, mediaRoots } from '~~/server/lib/config'
import { getSyncCron, nextSyncAt } from '~~/server/lib/scheduler'

export default defineApiHandler(() => ({ mediaRoots: mediaRoots(), configDir: configDir(), syncCron: getSyncCron(), nextSyncAt: nextSyncAt() }))
