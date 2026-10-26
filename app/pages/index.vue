<script setup lang="ts">
import type { DashboardDto } from '#shared/catalog'
import { KIND_LABELS, statusDot, statusLabel } from '#shared/instances'
import { formatDateTime, formatSize } from '#shared/format'

const api = useApi()
const toast = useToast()
const data = ref<DashboardDto | null>(null)
const loading = ref(true)
const loadError = ref('')

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    data.value = await api<DashboardDto>('/api/dashboard')
  } catch (e) {
    loadError.value = errorMessage(e)
    toast.add({ title: 'Tableau de bord indisponible', description: errorMessage(e), color: 'error' })
  } finally {
    loading.value = false
  }
}
onMounted(load)
onSyncFinished(load)

const stats = computed(() => data.value
  ? [
      { label: 'Films', value: data.value.movies.toLocaleString('fr-FR'), icon: 'i-lucide-film' },
      { label: 'Séries', value: data.value.series.toLocaleString('fr-FR'), icon: 'i-lucide-tv' },
      { label: 'Espace utilisé', value: formatSize(data.value.totalSizeGb), icon: 'i-lucide-hard-drive' },
      { label: 'Jamais vus', value: data.value.neverWatched.toLocaleString('fr-FR'), icon: 'i-lucide-eye-off' },
    ]
  : [])
</script>

<template>
  <AppPage title="Tableau de bord">
    <p v-if="!data && loading" class="text-muted">Chargement…</p>
    <UAlert
      v-else-if="!data"
      color="error"
      variant="subtle"
      icon="i-lucide-triangle-alert"
      title="Tableau de bord indisponible"
      :description="loadError"
      :actions="[{ label: 'Réessayer', onClick: load }]"
    />
    <div v-else class="space-y-6">
      <UAlert
        v-if="!data.instances.length"
        color="info"
        variant="subtle"
        icon="i-lucide-server"
        title="Aucune instance configurée"
        description="Ajoute tes Radarr, Sonarr, Plex et Jellyfin pour remplir le catalogue."
        :actions="[{ label: 'Ajouter des instances', to: '/reglages/instances' }]"
      />

      <div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <UCard v-for="s in stats" :key="s.label">
          <div class="flex items-center gap-3">
            <UIcon :name="s.icon" class="size-6 text-primary" />
            <div class="min-w-0">
              <p class="text-xl sm:text-2xl font-semibold">{{ s.value }}</p>
              <p class="text-sm text-muted">{{ s.label }}</p>
            </div>
          </div>
        </UCard>
      </div>

      <div class="grid lg:grid-cols-2 gap-4">
        <UCard>
          <template #header><h2 class="font-medium">Instances</h2></template>
          <ul class="space-y-2 text-sm">
            <li v-for="i in data.instances" :key="i.id" class="flex flex-wrap items-center gap-2">
              <span class="block size-2.5 rounded-full shrink-0" :class="i.enabled ? statusDot(i) : 'bg-neutral-300'" />
              <span class="font-medium shrink-0 whitespace-nowrap">{{ i.name }}</span>
              <span class="text-muted min-w-0 truncate">{{ KIND_LABELS[i.kind] }} · {{ i.enabled ? statusLabel(i) : 'désactivée' }}</span>
              <span class="ml-auto text-muted">{{ formatDateTime(i.lastSyncAt) }}</span>
            </li>
          </ul>
        </UCard>

        <UCard>
          <template #header>
            <div class="flex flex-wrap justify-between items-center gap-2">
              <h2 class="font-medium">Dernière synchro</h2>
              <span class="text-sm text-muted">Prochaine : {{ formatDateTime(data.sync.nextRunAt) }}</span>
            </div>
          </template>
          <p v-if="!data.sync.finishedAt" class="text-sm text-muted">Aucune synchro pour l'instant.</p>
          <div v-else class="space-y-2 text-sm">
            <p class="text-muted">Terminée le {{ formatDateTime(data.sync.finishedAt) }}</p>
            <ul class="space-y-1">
              <li v-for="(r, index) in data.sync.results" :key="`${r.instanceId}-${r.name}-${index}`" class="flex items-start gap-2">
                <UIcon :name="r.ok ? 'i-lucide-circle-check' : 'i-lucide-circle-x'" :class="r.ok ? 'text-success' : 'text-error'" class="size-4 mt-0.5 shrink-0" />
                <span>
                  <span class="font-medium">{{ r.name }}</span> —
                  <template v-if="r.ok">{{ r.items }} titres, {{ r.files }} fichiers<span v-if="r.unmapped" class="text-warning">, {{ r.unmapped }} sans correspondance de chemin</span></template>
                  <span v-else class="text-error">{{ r.error }}</span>
                </span>
              </li>
            </ul>
          </div>
        </UCard>
      </div>
    </div>
  </AppPage>
</template>
