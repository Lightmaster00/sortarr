import bcrypt from 'bcryptjs'
import crypto from 'node:crypto'
import { MIN_PASSWORD_LENGTH } from '#shared/auth'
import { getDb, type Db } from './db'
import { AppError } from './errors'

export const SESSION_COOKIE = 'sortarr_session'
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000
const ROUNDS = 10

// Comparé quand le compte n'existe pas : même durée qu'un mauvais mot de passe.
let dummyHash: string | null = null
function getDummyHash(): string {
  dummyHash ??= bcrypt.hashSync('sortarr-dummy-password', ROUNDS)
  return dummyHash
}

function checkPassword(password: string): void {
  if (password.length < MIN_PASSWORD_LENGTH) throw new AppError(`Le mot de passe doit faire au moins ${MIN_PASSWORD_LENGTH} caractères.`)
}

export function hasAdmin(db: Db = getDb()): boolean {
  return db.prepare('SELECT 1 FROM users WHERE id = 1').get() !== undefined
}

export async function createAdmin(username: string, password: string, db: Db = getDb()): Promise<void> {
  if (hasAdmin(db)) throw new AppError('Le compte admin existe déjà.', 409)
  const name = username.trim()
  if (!name) throw new AppError("Nom d'utilisateur obligatoire.")
  checkPassword(password)
  const hash = await bcrypt.hash(password, ROUNDS)
  try {
    db.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (1, ?, ?, ?)').run(name, hash, Date.now())
  } catch (error) {
    // Deux créations simultanées : la seconde bute sur la contrainte d'unicité de id = 1.
    if ((error as { code?: string }).code?.startsWith('SQLITE_CONSTRAINT')) throw new AppError('Le compte admin existe déjà.', 409)
    throw error
  }
}

export async function verifyCredentials(username: string, password: string, db: Db = getDb()): Promise<boolean> {
  const row = db.prepare('SELECT username, password_hash FROM users WHERE id = 1').get() as { username: string; password_hash: string } | undefined
  const ok = await bcrypt.compare(password, row?.password_hash ?? getDummyHash())
  return ok && row !== undefined && row.username === username.trim()
}

export function createSession(db: Db = getDb(), now = Date.now()): string {
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now)
  const id = crypto.randomBytes(32).toString('hex')
  db.prepare('INSERT INTO sessions (id, expires_at, created_at) VALUES (?, ?, ?)').run(id, now + SESSION_TTL_MS, now)
  return id
}

export function isValidSession(id: string | undefined, db: Db = getDb(), now = Date.now()): boolean {
  if (!id) return false
  const row = db.prepare('SELECT expires_at FROM sessions WHERE id = ?').get(id) as { expires_at: number } | undefined
  return row !== undefined && row.expires_at > now
}

export function deleteSession(id: string | undefined, db: Db = getDb()): void {
  if (id) db.prepare('DELETE FROM sessions WHERE id = ?').run(id)
}

/** Change le mot de passe et ferme toutes les sessions ouvertes. */
export async function changePassword(current: string, next: string, db: Db = getDb()): Promise<void> {
  const row = db.prepare('SELECT password_hash FROM users WHERE id = 1').get() as { password_hash: string } | undefined
  if (!row || !(await bcrypt.compare(current, row.password_hash))) throw new AppError('Mot de passe actuel incorrect.', 403)
  checkPassword(next)
  const hash = await bcrypt.hash(next, ROUNDS)
  db.transaction(() => {
    db.prepare('UPDATE users SET password_hash = ? WHERE id = 1').run(hash)
    db.prepare('DELETE FROM sessions').run()
  })()
}
