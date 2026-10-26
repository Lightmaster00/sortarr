import { KIND_LABELS, type Discovery, type InstanceKind } from '#shared/instances'
import { arrQualityProfiles, arrRootFolders, arrStatus } from '../connectors/arr'
import { jellyfinInfo, jellyfinLibraries } from '../connectors/jellyfin'
import { plexIdentity, plexSections } from '../connectors/plex'
import { AppError } from './errors'

const PLEX_TYPES = new Set(['movie', 'show'])
const JELLYFIN_TYPES = new Set(['movies', 'tvshows'])

/** Teste la connexion et décrit ce que le service expose (dossiers racines, bibliothèques). */
export async function discover(conn: { kind: InstanceKind; url: string; apiKey: string }): Promise<Discovery> {
  if (conn.kind === 'radarr' || conn.kind === 'sonarr') {
    const c = { url: conn.url, apiKey: conn.apiKey }
    const status = await arrStatus(c)
    const expected = KIND_LABELS[conn.kind]
    if (status.appName && status.appName !== expected) throw new AppError(`Ce service est un ${status.appName}, pas un ${expected}.`)
    const [roots, profiles] = await Promise.all([arrRootFolders(c), arrQualityProfiles(c)])
    return { version: status.version, roots: roots.map(r => ({ path: r.path, label: r.path })), qualityProfiles: profiles.map(p => p.name), libraries: [] }
  }
  if (conn.kind === 'plex') {
    const c = { url: conn.url, token: conn.apiKey }
    const identity = await plexIdentity(c)
    const sections = (await plexSections(c)).filter(s => PLEX_TYPES.has(s.type))
    return {
      version: identity.version,
      roots: sections.flatMap(s => s.locations.map(path => ({ path, label: s.title }))),
      qualityProfiles: [],
      libraries: sections.map(s => ({ id: s.key, name: s.title, type: s.type, locations: s.locations })),
    }
  }
  const c = { url: conn.url, apiKey: conn.apiKey }
  const info = await jellyfinInfo(c)
  const libraries = (await jellyfinLibraries(c)).filter(l => l.collectionType && JELLYFIN_TYPES.has(l.collectionType))
  return {
    version: info.version,
    roots: libraries.flatMap(l => l.locations.map(path => ({ path, label: l.name }))),
    qualityProfiles: [],
    libraries: libraries.map(l => ({ id: l.id, name: l.name, type: l.collectionType!, locations: l.locations })),
  }
}
