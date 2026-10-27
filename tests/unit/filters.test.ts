import { describe, expect, it } from 'vitest'
import { defaultCondition, emptyFilter, FIELDS, FIELD_BY_KEY, filterNodeSchema, matches, OPERATORS, validateFilter, type CatalogRow, type FilterNode } from '#shared/filters'

const DAY = 86_400_000
const NOW = Date.UTC(2026, 9, 24)

const row: CatalogRow = {
  id: 1, type: 'movie', title: 'Le Fabuleux Destin d’Amélie Poulain', year: 2001, originalLanguage: 'fr', genres: ['Comédie', 'Romance'],
  rating: 7.9, ratingTmdb: 7.9, ratingImdb: 8.3, addedAt: NOW - 400 * DAY, sizeGb: 12.5, resolution: 1080, videoCodecs: ['h264'],
  audioLanguages: ['fr'], subtitleLanguages: [], isRemux: false, instances: ['1'], servers: ['3'], libraries: ['Movies'],
  rootFolders: ['/movies'], tags: [], monitored: true, hasFile: true, neverWatched: false, lastWatchedAt: NOW - 200 * DAY, playCount: 2,
}

const cond = (field: string, op: string, value?: unknown): FilterNode => ({ kind: 'cond', field, op, value } as FilterNode)
const and = (...children: FilterNode[]): FilterNode => ({ kind: 'group', mode: 'and', children })
const or = (...children: FilterNode[]): FilterNode => ({ kind: 'group', mode: 'or', children })
const m = (node: FilterNode) => matches(row, node, NOW)

describe('matches', () => {
  it('accepte tout avec un groupe vide', () => {
    expect(m(emptyFilter())).toBe(true)
  })

  it('compare le texte sans casse ni accents', () => {
    expect(m(cond('title', 'contains', 'amelie'))).toBe(true)
    expect(m(cond('title', 'not_contains', 'AMÉLIE'))).toBe(false)
    expect(m(cond('originalLanguage', 'eq', 'FR'))).toBe(true)
    expect(m(cond('originalLanguage', 'in', ['en', 'fr']))).toBe(true)
  })

  it('compare les nombres et ignore les valeurs absentes', () => {
    expect(m(cond('sizeGb', 'gt', 10))).toBe(true)
    expect(m(cond('resolution', 'lt', 1080))).toBe(false)
    expect(m(cond('year', 'between', [2000, 2005]))).toBe(true)
    expect(matches({ ...row, ratingImdb: null }, cond('ratingImdb', 'lt', 5), NOW)).toBe(false)
    expect(matches({ ...row, ratingImdb: null }, cond('ratingImdb', 'empty'), NOW)).toBe(true)
  })

  it('gère les dates relatives', () => {
    expect(m(cond('addedAt', 'older_than_days', 365))).toBe(true)
    expect(m(cond('lastWatchedAt', 'newer_than_days', 180))).toBe(false)
    expect(m(cond('addedAt', 'before', '2026-01-01'))).toBe(true)
    expect(matches({ ...row, lastWatchedAt: null }, cond('lastWatchedAt', 'older_than_days', 1), NOW)).toBe(false)
  })

  it('gère les listes', () => {
    expect(m(cond('genres', 'includes', 'romance'))).toBe(true)
    expect(m(cond('audioLanguages', 'excludes', 'en'))).toBe(true)
    expect(m(cond('genres', 'includes_all', ['Comédie', 'Drame']))).toBe(false)
    expect(m(cond('genres', 'includes_any', ['Comédie', 'Drame']))).toBe(true)
    expect(m(cond('subtitleLanguages', 'empty'))).toBe(true)
  })

  it('gère les booléens et les groupes imbriqués', () => {
    expect(m(cond('isRemux', 'is_false'))).toBe(true)
    expect(m(and(cond('type', 'eq', 'movie'), or(cond('sizeGb', 'gt', 50), cond('neverWatched', 'is_false'))))).toBe(true)
    expect(m(and(cond('type', 'eq', 'series'), cond('sizeGb', 'gt', 1)))).toBe(false)
  })
})

describe('validation', () => {
  it('accepte un filtre valide', () => {
    expect(validateFilter(and(cond('sizeGb', 'gt', 50), cond('lastWatchedAt', 'older_than_days', 365)))).toEqual([])
  })

  it('refuse un opérateur incompatible avec le champ', () => {
    expect(validateFilter(cond('sizeGb', 'contains', 'x'))).toEqual(['Taille : opérateur « contains » non disponible'])
  })

  it('refuse une valeur manquante ou mal formée', () => {
    expect(validateFilter(cond('sizeGb', 'gt', 'beaucoup'))).toEqual(['Taille : nombre attendu'])
    expect(validateFilter(cond('genres', 'includes_any', []))).toEqual(['Genres : choisis au moins une valeur'])
    expect(validateFilter(cond('year', 'between', [2000]))).toEqual(['Année : deux nombres attendus'])
    expect(validateFilter(cond('addedAt', 'before', 'hier'))).toEqual(["Date d'ajout : date invalide"])
  })

  it('limite la profondeur', () => {
    const deep = and(and(and(and(and(and(cond('year', 'gt', 1)))))))
    expect(validateFilter(deep)).toEqual(['Filtre trop imbriqué (5 niveaux maximum)'])
  })

  it('valide la forme avec Zod', () => {
    expect(filterNodeSchema.safeParse(and(cond('year', 'gt', 2000))).success).toBe(true)
    expect(filterNodeSchema.safeParse({ kind: 'cond', field: 'inconnu', op: 'eq', value: 1 }).success).toBe(false)
  })
})

describe('registre', () => {
  it('a un opérateur par défaut valide pour chaque champ', () => {
    for (const field of FIELDS) {
      expect(OPERATORS[field.type].length).toBeGreaterThan(0)
      // Texte libre et choix dynamiques : la valeur par défaut est vide, l'utilisateur doit la saisir.
      const needsInput = field.type === 'string' || field.dynamicOptions === true
      if (!needsInput) expect(validateFilter(defaultCondition(field))).toEqual([])
    }
    expect(FIELD_BY_KEY.sizeGb.unit).toBe('Go')
  })
})

describe('valeurs absentes et filtres stricts', () => {
  it('une valeur absente ne satisfait aucune négation', () => {
    const noLang = { ...row, originalLanguage: null }
    expect(matches(noLang, cond('originalLanguage', 'neq', 'fr'), NOW)).toBe(false)
    expect(matches(noLang, cond('originalLanguage', 'not_in', ['en']), NOW)).toBe(false)
    expect(matches(noLang, cond('originalLanguage', 'not_contains', 'fr'), NOW)).toBe(false)
    expect(matches({ ...row, audioLanguages: [] }, cond('audioLanguages', 'excludes', 'en'), NOW)).toBe(false)
  })

  it('refuse les opérateurs hors du type de champ', () => {
    expect(validateFilter(cond('isRemux', 'eq', true))).toEqual(['Remux : opérateur « eq » non disponible'])
    expect(matches(row, cond('isRemux', 'eq', true), NOW)).toBe(false)
  })

  it('refuse une valeur numérique nulle sans la lire comme 0', () => {
    expect(validateFilter(cond('sizeGb', 'gt', null))).toEqual(['Taille : nombre attendu'])
    expect(matches(row, cond('sizeGb', 'gt', null), NOW)).toBe(false)
    expect(matches(row, cond('sizeGb', 'lt', null), NOW)).toBe(false)
  })

  it('traite les champs inconnus sans lever d’erreur', () => {
    for (const field of ['constructor', '__proto__', 'toString']) {
      expect(validateFilter(cond(field, 'eq', 'x'))).toEqual([`Champ inconnu : ${field}`])
      expect(matches(row, cond(field, 'eq', 'x'), NOW)).toBe(false)
    }
  })

  it('exige des valeurs non vides pour les listes multiples', () => {
    expect(validateFilter(cond('audioLanguages', 'includes_any', ['', 'fr']))).toEqual(['Langues audio : valeurs invalides'])
  })

  it('compare « après » à partir du jour suivant, en UTC', () => {
    const on = (t: number) => ({ ...row, addedAt: t })
    expect(matches(on(Date.UTC(2026, 0, 1, 12)), cond('addedAt', 'after', '2026-01-01'), NOW)).toBe(false)
    expect(matches(on(Date.UTC(2026, 0, 2, 0)), cond('addedAt', 'after', '2026-01-01'), NOW)).toBe(true)
  })

  it('refuse une date calendaire inexistante', () => {
    expect(validateFilter(cond('addedAt', 'before', '2026-02-30'))).toEqual(["Date d'ajout : date invalide"])
  })

  it('ignore les apostrophes typographiques', () => {
    expect(matches(row, cond('title', 'contains', "d'amelie"), NOW)).toBe(true)
  })
})
