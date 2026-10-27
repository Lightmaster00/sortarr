import { z } from 'zod'

export const INSTANCE_KINDS = ['radarr', 'sonarr', 'plex', 'jellyfin'] as const
export type InstanceKind = typeof INSTANCE_KINDS[number]

export const KIND_LABELS: Record<InstanceKind, string> = { radarr: 'Radarr', sonarr: 'Sonarr', plex: 'Plex', jellyfin: 'Jellyfin' }

export function isArrKind(kind: InstanceKind): kind is 'radarr' | 'sonarr' {
  return kind === 'radarr' || kind === 'sonarr'
}

export type InstanceStatus = 'inconnu' | 'ok' | 'erreur' | 'perime'

export const STATUS_LABELS: Record<InstanceStatus, string> = {
  inconnu: 'jamais testée',
  ok: 'connectée',
  erreur: 'erreur',
  perime: 'données périmées',
}

export const STATUS_DOT: Record<InstanceStatus, string> = {
  inconnu: 'bg-neutral-400',
  ok: 'bg-success',
  erreur: 'bg-error',
  perime: 'bg-warning',
}

export interface InstanceDto {
  id: number
  kind: InstanceKind
  name: string
  url: string
  enabled: boolean
  hasKey: boolean
  version: string | null
  lastStatus: InstanceStatus
  lastStatusAt: number | null
  lastError: string | null
  lastSyncAt: number | null
  /** La dernière synchro a échoué : les données affichées datent de la précédente. */
  stale: boolean
  /** Nombre de correspondances de chemins enregistrées (0 = rien de détecté). */
  pathCount: number
}

/** Statut de connexion, complété de « données périmées » quand la dernière synchro a échoué. */
export function statusLabel(i: Pick<InstanceDto, 'lastStatus' | 'stale'>): string {
  const base = STATUS_LABELS[i.lastStatus]
  return i.stale && i.lastStatus !== 'perime' ? `${base} · ${STATUS_LABELS.perime}` : base
}

/** Couleur du point d'état : orange dès que les données sont périmées, sauf erreur de connexion. */
export function statusDot(i: Pick<InstanceDto, 'lastStatus' | 'stale'>): string {
  return i.stale && i.lastStatus === 'ok' ? STATUS_DOT.perime : STATUS_DOT[i.lastStatus]
}

const url = z.string().trim()
  .regex(/^https?:\/\/[^\s/]+/i, 'URL invalide (http:// ou https:// attendu)')
  .transform(u => u.replace(/\/+$/, ''))

const name = z.string().trim().min(1, 'Nom obligatoire').max(60, '60 caractères maximum')

export const instanceCreateSchema = z.object({
  kind: z.enum(INSTANCE_KINDS),
  name,
  url,
  apiKey: z.string().trim().min(1, 'Clé API obligatoire'),
  enabled: z.boolean().default(true),
})

export const instanceUpdateSchema = z.object({
  name,
  url,
  apiKey: z.string().trim().optional().transform(v => (v ? v : undefined)),
  enabled: z.boolean().default(true),
})

export const instanceTestSchema = z.object({
  id: z.number().int().positive().optional(),
  kind: z.enum(INSTANCE_KINDS),
  url,
  apiKey: z.string().trim().optional().transform(v => (v ? v : undefined)),
})

export interface Discovery {
  version: string
  roots: { path: string; label: string }[]
  qualityProfiles: string[]
  libraries: { id: string; name: string; type: string; locations: string[] }[]
}

export type TestResult = { ok: true; discovery: Discovery } | { ok: false; error: string }
