import type { PathSuggestion } from '#shared/paths'
import { defineApiHandler, parseId } from '~~/server/lib/api'
import { mediaRoots } from '~~/server/lib/config'
import { discover } from '~~/server/lib/discovery'
import { AppError } from '~~/server/lib/errors'
import { getInstanceSecret } from '~~/server/lib/instances'
import { listMappings, normalizeDir, suggestRealPath } from '~~/server/lib/paths'

export default defineApiHandler(async (event) => {
  const id = parseId(event)
  const secret = getInstanceSecret(id)
  if (!secret) throw new AppError('Instance introuvable.', 404)
  const discovery = await discover(secret)
  const existing = listMappings(id)
  const suggestions: PathSuggestion[] = discovery.roots.map((root) => {
    const servicePath = normalizeDir(root.path)
    const saved = existing.find(m => m.servicePath === servicePath)
    return {
      servicePath,
      label: root.label,
      realPath: saved?.realPath ?? suggestRealPath(servicePath),
      managed: saved?.managed ?? true,
      existing: saved !== undefined,
    }
  })
  return { mediaRoots: mediaRoots(), suggestions }
})
