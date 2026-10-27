import type { FilterGroup } from '#shared/filters'

export interface QuickView { key: string; label: string; icon: string; hint: string; filter: () => FilterGroup }

const only = (...children: FilterGroup['children']): FilterGroup => ({ kind: 'group', mode: 'and', children })

/** Vues prêtes à l'emploi du catalogue, aussi utilisées comme liens depuis le tableau de bord. */
export const QUICK_VIEWS: QuickView[] = [
  { key: 'tout', label: 'Tout', icon: 'i-lucide-library', hint: 'Tout le catalogue.', filter: () => only() },
  { key: 'jamais-vus', label: 'Jamais vus', icon: 'i-lucide-eye-off', hint: 'Personne ne les a lancés sur Plex ou Jellyfin.', filter: () => only({ kind: 'cond', field: 'neverWatched', op: 'is_true' }) },
  { key: 'hors-serveurs', label: 'Invisibles sur les serveurs', icon: 'i-lucide-monitor-off', hint: 'Gérés par Radarr/Sonarr mais absents de Plex et Jellyfin.', filter: () => only({ kind: 'cond', field: 'servers', op: 'empty' }, { kind: 'cond', field: 'hasFile', op: 'is_true' }) },
  { key: 'sans-gestionnaire', label: 'Sans Radarr/Sonarr', icon: 'i-lucide-unlink', hint: 'Présents sur un serveur média mais suivis par aucun gestionnaire.', filter: () => only({ kind: 'cond', field: 'instances', op: 'empty' }) },
  { key: 'sans-fichier', label: 'Sans fichier', icon: 'i-lucide-file-x', hint: 'Suivis par Radarr/Sonarr mais aucun fichier téléchargé.', filter: () => only({ kind: 'cond', field: 'hasFile', op: 'is_false' }, { kind: 'cond', field: 'instances', op: 'not_empty' }) },
  { key: 'basse-qualite', label: 'Qualité ≤ 720p', icon: 'i-lucide-gauge', hint: 'Au moins un fichier en 720p ou moins.', filter: () => only({ kind: 'cond', field: 'resolution', op: 'lte', value: 720 }) },
]

export const QUICK_VIEW_BY_KEY = Object.fromEntries(QUICK_VIEWS.map(v => [v.key, v]))
