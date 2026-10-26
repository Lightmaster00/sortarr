import fs from 'node:fs'
import path from 'node:path'
import { instanceCreateSchema, type InstanceDto, type InstanceKind } from '#shared/instances'
import { configDir } from './config'
import { getDb, type Db } from './db'
import { createInstance, listInstances } from './instances'

export interface EnvProposal { name: string; kind: InstanceKind; url: string; apiKey: string }

const KIND_HINTS: [RegExp, InstanceKind][] = [[/RADARR/, 'radarr'], [/SONARR/, 'sonarr'], [/PLEX/, 'plex'], [/JELLYFIN/, 'jellyfin']]

function displayName(prefix: string): string {
  return prefix.split('_').filter(Boolean).map(w => /^\d/.test(w) ? w.toUpperCase() : w[0]!.toUpperCase() + w.slice(1).toLowerCase()).join(' ')
}

export function parseMediaEnv(content: string): EnvProposal[] {
  const vars = new Map<string, string>()
  for (const line of content.split(/\r?\n/)) {
    const text = line.trim().replace(/^export\s+/, '')
    if (!text || text.startsWith('#')) continue
    const eq = text.indexOf('=')
    if (eq < 1) continue
    vars.set(text.slice(0, eq).trim(), text.slice(eq + 1).trim().replace(/^(['"])(.*)\1$/, '$2'))
  }
  const proposals: EnvProposal[] = []
  const seen = new Set<string>()
  for (const [key, url] of vars) {
    if (!key.endsWith('_URL') || !url) continue
    const prefix = key.slice(0, -'_URL'.length)
    const apiKey = vars.get(`${prefix}_KEY`) || vars.get(`${prefix}_TOKEN`)
    const kind = KIND_HINTS.find(([re]) => re.test(prefix.toUpperCase()))?.[1]
    if (!apiKey || !kind) continue
    const parsed = instanceCreateSchema.safeParse({ kind, name: displayName(prefix), url, apiKey, enabled: true })
    if (!parsed.success) continue
    const { name, url: cleanUrl, apiKey: cleanKey } = parsed.data
    const lower = name.toLowerCase()
    if (seen.has(lower)) continue
    seen.add(lower)
    proposals.push({ name, kind, url: cleanUrl, apiKey: cleanKey })
  }
  return proposals
}

export function readMediaEnvFile(dir: string = configDir()): string | null {
  const file = path.join(dir, 'media.env')
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null
}

export function importFromEnv(names: string[], content: string, db: Db = getDb()): InstanceDto[] {
  const wanted = new Set(names.map(n => n.toLowerCase()))
  const existing = new Set(listInstances(db).map(i => i.name.toLowerCase()))
  const selected = parseMediaEnv(content)
    .filter(p => wanted.has(p.name.toLowerCase()) && !existing.has(p.name.toLowerCase()))
  return db.transaction(() => selected.map(p => createInstance({ ...p, enabled: true }, db)))()
}
