import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import { getDb, openDatabase, setDbForTests } from '../../server/lib/db'
import { migrate, MIGRATIONS, SCHEMA_VERSION } from '../../server/lib/schema'
import { getSetting, setSetting } from '../../server/lib/settings'
import { configDir } from '../../server/lib/config'
import { useTestDb } from '../helpers/db'

const db = useTestDb()

describe('schéma', () => {
  it('crée toutes les tables et fixe user_version', () => {
    const tables = (db().prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[]).map(t => t.name)
    expect(tables).toEqual(expect.arrayContaining([
      'settings', 'users', 'sessions', 'instances', 'path_mappings', 'items', 'files', 'presences', 'watch_history', 'disk_entries',
    ]))
    expect(db().pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION)
  })

  it('est idempotent', () => {
    expect(() => migrate(db())).not.toThrow()
    expect(db().pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION)
  })

  it('monte une base v1 au schéma courant', () => {
    const old = new Database(':memory:')
    old.exec(MIGRATIONS[0]!)
    old.pragma('user_version = 1')
    old.prepare("INSERT INTO instances (kind, name, url, api_key_enc, created_at) VALUES ('radarr', 'R', 'http://r', 'x', 0)").run()
    migrate(old)
    expect(old.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION)
    expect(old.prepare('SELECT last_sync_ok FROM instances').get()).toEqual({ last_sync_ok: null })
    const cols = (old.prepare('PRAGMA table_info(presences)').all() as { name: string }[]).map(c => c.name)
    expect(cols).toContain('added_at')
    old.close()
  })

  it('refuse une base créée par une version plus récente', () => {
    db().pragma(`user_version = ${SCHEMA_VERSION + 1}`)
    expect(() => migrate(db())).toThrow(`Base créée par une version plus récente de Sortarr (schéma ${SCHEMA_VERSION + 1} > ${SCHEMA_VERSION}).`)
  })

  it('active les clés étrangères (suppression en cascade)', () => {
    db().prepare("INSERT INTO instances (kind, name, url, api_key_enc, created_at) VALUES ('radarr', 'R', 'http://r', 'x', 0)").run()
    db().prepare("INSERT INTO path_mappings (instance_id, service_path, real_path) VALUES (1, '/movies', '/media/movies')").run()
    db().prepare('DELETE FROM instances WHERE id = 1').run()
    expect(db().prepare('SELECT COUNT(*) AS n FROM path_mappings').get()).toEqual({ n: 0 })
  })
})

describe('réglages', () => {
  it('lit, écrit et remplace une valeur', () => {
    expect(getSetting('sync_cron')).toBeNull()
    setSetting('sync_cron', '0 * * * *')
    setSetting('sync_cron', '0 4 * * *')
    expect(getSetting('sync_cron')).toBe('0 4 * * *')
  })
})

describe('getDb', () => {
  it('ouvre sortarr.db dans le dossier de config', () => {
    setDbForTests(null)
    const real = getDb()
    expect(fs.existsSync(path.join(configDir(), 'sortarr.db'))).toBe(true)
    real.close()
    setDbForTests(openDatabase(':memory:'))
  })
})
