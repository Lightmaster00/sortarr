#!/usr/bin/env node
// Usage : node scripts/record-fixtures.mjs media.env
// Lecture seule : uniquement des requêtes GET vers les services déclarés dans media.env.
import fs from 'node:fs'
import path from 'node:path'

const envFile = process.argv[2] ?? 'media.env'
const env = Object.fromEntries(
  fs.readFileSync(envFile, 'utf8').split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#') && l.includes('='))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
)
const outDir = path.resolve('tests/fixtures/recorded')
fs.mkdirSync(outDir, { recursive: true })
const LIMIT = 15

const REDACT = new Set(['machineIdentifier', 'ServerId', 'ServerName', 'UserId', 'LocalAddress', 'WanAddress', 'LocalAddresses', 'RemoteAddresses', 'email', 'Email', 'username', 'thumb', 'PrimaryImageTag', 'deviceID', 'librarySectionUUID', 'uuid'])
function scrub(value, key) {
  if (Array.isArray(value)) return value.map(v => scrub(v))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scrub(v, k)]))
  if (key && REDACT.has(key)) return 'anonymisé'
  if (typeof value === 'string') return value.replace(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, '10.0.0.1')
  return value
}
const anonymizeUsers = list => list.map((u, i) => ({ Id: `utilisateur-${i + 1}-id`, Name: `utilisateur-${i + 1}` }))

async function get(base, route, headers) {
  const res = await fetch(`${base.replace(/\/+$/, '')}${route}`, { headers: { Accept: 'application/json', ...headers } })
  if (!res.ok) throw new Error(`HTTP ${res.status} sur ${route.split('?')[0]}`)
  return res.json()
}
function save(name, data) {
  fs.writeFileSync(path.join(outDir, `${name}.json`), `${JSON.stringify(scrub(data), null, 2)}\n`)
  console.log(`✓ ${name}.json`)
}
const firstPrefix = re => Object.keys(env).find(k => k.endsWith('_URL') && re.test(k) && !/4K/.test(k))?.slice(0, -4)

async function radarr(p) {
  const h = { 'X-Api-Key': env[`${p}_KEY`] }
  const movies = await get(env[`${p}_URL`], '/api/v3/movie', h)
  save('radarr-movies', movies.filter(m => m.movieFile).slice(0, LIMIT))
  save('radarr-tags', await get(env[`${p}_URL`], '/api/v3/tag', h))
}
async function sonarr(p) {
  const h = { 'X-Api-Key': env[`${p}_KEY`] }
  const base = env[`${p}_URL`]
  const series = (await get(base, '/api/v3/series', h)).filter(s => (s.statistics?.episodeFileCount ?? 0) > 0).slice(0, 3)
  save('sonarr-series', series)
  const detail = []
  for (const s of series) {
    const episodes = (await get(base, `/api/v3/episode?seriesId=${s.id}`, h)).filter(e => e.episodeFileId).slice(0, 30)
    const ids = new Set(episodes.map(e => e.episodeFileId))
    const files = (await get(base, `/api/v3/episodefile?seriesId=${s.id}`, h)).filter(f => ids.has(f.id))
    detail.push({ seriesId: s.id, episodes, files })
  }
  save('sonarr-episodes', detail)
}
async function plex(p) {
  const h = { 'X-Plex-Token': env[`${p}_TOKEN`] ?? env[`${p}_KEY`] }
  const base = env[`${p}_URL`]
  const sections = await get(base, '/library/sections', h)
  save('plex-sections', sections)
  const dirs = sections.MediaContainer.Directory ?? []
  for (const type of ['movie', 'show']) {
    const s = dirs.find(d => d.type === type)
    if (!s) continue
    const all = await get(base, `/library/sections/${s.key}/all?includeGuids=1`, h)
    all.MediaContainer.Metadata = (all.MediaContainer.Metadata ?? []).slice(0, LIMIT)
    save(`plex-${type}-items`, { library: s.title, ...all })
  }
  const history = await get(base, '/status/sessions/history/all?sort=viewedAt:desc&X-Plex-Container-Start=0&X-Plex-Container-Size=50', h)
  const accounts = await get(base, '/accounts', h)
  const real = accounts.MediaContainer.Account ?? []
  const idMap = new Map(real.map((a, i) => [a.id, i + 1]))
  history.MediaContainer.Metadata = (history.MediaContainer.Metadata ?? []).map(e => ({ ...e, accountID: idMap.get(e.accountID) ?? 0 }))
  save('plex-history', history)
  const used = new Set(history.MediaContainer.Metadata.map(e => e.accountID))
  const others = real.map((a, i) => i + 1).filter(n => !used.has(n)).slice(0, 15)
  const kept = real.map((a, i) => ({ id: i + 1, name: `utilisateur-${i + 1}` })).filter(a => used.has(a.id) || others.includes(a.id))
  accounts.MediaContainer.Account = kept
  accounts.MediaContainer.size = kept.length
  save('plex-accounts', accounts)
}
async function jellyfin(p) {
  const h = { Authorization: `MediaBrowser Token="${env[`${p}_KEY`]}"` }
  const base = env[`${p}_URL`]
  const libraries = await get(base, '/Library/VirtualFolders', h)
  save('jellyfin-libraries', libraries)
  const items = []
  for (const lib of libraries.filter(l => ['movies', 'tvshows'].includes(l.CollectionType))) {
    const r = await get(base, `/Items?ParentId=${lib.ItemId}&Recursive=true&IncludeItemTypes=Movie,Series&Fields=ProviderIds,Path&EnableImages=false&Limit=${LIMIT}`, h)
    items.push({ library: lib.Name, items: r.Items })
  }
  save('jellyfin-items', items)
  const userList = await get(base, '/Users', h)
  const first = userList[0]
  if (first) {
    const played = await get(base, `/Items?userId=${first.Id}&Recursive=true&IncludeItemTypes=Movie,Episode&Filters=IsPlayed&Fields=ProviderIds&EnableImages=false&EnableUserData=true&Limit=${LIMIT}`, h)
    save('jellyfin-played', { user: 'utilisateur-1-id', items: played.Items })
  }
  save('jellyfin-users', anonymizeUsers(userList.map(u => ({ Id: u.Id, Name: u.Name }))))
}

const jobs = [
  ['RADARR', radarr], ['SONARR', sonarr], ['PLEX', plex], ['JELLYFIN', jellyfin],
]
for (const [name, fn] of jobs) {
  const prefix = firstPrefix(new RegExp(name))
  if (!prefix) { console.log(`- ${name} absent de ${envFile}`); continue }
  try { await fn(prefix) } catch (e) { console.error(`✗ ${name} : ${e.message}`) }
}
