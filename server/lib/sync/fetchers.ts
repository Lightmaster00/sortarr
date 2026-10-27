import fs from 'node:fs'
import path from 'node:path'
import { arrStatus, arrTags, mapRadarrMovie, mapSonarrSeries, radarrMovies, sonarrEpisodeFiles, sonarrEpisodes, sonarrSeries } from '../../connectors/arr'
import { aggregateJellyfinPlayed, jellyfinInfo, jellyfinLibraries, jellyfinLibraryItems, jellyfinPlayed, jellyfinUsers, mapJellyfinItem } from '../../connectors/jellyfin'
import { aggregatePlexHistory, mapPlexItem, plexAccounts, plexHistory, plexIdentity, plexMetadata, plexSectionItems, plexSections } from '../../connectors/plex'
import { mapLimit } from '../concurrency'
import { autoConfigurePaths } from '../paths'
import type { InstanceSecret } from '../instances'
import type { ServerItemRecord, SyncDeps } from './types'

export async function fetchArr(s: InstanceSecret) {
  const c = { url: s.url, apiKey: s.apiKey }
  const [status, tags] = await Promise.all([arrStatus(c), arrTags(c)])
  if (s.kind === 'radarr') {
    const movies = await radarrMovies(c)
    return { version: status.version, records: movies.map(m => mapRadarrMovie(m, tags)) }
  }
  const series = await sonarrSeries(c)
  const records = await mapLimit(series, 4, async (sr) => {
    const [episodes, files] = await Promise.all([sonarrEpisodes(c, sr.id), sonarrEpisodeFiles(c, sr.id)])
    return mapSonarrSeries(sr, episodes, files, tags)
  })
  return { version: status.version, records }
}

async function fetchPlex(s: InstanceSecret) {
  const c = { url: s.url, token: s.apiKey }
  const identity = await plexIdentity(c)
  const sections = (await plexSections(c)).filter(x => x.type === 'movie' || x.type === 'show')
  const items: ServerItemRecord[] = []
  for (const section of sections) {
    const metas = await plexSectionItems(c, section.key)
    // Le listing d'une section de séries ne donne pas toujours leur dossier : on le complète.
    const complete = await mapLimit(metas, 6, async m => (m.type === 'show' && !m.Location?.length ? (await plexMetadata(c, m.ratingKey)) ?? m : m))
    items.push(...complete.map(m => mapPlexItem(m, section.title, section.locations)))
  }
  const [history, accounts] = await Promise.all([plexHistory(c), plexAccounts(c)])
  return { version: identity.version, items, history: aggregatePlexHistory(history, accounts) }
}

async function fetchJellyfin(s: InstanceSecret) {
  const c = { url: s.url, apiKey: s.apiKey }
  const info = await jellyfinInfo(c)
  const libraries = (await jellyfinLibraries(c)).filter(l => l.collectionType === 'movies' || l.collectionType === 'tvshows')
  const items: ServerItemRecord[] = []
  for (const library of libraries) {
    items.push(...(await jellyfinLibraryItems(c, library.id)).map(it => mapJellyfinItem(it, library.name, library.locations)))
  }
  const users = await jellyfinUsers(c)
  const perUser = await mapLimit(users, 3, async u => ({ user: u.name, items: await jellyfinPlayed(c, u.id) }))
  return { version: info.version, items, history: aggregateJellyfinPlayed(perUser) }
}

export function fetchServer(s: InstanceSecret) {
  return s.kind === 'plex' ? fetchPlex(s) : fetchJellyfin(s)
}

/** Sous-dossiers directs (hors dossiers cachés), en chemins complets ; lève l'erreur de lecture (dont ENOENT). */
export function listTopDirs(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter(d => d.isDirectory() && !d.name.startsWith('.'))
    .map(d => path.posix.join(dir, d.name))
}

export const defaultSyncDeps: SyncDeps = { fetchArr, fetchServer, listTopDirs, configurePaths: id => autoConfigurePaths(id) }
