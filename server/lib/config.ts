import fs from 'node:fs'
import path from 'node:path'

/** Dossier des données de Sortarr (base SQLite, secret de chiffrement). /config dans Docker. */
export function configDir(): string {
  const value = process.env.SORTARR_CONFIG_DIR?.trim()
  return value ? path.resolve(value) : path.resolve(process.cwd(), 'config')
}

/** Dossiers montés par Docker qui ne sont jamais des médias. */
const SYSTEM_DIRS = ['/proc', '/sys', '/dev', '/run', '/etc', '/usr', '/app', '/tmp', '/var', '/lib', '/bin', '/sbin', '/opt', '/root']
const VIRTUAL_FS = new Set(['proc', 'sysfs', 'devpts', 'tmpfs', 'mqueue', 'cgroup', 'cgroup2', 'overlay', 'devtmpfs', 'securityfs', 'debugfs', 'tracefs', 'fusectl', 'hugetlbfs', 'pstore', 'bpf', 'nsfs', 'autofs', 'configfs', 'binfmt_misc'])

const under = (child: string, parent: string) => child === parent || child.startsWith(`${parent}/`)

/** Décode les espaces et caractères spéciaux de /proc/self/mountinfo (« \040 » = espace). */
const unescapeMount = (p: string) => p.replace(/\\([0-7]{3})/g, (_, oct: string) => String.fromCharCode(Number.parseInt(oct, 8)))

/** Points de montage d'un fichier mountinfo qui ressemblent à des dossiers de médias. */
export function mediaMountsFrom(mountinfo: string, exclude: string[] = []): string[] {
  const out: string[] = []
  for (const line of mountinfo.split('\n')) {
    const [left, right] = line.split(' - ')
    if (!left || !right) continue
    const mountPoint = unescapeMount(left.split(' ')[4] ?? '')
    const fsType = right.split(' ')[0] ?? ''
    if (!mountPoint.startsWith('/') || mountPoint === '/' || VIRTUAL_FS.has(fsType)) continue
    if (SYSTEM_DIRS.some(d => under(mountPoint, d)) || exclude.some(d => under(mountPoint, d))) continue
    out.push(mountPoint)
  }
  return out
}

function detectedMounts(): string[] {
  // Activé dans l'image Docker : chaque dossier ajouté au conteneur est trouvé sans réglage.
  if (process.env.SORTARR_DETECT_MOUNTS !== 'true') return []
  try {
    return mediaMountsFrom(fs.readFileSync('/proc/self/mountinfo', 'utf8'), [configDir()])
      .filter((p) => { try { return fs.statSync(p).isDirectory() } catch { return false } })
  } catch {
    return []
  }
}

/**
 * Dossiers de médias tels que montés dans le conteneur : ceux de SORTARR_MEDIA_ROOT
 * (plusieurs possibles, séparés par des virgules), plus, dans Docker, tous les autres
 * dossiers montés. Par défaut /media.
 */
export function mediaRoots(): string[] {
  const configured = (process.env.SORTARR_MEDIA_ROOT ?? '').split(',').map(s => s.trim()).filter(Boolean)
  const roots = [...(configured.length ? configured : ['/media']), ...detectedMounts()].map(p => path.resolve(p))
  return [...new Set(roots)]
}
