import { z } from 'zod'
import { defineApiHandler, parseOrThrow } from '~~/server/lib/api'
import { configDir, mediaRoot } from '~~/server/lib/config'
import { AppError } from '~~/server/lib/errors'
import { getSyncCron, isValidCron, nextSyncAt, scheduleSync, schedulerEnabled } from '~~/server/lib/scheduler'
import { setSetting } from '~~/server/lib/settings'

const schema = z.object({ cron: z.string().trim().min(1, 'Expression cron obligatoire') })

export default defineApiHandler(async (event) => {
  const { cron } = parseOrThrow(schema, await readBody(event))
  if (!isValidCron(cron)) throw new AppError('Expression cron invalide (ex : 0 * * * * pour toutes les heures).')
  setSetting('sync_cron', cron)
  if (schedulerEnabled()) scheduleSync()
  return { mediaRoot: mediaRoot(), configDir: configDir(), syncCron: getSyncCron(), nextSyncAt: nextSyncAt() }
})
