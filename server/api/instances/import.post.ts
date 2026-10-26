import { z } from 'zod'
import { defineApiHandler, parseOrThrow } from '~~/server/lib/api'
import { importFromEnv, readMediaEnvFile } from '~~/server/lib/envImport'
import { AppError } from '~~/server/lib/errors'

const schema = z.object({ names: z.array(z.string().min(1)).min(1, 'Choisis au moins une instance') })

export default defineApiHandler(async (event) => {
  const { names } = parseOrThrow(schema, await readBody(event))
  const content = readMediaEnvFile()
  if (content === null) throw new AppError('Aucun fichier media.env dans le dossier de configuration.', 404)
  return importFromEnv(names, content)
})
