import type { InstanceKind } from '#shared/instances'

export interface ServiceInfo {
  icon: string
  /** Couleur de marque, utilisée seulement pour le logo. */
  color: string
  role: string
  description: string
  keyHelp: string[]
  placeholder: string
}

export const SERVICES: Record<InstanceKind, ServiceInfo> = {
  radarr: {
    icon: 'i-simple-icons-radarr',
    color: '#ffc230',
    role: 'Gestionnaire de films',
    description: 'Sait quels films tu as, où sont leurs fichiers et en quelle qualité.',
    keyHelp: ['Ouvre Radarr', 'Settings › General', 'Section Security : copie « API Key »'],
    placeholder: 'http://192.168.1.10:7878',
  },
  sonarr: {
    icon: 'i-simple-icons-sonarr',
    color: '#35c5f4',
    role: 'Gestionnaire de séries',
    description: 'Sait quelles séries tu as, épisode par épisode.',
    keyHelp: ['Ouvre Sonarr', 'Settings › General', 'Section Security : copie « API Key »'],
    placeholder: 'http://192.168.1.10:8989',
  },
  plex: {
    icon: 'i-simple-icons-plex',
    color: '#ebaf00',
    role: 'Serveur média',
    description: 'Sait ce qui est visible dans tes bibliothèques et ce qui a été regardé.',
    keyHelp: ['Ouvre Plex Web avec le compte administrateur', 'Sur un film : ⋯ › Obtenir des infos › Afficher le XML', 'Dans l\'adresse de la page, copie la valeur après « X-Plex-Token= »'],
    placeholder: 'http://192.168.1.10:32400',
  },
  jellyfin: {
    icon: 'i-simple-icons-jellyfin',
    color: '#aa5cc3',
    role: 'Serveur média',
    description: 'Sait ce qui est visible dans tes bibliothèques et ce qui a été regardé.',
    keyHelp: ['Ouvre Jellyfin › Tableau de bord', 'Avancé › Clés API', 'Clique sur « + », nomme-la « Sortarr » et copie la clé'],
    placeholder: 'http://192.168.1.10:8096',
  },
}
