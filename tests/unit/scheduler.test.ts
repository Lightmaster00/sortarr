import { describe, expect, it } from 'vitest'
import { DEFAULT_SYNC_CRON, getSyncCron, isValidCron } from '../../server/lib/scheduler'
import { setSetting } from '../../server/lib/settings'
import { useTestDb } from '../helpers/db'

useTestDb()

describe('scheduler', () => {
  it('valide les expressions cron', () => {
    expect(isValidCron('0 * * * *')).toBe(true)
    expect(isValidCron('0 */6 * * *')).toBe(true)
    expect(isValidCron('toutes les heures')).toBe(false)
    expect(isValidCron('0 0 * * * *')).toBe(false)
  })

  it('retombe sur le défaut si le cron enregistré est invalide', () => {
    setSetting('sync_cron', 'n\'importe quoi')
    expect(getSyncCron()).toBe(DEFAULT_SYNC_CRON)
  })

  it('lit le cron enregistré ou le défaut', () => {
    expect(getSyncCron()).toBe(DEFAULT_SYNC_CRON)
    setSetting('sync_cron', '0 4 * * *')
    expect(getSyncCron()).toBe('0 4 * * *')
  })
})
