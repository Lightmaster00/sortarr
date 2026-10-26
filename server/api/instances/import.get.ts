import type { ImportPreview } from '#shared/instances'
import { defineApiHandler } from '~~/server/lib/api'
import { parseMediaEnv, readMediaEnvFile } from '~~/server/lib/envImport'
import { listInstances } from '~~/server/lib/instances'

export default defineApiHandler((): ImportPreview => {
  const content = readMediaEnvFile()
  if (content === null) return { available: false, proposals: [] }
  const existing = new Set(listInstances().map(i => i.name.toLowerCase()))
  return {
    available: true,
    proposals: parseMediaEnv(content).map(p => ({ name: p.name, kind: p.kind, url: p.url, exists: existing.has(p.name.toLowerCase()) })),
  }
})
