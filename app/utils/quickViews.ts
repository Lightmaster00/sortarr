import type { FilterGroup } from '#shared/filters'

export interface QuickView { key: string; label: string; icon: string; hint: string; filter: () => FilterGroup }

const only = (...children: FilterGroup['children']): FilterGroup => ({ kind: 'group', mode: 'and', children })

/** Vues prêtes à l'emploi du catalogue, aussi utilisées comme liens depuis le tableau de bord. */
export const QUICK_VIEWS: QuickView[] = [
  { key: 'tout', label: 'Tout', icon: 'i-lucide-library', hint: 'Tout le catalogue.', filter: () => only() },
  { key: 'recents', label: 'Ajoutés ce mois-ci', icon: 'i-lucide-sparkles', hint: 'Ajoutés à Radarr/Sonarr ces 30 derniers jours.', filter: () => only({ kind: 'cond', field: 'addedAt', op: 'newer_than_days', value: 30 }) },
  { key: 'bien-notes', label: 'Bien notés', icon: 'i-lucide-star', hint: 'Note de 7,5 ou plus.', filter: () => only({ kind: 'cond', field: 'rating', op: 'gte', value: 7.5 }) },
  { key: 'mal-notes', label: 'Mal notés', icon: 'i-lucide-thumbs-down', hint: 'Note inférieure à 6.', filter: () => only({ kind: 'cond', field: 'rating', op: 'lt', value: 6 }) },
  { key: 'jamais-vus', label: 'Jamais vus', icon: 'i-lucide-eye-off', hint: 'Personne ne les a lancés sur Plex ou Jellyfin.', filter: () => only({ kind: 'cond', field: 'neverWatched', op: 'is_true' }) },
  { key: 'basse-qualite', label: 'Qualité ≤ 720p', icon: 'i-lucide-gauge', hint: 'Au moins un fichier en 720p ou moins.', filter: () => only({ kind: 'cond', field: 'resolution', op: 'lte', value: 720 }) },
]

export const QUICK_VIEW_BY_KEY = Object.fromEntries(QUICK_VIEWS.map(v => [v.key, v]))
