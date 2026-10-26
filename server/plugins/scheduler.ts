import { scheduleSync, schedulerEnabled, stopScheduler } from '../lib/scheduler'

export default defineNitroPlugin((nitro) => {
  if (!schedulerEnabled()) return
  scheduleSync()
  nitro.hooks.hook('close', () => stopScheduler())
})
