import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { mapRadarrMovie, mapSonarrSeries, type ArrFile, type RadarrMovie, type SonarrEpisode, type SonarrSeries } from '../../../server/connectors/arr'
import { aggregatePlexHistory, mapPlexItem, type PlexHistoryEntry, type PlexMeta } from '../../../server/connectors/plex'
import { aggregateJellyfinPlayed, mapJellyfinItem, type JellyfinItem } from '../../../server/connectors/jellyfin'

const dir = path.resolve('tests/fixtures/recorded')
const has = (name: string) => fs.existsSync(path.join(dir, `${name}.json`))
const load = <T>(name: string): T => JSON.parse(fs.readFileSync(path.join(dir, `${name}.json`), 'utf8')) as T

const EXPECTED = [
  'radarr-movies', 'radarr-tags', 'sonarr-series', 'sonarr-episodes',
  'plex-sections', 'plex-movie-items', 'plex-show-items', 'plex-history', 'plex-accounts',
  'jellyfin-libraries', 'jellyfin-items', 'jellyfin-played', 'jellyfin-users',
]

describe('réponses enregistrées', () => {
  it('toutes les fixtures attendues sont présentes', () => {
    if (!fs.existsSync(dir)) return
    expect(EXPECTED.filter(n => !has(n))).toEqual([])
  })

  it.skipIf(!has('radarr-movies'))('Radarr : chaque film a un titre, un chemin et un fichier normalisé', () => {
    const tags = new Map(load<{ id: number; label: string }[]>('radarr-tags').map(t => [t.id, t.label]))
    for (const m of load<RadarrMovie[]>('radarr-movies')) {
      const r = mapRadarrMovie(m, tags)
      expect(r.title).toBeTruthy()
      expect(r.servicePath.startsWith('/')).toBe(true)
      expect(r.files).toHaveLength(1)
      expect(r.files[0]!.size).toBeGreaterThan(0)
    }
  })

  it.skipIf(!has('sonarr-episodes'))('Sonarr : les fichiers d\'épisodes sont rattachés à leur série', () => {
    const series = load<SonarrSeries[]>('sonarr-series')
    for (const d of load<{ seriesId: number; episodes: SonarrEpisode[]; files: ArrFile[] }[]>('sonarr-episodes')) {
      const r = mapSonarrSeries(series.find(s => s.id === d.seriesId)!, d.episodes, d.files, new Map())
      expect(r.files.length).toBe(d.files.length)
      expect(r.files.every(f => f.season !== null)).toBe(true)
    }
  })

  it.skipIf(!has('plex-movie-items'))('Plex : les films ont un dossier et au moins un identifiant', () => {
    const data = load<{ library: string; MediaContainer: { Metadata: PlexMeta[] } }>('plex-movie-items')
    const items = data.MediaContainer.Metadata.map(m => mapPlexItem(m, data.library))
    expect(items.every(i => i.servicePaths.length > 0)).toBe(true)
    expect(items.some(i => i.tmdbId || i.imdbId)).toBe(true)
  })

  it.skipIf(!has('plex-show-items'))('Plex : les séries ont le type series et leurs dossiers', () => {
    const data = load<{ library: string; MediaContainer: { Metadata: PlexMeta[] } }>('plex-show-items')
    expect(data.MediaContainer.Metadata.length).toBeGreaterThan(0)
    for (const m of data.MediaContainer.Metadata) {
      const r = mapPlexItem(m, data.library)
      expect(r.type).toBe('series')
      if (m.Location?.length) expect(r.servicePaths.length).toBeGreaterThan(0)
    }
  })

  it.skipIf(!has('plex-history') || !has('plex-accounts'))("Plex : l'historique s'agrège par utilisateur", () => {
    const entries = load<{ MediaContainer: { Metadata?: PlexHistoryEntry[] } }>('plex-history').MediaContainer.Metadata ?? []
    expect(entries.length).toBeGreaterThan(0)
    const accounts = new Map(load<{ MediaContainer: { Account: { id: number; name: string }[] } }>('plex-accounts').MediaContainer.Account.map(a => [a.id, a.name]))
    const out = aggregatePlexHistory(entries, accounts)
    expect(out.length).toBeGreaterThan(0)
    for (const h of out) {
      expect(h.externalId).toBeTruthy()
      expect(h.lastWatchedAt ?? 0).toBeGreaterThan(0)
      expect(h.playCount).toBeGreaterThanOrEqual(1)
    }
    expect(new Set(out.map(h => h.user)).size).toBe(new Set(entries.map(e => e.accountID)).size)
  })

  it.skipIf(!has('jellyfin-items'))('Jellyfin : les éléments ont un chemin et un type', () => {
    const libs = load<{ library: string; items: JellyfinItem[] }[]>('jellyfin-items')
    expect(libs.some(l => l.items.length > 0)).toBe(true)
    for (const lib of libs) {
      for (const it of lib.items) {
        const r = mapJellyfinItem(it, lib.library)
        expect(['movie', 'series']).toContain(r.type)
        expect(r.servicePaths.length).toBe(1)
      }
    }
  })

  it.skipIf(!has('jellyfin-played'))('Jellyfin : le visionnage s\'agrège', () => {
    const played = load<{ user: string; items: JellyfinItem[] }>('jellyfin-played')
    expect(played.items.length).toBeGreaterThan(0)
    const out = aggregateJellyfinPlayed([played])
    expect(out.length).toBeGreaterThan(0)
    expect(out.every(h => !!h.externalId && h.playCount >= 1)).toBe(true)
  })
})
