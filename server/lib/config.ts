import path from 'node:path'

/** Dossier des données de Sortarr (base SQLite, secret de chiffrement). /config dans Docker. */
export function configDir(): string {
  const value = process.env.SORTARR_CONFIG_DIR?.trim()
  return value ? path.resolve(value) : path.resolve(process.cwd(), 'config')
}

/** Racine des médias du NAS telle que montée dans le conteneur. */
export function mediaRoot(): string {
  const value = process.env.SORTARR_MEDIA_ROOT?.trim()
  return path.resolve(value || '/media')
}
