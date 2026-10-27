import { describe, expect, it } from 'vitest'
import { matches, validateFilter, type CatalogRow } from '../../shared/filters'
import { ruleFilterProblems } from '../../shared/rules'
import { buildFilter, defaultParams, suggestName, TEMPLATES } from '../../app/utils/ruleTemplates'

const NOW = Date.UTC(2026, 9, 1)
const DAY = 86_400_000
const row: CatalogRow = {
  id: 1, type: 'movie', title: 'Dune', year: 2021, originalLanguage: 'en', genres: [], rating: 5.1, ratingTmdb: 5.1, ratingImdb: null, addedAt: NOW - 400 * DAY,
  sizeGb: 30, resolution: 720, videoCodecs: [], audioLanguages: ['en'], subtitleLanguages: [], isRemux: false, instances: ['1'], servers: ['3'], libraries: [],
  rootFolders: [], tags: [], monitored: true, hasFile: true, neverWatched: true, lastWatchedAt: null, playCount: 0,
}
const empty = { kind: 'group' as const, mode: 'and' as const, children: [] }
const labels = { language: (c: string) => ({ en: 'Anglais', fr: 'Français' })[c] ?? c, instance: (id: string) => `Radarr ${id}` }

describe('modèles de règles', () => {
  it('produisent des filtres valides et non vides avec leurs réglages par défaut', () => {
    for (const t of TEMPLATES.filter(t => t.key !== 'personnalise')) {
      const params = t.key === 'rangement' ? { ...defaultParams(t.key), instanceId: '2' } : defaultParams(t.key)
      const f = buildFilter(t.key, params, empty)!
      expect(validateFilter(f), t.key).toEqual([])
      expect(ruleFilterProblems(f), t.key).toEqual([])
    }
  })

  it('rangement : signale un film anglais hors de l\'instance attendue', () => {
    const f = buildFilter('rangement', { ...defaultParams('rangement'), instanceId: '2' }, empty)!
    expect(matches(row, f, NOW)).toBe(true)
    expect(matches({ ...row, instances: ['2'] }, f, NOW)).toBe(false)
    expect(matches({ ...row, originalLanguage: 'fr' }, f, NOW)).toBe(false)
    expect(buildFilter('rangement', defaultParams('rangement'), empty)).toBeNull()
    expect(suggestName('rangement', { ...defaultParams('rangement'), instanceId: '2' }, labels)).toBe('Films en anglais → Radarr 2')
  })

  it('qualité : signale une résolution ou une langue manquante', () => {
    const f = buildFilter('qualite', { instances: [], minResolution: 1080, audio: ['fr'], subtitles: [] }, empty)!
    expect(matches(row, f, NOW)).toBe(true)
    expect(matches({ ...row, resolution: 1080, audioLanguages: ['en', 'fr'] }, f, NOW)).toBe(false)
    expect(matches({ ...row, resolution: 1080 }, f, NOW)).toBe(true)
    expect(buildFilter('qualite', { instances: [], minResolution: 0, audio: [], subtitles: [] }, empty)).toBeNull()
  })

  it('ménage : jamais vus et anciens', () => {
    const f = buildFilter('menage', defaultParams('menage'), empty)!
    expect(matches(row, f, NOW)).toBe(true)
    expect(matches({ ...row, addedAt: NOW - 10 * DAY }, f, NOW)).toBe(false)
    expect(matches({ ...row, neverWatched: false, playCount: 2 }, f, NOW)).toBe(false)
  })
})
