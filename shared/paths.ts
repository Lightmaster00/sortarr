import { z } from 'zod'

export interface PathMapping { id: number; instanceId: number; servicePath: string; realPath: string; managed: boolean }

const absolute = (label: string) => z.string().trim().min(1, `${label} obligatoire`).startsWith('/', `${label} : chemin absolu attendu (commence par /)`)

export const mappingInputSchema = z.object({
  servicePath: absolute('Chemin du service'),
  realPath: absolute('Chemin réel'),
  managed: z.boolean().default(true),
})
export type MappingInput = z.infer<typeof mappingInputSchema>

export const mappingsPutSchema = z.object({ mappings: z.array(mappingInputSchema).max(100) })

export interface PathSuggestion { servicePath: string; label: string; realPath: string | null; managed: boolean; existing: boolean }
export interface PathCheck { servicePath: string; realPath: string | null; exists: boolean; message: string }
