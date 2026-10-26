import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import { configDir } from './config'
import { migrate } from './schema'

export type Db = Database.Database

let instance: Db | null = null

/** Ouvre (et migre) une base SQLite. ':memory:' pour les tests. */
export function openDatabase(file: string): Db {
  const db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 5000')
  migrate(db)
  return db
}

/** La base de l'application : <configDir>/sortarr.db, ouverte au premier appel. */
export function getDb(): Db {
  if (instance?.open) return instance
  const dir = configDir()
  fs.mkdirSync(dir, { recursive: true })
  instance = openDatabase(path.join(dir, 'sortarr.db'))
  return instance
}

/** Tests uniquement : remplace la base renvoyée par getDb(). */
export function setDbForTests(db: Db | null): void {
  instance = db
}
