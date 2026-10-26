import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { configDir } from './config'

const IV_BYTES = 12
const TAG_BYTES = 16

let cachedKey: Buffer | null = null

function parseKey(file: string, hex: string): Buffer {
  const key = Buffer.from(hex.trim(), 'hex')
  if (key.length !== 32) throw new Error(`Fichier ${file} invalide : 64 caractères hexadécimaux attendus.`)
  return key
}

function masterKey(): Buffer {
  if (cachedKey) return cachedKey
  const dir = configDir()
  const file = path.join(dir, 'secret')
  let key: Buffer
  if (fs.existsSync(file)) {
    key = parseKey(file, fs.readFileSync(file, 'utf8'))
  } else {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
    const generated = crypto.randomBytes(32)
    try {
      fs.writeFileSync(file, generated.toString('hex'), { mode: 0o600, flag: 'wx' })
      key = generated
    } catch (error) {
      // Un autre processus a créé la clé entre-temps : on lit la sienne.
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      key = parseKey(file, fs.readFileSync(file, 'utf8'))
    }
  }
  cachedKey = key
  return key
}

/** Tests uniquement : oublie la clé en mémoire, comme un redémarrage. */
export function resetSecretCacheForTests(): void {
  cachedKey = null
}

export function encrypt(plain: string): string {
  const iv = crypto.randomBytes(IV_BYTES)
  const cipher = crypto.createCipheriv('aes-256-gcm', masterKey(), iv, { authTagLength: TAG_BYTES })
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join(':')
}

export function decrypt(token: string): string {
  const [version, iv, tag, data] = token.split(':')
  if (version !== 'v1' || !iv || !tag || data === undefined) throw new Error('Secret chiffré illisible.')
  const ivBuf = Buffer.from(iv, 'base64')
  const tagBuf = Buffer.from(tag, 'base64')
  if (ivBuf.length !== IV_BYTES || tagBuf.length !== TAG_BYTES) throw new Error('Secret chiffré illisible.')
  const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey(), ivBuf, { authTagLength: TAG_BYTES })
  decipher.setAuthTag(tagBuf)
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8')
}
