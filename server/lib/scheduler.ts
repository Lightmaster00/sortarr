import { Cron } from 'croner'
import { getSetting } from './settings'
import { startSync } from './sync/runner'

export const DEFAULT_SYNC_CRON = '0 * * * *'

let job: Cron | null = null

export function schedulerEnabled(): boolean {
  return process.env.SORTARR_DISABLE_SCHEDULER !== '1'
}

export function isValidCron(expr: string): boolean {
  if (expr.trim().split(/\s+/).length !== 5) return false
  try {
    new Cron(expr, { paused: true }).stop()
    return true
  } catch {
    return false
  }
}

export function getSyncCron(): string {
  const stored = getSetting('sync_cron')
  return stored && isValidCron(stored) ? stored : DEFAULT_SYNC_CRON
}

/** (Re)programme la synchro selon le cron enregistré. */
export function scheduleSync(run: () => unknown = () => startSync()): void {
  job?.stop()
  const stored = getSetting('sync_cron')
  const expr = getSyncCron()
  if (stored && stored !== expr) console.warn(`Sortarr : cron de synchro invalide (${stored}), retour à ${DEFAULT_SYNC_CRON}`)
  job = new Cron(expr, { protect: true, timezone: process.env.TZ || undefined }, () => { void run() })
}

export function stopScheduler(): void {
  job?.stop()
  job = null
}

export function nextSyncAt(): number | null {
  return job?.nextRun()?.getTime() ?? null
}
