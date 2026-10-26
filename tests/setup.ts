import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Chaque fichier de test a ses propres dossiers temporaires : jamais ./config ni le vrai /media.
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sortarr-test-'))
process.env.SORTARR_CONFIG_DIR = path.join(root, 'config')
process.env.SORTARR_MEDIA_ROOT = path.join(root, 'media')
process.env.SORTARR_DISABLE_SCHEDULER = '1'
fs.mkdirSync(process.env.SORTARR_MEDIA_ROOT, { recursive: true })
process.on('exit', () => {
  try { fs.rmSync(root, { recursive: true, force: true }) } catch {}
})
