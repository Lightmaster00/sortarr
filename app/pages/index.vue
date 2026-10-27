<script setup lang="ts">
import type { DashboardDto } from '#shared/catalog'
import { isArrKind } from '#shared/instances'
import { languageLabel } from '#shared/media'
import { formatDateTime, formatRelative, formatSize } from '#shared/format'
import type { BarItem } from '~/components/BarList.vue'

const api = useApi()
const toast = useToast()
const { start } = useSyncState()
const data = ref<DashboardDto | null>(null)
const loading = ref(true)
const loadError = ref('')
const detailId = ref<number | null>(null)

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

async function firstSync() {
  try { await start() } catch (e) { toast.add({ title: 'Synchro impossible', description: errorMessage(e), color: 'error' }) }
}

const fr = (n: number) => n.toLocaleString('fr-FR')
const total = computed(() => (data.value ? data.value.movies + data.value.series : 0))

const steps = computed(() => {
  const d = data.value
  if (!d) return []
  return [
    { done: d.instances.some(i => isArrKind(i.kind)), title: 'Ajoute Radarr ou Sonarr', text: 'Pour savoir ce que tu possèdes.', to: '/reglages/instances' },
    { done: d.instances.some(i => !isArrKind(i.kind)), title: 'Ajoute Plex ou Jellyfin', text: 'Pour savoir ce qui est visible et regardé.', to: '/reglages/instances' },
    { done: d.sync.finishedAt !== null, title: 'Lance la première synchro', text: 'Sortarr lit tout et remplit le catalogue (une à deux minutes).', action: firstSync },
  ]
})
const setupDone = computed(() => steps.value.every(s => s.done))

const spaceItems = computed<BarItem[]>(() => (data.value?.spaceByInstance ?? []).map(s => ({
  key: String(s.id), label: s.name, kind: s.kind, value: s.sizeGb, display: formatSize(s.sizeGb), detail: `${s.name} : ${formatSize(s.sizeGb)} pour ${fr(s.titles)} titres`,
})))
const languageItems = computed<BarItem[]>(() => (data.value?.languages ?? []).map(l => ({
  key: l.code, label: l.code === 'other' ? 'Autres langues' : languageLabel(l.code), value: l.count, display: fr(l.count), detail: `${l.code === 'other' ? 'Autres langues' : languageLabel(l.code)} : ${fr(l.count)} titres`,
})))
const watchedPct = computed(() => (total.value && data.value ? Math.round(((total.value - data.value.neverWatched) / total.value) * 100) : 0))
const syncProblems = computed(() => (data.value?.sync.results ?? []).filter(r => !r.ok))
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
      <!-- Premiers pas -->
      <UCard v-if="!setupDone">
        <template #header>
          <h2 class="font-semibold">Bienvenue dans Sortarr</h2>
          <p class="text-sm text-muted mt-0.5">Trois étapes et ton catalogue est prêt.</p>
        </template>
        <div class="space-y-5">
          <HowItWorks compact />
          <ol class="grid gap-3 md:grid-cols-3">
            <li v-for="(s, n) in steps" :key="n" class="rounded-xl border p-4 flex gap-3" :class="s.done ? 'border-success/40 bg-success/5' : 'border-default'">
              <span class="inline-flex size-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold" :class="s.done ? 'bg-success text-inverted' : 'bg-primary/15 text-primary'">
                <UIcon v-if="s.done" name="i-lucide-check" class="size-4" />
                <template v-else>{{ n + 1 }}</template>
              </span>
              <div class="min-w-0 space-y-2">
                <p class="font-medium text-sm" :class="{ 'line-through text-muted': s.done }">{{ s.title }}</p>
                <p class="text-xs text-muted">{{ s.text }}</p>
                <template v-if="!s.done">
                  <UButton v-if="s.to" size="xs" label="C'est parti" trailing-icon="i-lucide-arrow-right" :to="s.to" />
                  <UButton v-else-if="s.action" size="xs" label="Synchroniser" icon="i-lucide-refresh-cw" :disabled="!steps[0]!.done" @click="s.action" />
                </template>
              </div>
            </li>
          </ol>
        </div>
      </UCard>

      <!-- Chiffres clés -->
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatTile icon="i-lucide-film" label="Films" :value="fr(data.movies)" to="/catalogue" />
        <StatTile icon="i-lucide-tv" label="Séries" :value="fr(data.series)" to="/catalogue" />
        <StatTile icon="i-lucide-hard-drive" label="Espace utilisé" :value="formatSize(data.totalSizeGb)" hint="Fichiers connus de Radarr/Sonarr" />
        <StatTile icon="i-lucide-eye-off" label="Jamais vus" :value="fr(data.neverWatched)" :hint="total ? `${100 - watchedPct} % du catalogue` : undefined" to="/catalogue?vue=jamais-vus" />
      </div>

      <!-- Derniers ajouts -->
      <UCard v-if="data.recent.length">
        <template #header>
          <div class="flex items-center justify-between gap-2">
            <h2 class="font-medium">Derniers ajouts</h2>
            <UButton label="Tout le catalogue" size="xs" variant="link" trailing-icon="i-lucide-arrow-right" to="/catalogue" />
          </div>
        </template>
        <div class="flex gap-3 overflow-x-auto pb-1 -mx-1 px-1 snap-x">
          <button v-for="r in data.recent" :key="r.id" type="button" class="w-24 sm:w-28 shrink-0 self-start text-left snap-start group" @click="detailId = r.id">
            <PosterImage :id="r.id" :title="r.title" :type="r.type" class="group-hover:ring-primary transition-shadow" />
            <p class="text-xs font-medium mt-1.5 truncate">{{ r.title }}</p>
            <p class="text-xs text-muted">{{ r.year ?? '' }}</p>
          </button>
        </div>
      </UCard>

      <!-- Graphiques -->
      <div class="grid lg:grid-cols-2 gap-4">
        <UCard>
          <template #header>
            <h2 class="font-medium">Espace par instance</h2>
            <p class="text-xs text-muted mt-0.5">Taille des fichiers gérés par chaque Radarr / Sonarr.</p>
          </template>
          <BarList :items="spaceItems" empty="Aucune donnée : ajoute Radarr ou Sonarr puis synchronise." />
        </UCard>

        <UCard>
          <template #header>
            <h2 class="font-medium">Qualité</h2>
            <p class="text-xs text-muted mt-0.5">Résolution la plus basse de chaque titre (une série compte une fois).</p>
          </template>
          <QualityBar :quality="data.quality" />
          <UButton class="mt-3" size="xs" variant="link" label="Voir les titres en 720p ou moins" trailing-icon="i-lucide-arrow-right" to="/catalogue?vue=basse-qualite" />
        </UCard>

        <UCard>
          <template #header>
            <h2 class="font-medium">Langues originales</h2>
            <p class="text-xs text-muted mt-0.5">Nombre de titres par langue de tournage.</p>
          </template>
          <BarList :items="languageItems" />
        </UCard>

        <UCard>
          <template #header>
            <h2 class="font-medium">Visionnage</h2>
            <p class="text-xs text-muted mt-0.5">Titres lancés au moins une fois sur Plex ou Jellyfin.</p>
          </template>
          <div v-if="total" class="space-y-3">
            <p><span class="text-3xl font-semibold tabular-nums">{{ watchedPct }} %</span> <span class="text-sm text-muted">déjà regardés</span></p>
            <UProgress :model-value="watchedPct" :max="100" size="lg" />
            <div class="flex justify-between text-sm text-muted">
              <span>{{ fr(total - data.neverWatched) }} regardés</span>
              <span>{{ fr(data.neverWatched) }} jamais vus</span>
            </div>
            <UButton size="xs" variant="link" label="Voir les titres jamais vus" trailing-icon="i-lucide-arrow-right" to="/catalogue?vue=jamais-vus" />
          </div>
          <p v-else class="text-sm text-muted">Pas encore de données.</p>
        </UCard>
      </div>

      <!-- État des services -->
      <UCard>
        <template #header>
          <div class="flex flex-wrap justify-between items-center gap-2">
            <h2 class="font-medium">Services</h2>
            <span class="text-sm text-muted inline-flex items-center gap-1.5">
              <UIcon name="i-lucide-calendar-clock" class="size-4" />
              Dernière synchro {{ formatRelative(data.sync.finishedAt) }} · prochaine {{ formatDateTime(data.sync.nextRunAt) }}
            </span>
          </div>
        </template>
        <UAlert v-if="syncProblems.length" class="mb-4" color="warning" variant="subtle" icon="i-lucide-triangle-alert" title="Problèmes lors de la dernière synchro">
          <template #description>
            <ul class="space-y-1 mt-1">
              <li v-for="(r, n) in syncProblems" :key="n" class="text-sm break-words"><span class="font-medium">{{ r.name }}</span> — {{ r.error }}</li>
            </ul>
          </template>
        </UAlert>
        <div v-if="data.instances.length" class="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          <NuxtLink v-for="i in data.instances" :key="i.id" to="/reglages/instances" class="flex items-center gap-3 rounded-lg border border-default p-2.5 hover:bg-elevated/50 transition-colors">
            <ServiceLogo :kind="i.kind" size="sm" />
            <span class="min-w-0 flex-1">
              <span class="block text-sm font-medium truncate">{{ i.name }}</span>
              <span class="block text-xs text-muted">{{ data.sync.results.find(r => r.instanceId === i.id)?.items?.toLocaleString('fr-FR') ?? '—' }} titres</span>
            </span>
            <UIcon
              :name="!i.enabled ? 'i-lucide-pause' : i.lastStatus === 'erreur' ? 'i-lucide-circle-x' : i.stale ? 'i-lucide-clock-alert' : i.lastStatus === 'ok' ? 'i-lucide-circle-check' : 'i-lucide-circle-dashed'"
              class="size-5"
              :class="!i.enabled ? 'text-muted' : i.lastStatus === 'erreur' ? 'text-error' : i.stale ? 'text-warning' : i.lastStatus === 'ok' ? 'text-success' : 'text-muted'"
            />
          </NuxtLink>
        </div>
        <p v-else class="text-sm text-muted">Aucun service branché.</p>
      </UCard>
    </div>

    <ItemDetail v-model:id="detailId" />
  </AppPage>
</template>
