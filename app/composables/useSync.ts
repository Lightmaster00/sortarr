import type { SyncStateDto } from '#shared/sync'

let pollTimer: ReturnType<typeof setTimeout> | null = null
let generation = 0
let failures = 0
const MAX_FAILURES = 10

/** Arrête le sondage en attente (déconnexion). */
export function stopSyncPolling(): void {
  generation++
  failures = 0
  if (pollTimer) clearTimeout(pollTimer)
  pollTimer = null
}

export function useSyncState() {
  const api = useApi()
  const state = useState<SyncStateDto | null>('sync', () => null)

  async function refresh(): Promise<void> {
    const startedAt = generation
    try {
      const next = await api<SyncStateDto>('/api/sync')
      if (startedAt !== generation) return
      state.value = next
      failures = 0
    } catch (e) {
      if (startedAt !== generation) return
      const err = e as { statusCode?: number; status?: number }
      if ((err.statusCode ?? err.status) === 401) {
        stopSyncPolling()
        state.value = null
        return
      }
      // Un sondage raté ne doit pas figer l'interface : on réessaie (borné) si une synchro tournait.
      failures++
      if (failures >= MAX_FAILURES) return
    }
    if (state.value?.running && !pollTimer) {
      pollTimer = setTimeout(() => {
        pollTimer = null
        void refresh()
      }, 2000)
    }
  }

  async function start(): Promise<void> {
    await api('/api/sync', { method: 'POST' })
    await refresh()
  }

  return { state, refresh, start }
}

/** Rappelle `callback` chaque fois qu'une synchro se termine. */
export function onSyncFinished(callback: () => void): void {
  const state = useState<SyncStateDto | null>('sync', () => null)
  watch(() => state.value?.finishedAt, (next, previous) => {
    if (next && previous !== undefined && next !== previous) callback()
  })
}
