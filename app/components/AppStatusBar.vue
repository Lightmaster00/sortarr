<script setup lang="ts">
import { statusDot, statusLabel, type InstanceDto } from '#shared/instances'

const api = useApi()
const toast = useToast()
const instances = useState<InstanceDto[]>('instances', () => [])
const { state: sync, refresh: refreshSync, start } = useSyncState()

async function refreshInstances() {
  try {
    instances.value = await api<InstanceDto[]>('/api/instances')
  } catch {
    // La page affiche déjà l'erreur ; la barre d'état réessaiera dans 30 s.
  }
}

async function startSync() {
  try {
    await start()
  } catch (e) {
    toast.add({ title: 'Synchro impossible', description: errorMessage(e), color: 'error' })
  }
}

function tooltip(i: InstanceDto) {
  return `${i.name} : ${statusLabel(i)}${i.lastError ? ` — ${i.lastError}` : ''}`
}

let interval: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  void refreshInstances()
  void refreshSync()
  interval = setInterval(() => {
    void refreshInstances()
    void refreshSync() // détecte une synchro lancée par le planificateur
  }, 30_000)
})
onBeforeUnmount(() => clearInterval(interval))
onSyncFinished(refreshInstances)

const enabled = computed(() => instances.value.filter(i => i.enabled))
</script>

<template>
  <div class="flex items-center gap-3">
    <div class="hidden sm:flex items-center gap-1.5">
      <UTooltip v-for="i in enabled" :key="i.id" :text="tooltip(i)">
        <span role="img" :aria-label="tooltip(i)" class="block size-2.5 rounded-full" :class="statusDot(i)" />
      </UTooltip>
    </div>
    <UButton
      :loading="sync?.running"
      icon="i-lucide-refresh-cw"
      :label="sync?.running ? 'Synchro en cours…' : 'Synchroniser'"
      size="sm"
      variant="soft"
      @click="startSync"
    />
  </div>
</template>
