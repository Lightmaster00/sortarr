import { beforeEach, describe, expect, it } from 'vitest'
import { invalidateCatalog } from '../../server/lib/catalog'
import { deleteInstance, setInstanceStatus } from '../../server/lib/instances'
import { createException, deleteException, issueItems, issuesOfItem, issuesSummary, listExceptions, resetIssuesCacheForTests } from '../../server/lib/issues'
import { createRule, deleteRule, listRules, setRuleEnabled, updateRule } from '../../server/lib/rules'
import { storeArrInstance, storeServerInstance } from '../../server/lib/sync/store'
import type { ArrItemRecord } from '../../server/lib/sync/types'
import type { FilterGroup } from '../../shared/filters'
import { referencedInstanceIds, ruleFilterProblems, usesWatchFields } from '../../shared/rules'
import { useTestDb } from '../helpers/db'

const db = useTestDb()
beforeEach(() => {
  invalidateCatalog()
  resetIssuesCacheForTests()
})

const GB = 1024 ** 3
const base: Omit<ArrItemRecord, 'externalId' | 'title' | 'type' | 'servicePath' | 'files' | 'tmdbId'> = {
  year: 2020, tvdbId: null, imdbId: null, originalLanguage: 'en', genres: [], ratingTmdb: 5, ratingImdb: null, ratingSonarr: null,
  addedAt: 1000, rootFolder: '/movies', monitored: true, hasFile: true, size: 0, tags: [],
}
const movieFile = (size: number) => ({ externalId: 1, season: null, episode: null, servicePath: '/movies/x.mkv', size, resolution: 1080, videoCodec: 'h264', audioLanguages: ['en'], subtitleLanguages: [], isRemux: false, runtimeSeconds: 6000 })
const and = (...children: FilterGroup['children']): FilterGroup => ({ kind: 'group', mode: 'and', children })

/** Radarr 1 et 2, Plex 3 : Dune (1 et 2 = doublon, sur Plex), Alien (1, sans fichier), Orphan (seulement Plex). */
function seed() {
  const ins = db().prepare("INSERT INTO instances (kind, name, url, api_key_enc, created_at) VALUES (?, ?, 'http://x', 'k', 0)")
  ins.run('radarr', 'Radarr'); ins.run('radarr', 'Radarr 4K'); ins.run('plex', 'Plex')
  storeArrInstance(db(), 1, [
    { ...base, externalId: 1, type: 'movie', title: 'Dune', tmdbId: 1, servicePath: '/movies/Dune', files: [movieFile(10 * GB)] },
    { ...base, externalId: 2, type: 'movie', title: 'Alien', tmdbId: 2, servicePath: '/movies/Alien', hasFile: false, files: [] },
  ], [], 5)
  storeArrInstance(db(), 2, [{ ...base, externalId: 1, type: 'movie', title: 'Dune', tmdbId: 1, servicePath: '/movies/Dune', files: [movieFile(30 * GB)] }], [], 5)
  storeServerInstance(db(), 3, [
    { externalId: 'p1', type: 'movie', title: 'Dune', year: 2021, tmdbId: 1, tvdbId: null, imdbId: null, servicePaths: [], library: 'Movies' },
    { externalId: 'p2', type: 'movie', title: 'Orphan', year: 2001, tmdbId: 9, tvdbId: null, imdbId: null, servicePaths: [], library: 'Movies' },
  ], [], [], 6)
  setInstanceStatus(3, { status: 'ok', syncedAt: 6, syncOk: true })
}

const count = (key: string) => issuesSummary().groups.find(g => g.key === key)

describe('contrôles intégrés', () => {
  it('trouvent orphelins, doublons et titres sans fichier', () => {
    seed()
    expect(count('check:orphelin-serveur')).toMatchObject({ count: 1, severity: 'avertissement' })
    expect(count('check:doublon')).toMatchObject({ count: 1, sizeGb: 40 })
    expect(count('check:sans-fichier')?.count).toBe(1)
    expect(count('check:ecart-serveurs')?.unavailable).toContain('deux serveurs')
    expect(issueItems({ key: 'check:orphelin-serveur', page: 1, pageSize: 10 }).rows.map(r => r.title)).toEqual(['Orphan'])
  })

  it('ignorent les orphelins rangés dans un dossier non suivi par Radarr/Sonarr', () => {
    seed()
    const mappings = [{ id: 1, instanceId: 3, servicePath: '/fankarr', realPath: '/media/fankarr', managed: false }]
    storeServerInstance(db(), 3, [
      { externalId: 'p2', type: 'series', title: 'Fan', year: 2001, tmdbId: 9, tvdbId: null, imdbId: null, servicePaths: ['/fankarr/Fan'], library: 'Fan' },
      { externalId: 'p3', type: 'movie', title: 'Autre', year: 2001, tmdbId: 8, tvdbId: null, imdbId: null, servicePaths: [], library: 'Movies' },
    ], [], mappings, 7)
    db().prepare("INSERT INTO path_mappings (instance_id, service_path, real_path, managed) VALUES (3, '/fankarr', '/media/fankarr', 0)").run()
    invalidateCatalog()
    expect(issueItems({ key: 'check:orphelin-serveur', page: 1, pageSize: 10 }).rows.map(r => r.title)).toEqual(['Autre'])
    // Revenir à « suivi » les signale de nouveau, sans attendre une synchro.
    db().prepare('UPDATE path_mappings SET managed = 1').run()
    expect(count('check:orphelin-serveur')?.count).toBe(2)
  })

  it('ne contrôlent pas l\'absence des serveurs sans serveur synchronisé', () => {
    seed()
    setInstanceStatus(3, { status: 'perime', syncOk: false })
    expect(count('check:absent-serveurs')).toMatchObject({ count: 0, unavailable: expect.any(String) })
  })
})

describe('règles', () => {
  it('signalent les titres de leur filtre et se rangent par gravité', () => {
    seed()
    const rule = createRule({ name: 'Mal notés', template: 'menage', filter: and({ kind: 'cond', field: 'rating', op: 'lt', value: 6 }), severity: 'erreur' })
    expect(count(`rule:${rule.id}`)).toMatchObject({ count: 2, kind: 'rule', ruleId: rule.id }) // l'orphelin n'a pas de note
    expect(issuesSummary().groups[0]!.severity).toBe('erreur')
    setRuleEnabled(rule.id, false)
    expect(count(`rule:${rule.id}`)).toBeUndefined()
  })

  it('refusent un filtre vide, même imbriqué', () => {
    expect(() => createRule({ name: 'Tout', template: 'personnalise', filter: and() })).toThrow('Filtre')
    expect(() => createRule({ name: 'Tout', template: 'personnalise', filter: and(and()) })).toThrow('Filtre')
    expect(ruleFilterProblems(and({ kind: 'cond', field: 'hasFile', op: 'is_true' }))).toEqual([])
  })

  it('ne jugent pas le visionnage sans serveur synchronisé', () => {
    seed()
    setInstanceStatus(3, { status: 'perime', syncOk: false })
    const rule = createRule({ name: 'Jamais vus', template: 'menage', filter: and({ kind: 'cond', field: 'neverWatched', op: 'is_true' }) })
    expect(count(`rule:${rule.id}`)).toMatchObject({ count: 0, unavailable: expect.stringContaining('visionnage') })
    expect(usesWatchFields(rule.filter)).toBe(true)
  })

  it('se modifient et se suppriment avec leurs exceptions', () => {
    seed()
    const rule = createRule({ name: 'A', template: 'menage', filter: and({ kind: 'cond', field: 'hasFile', op: 'is_true' }) })
    updateRule(rule.id, { name: 'B', template: 'menage', filter: rule.filter })
    expect(listRules().map(r => r.name)).toEqual(['B'])
    createException({ source: `rule:${rule.id}`, itemId: 1, reason: '' })
    deleteRule(rule.id)
    expect(listExceptions()).toEqual([])
  })

  it('empêchent de supprimer une instance qu\'elles citent', () => {
    seed()
    createRule({ name: 'Hors 4K', template: 'rangement', filter: and({ kind: 'cond', field: 'instances', op: 'excludes', value: '2' }) })
    expect(referencedInstanceIds(listRules()[0]!.filter)).toEqual(['2'])
    expect(() => deleteInstance(2)).toThrow('Instance utilisée')
    expect(() => deleteInstance(1)).not.toThrow()
  })
})

describe('exceptions', () => {
  it('retirent un titre d\'un signalement, réversiblement', () => {
    seed()
    const orphan = issueItems({ key: 'check:orphelin-serveur', page: 1, pageSize: 10 }).rows[0]!
    expect(issuesOfItem(orphan.id).map(g => g.key)).toContain('check:orphelin-serveur')
    const ex = createException({ source: 'check:orphelin-serveur', itemId: orphan.id, reason: 'concert' })
    expect(ex).toMatchObject({ sourceTitle: expect.stringContaining('Plex'), title: 'Orphan', itemId: orphan.id })
    expect(count('check:orphelin-serveur')?.count).toBe(0)
    deleteException(ex.id)
    expect(count('check:orphelin-serveur')?.count).toBe(1)
  })

  it('refusent une source inconnue', () => {
    seed()
    expect(() => createException({ source: 'rule:99', itemId: 1, reason: '' })).toThrow('introuvable')
  })
})
