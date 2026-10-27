<script setup lang="ts">
import { h, resolveComponent } from 'vue'
import type { TableColumn } from '@nuxt/ui'
import { emptyFilter, validateFilter, type CatalogRow, type FieldDef, type FilterGroup } from '#shared/filters'
import type { CatalogResult, SortField } from '#shared/catalog'
import type { InstanceDto } from '#shared/instances'
import { languageLabel, resolutionLabel } from '#shared/media'
import { formatDate, formatSize } from '#shared/format'

const UBadge = resolveComponent('UBadge')
const UButton = resolveComponent('UButton')
const RatingBadge = resolveComponent('RatingBadge')

const api = useApi()
const toast = useToast()
const route = useRoute()
const instances = useState<InstanceDto[]>('instances', () => [])
const fields = ref<FieldDef[]>([])
const initialView = typeof route.query.vue === 'string' ? QUICK_VIEW_BY_KEY[route.query.vue] : undefined
const filter = ref<FilterGroup>(initialView ? initialView.filter() : emptyFilter())
const search = ref('')
const page = ref(1)
const PAGE_SIZE = 50
const sort = ref<{ field: SortField; dir: 'asc' | 'desc' }>({ field: 'title', dir: 'asc' })
const result = ref<CatalogResult>({ rows: [], total: 0, totalSizeGb: 0 })
const loading = ref(false)
const loaded = ref(false)
let seq = 0
const showFilters = ref(false)

// Vues rapides : un clic remplace le filtre courant.
const filterJson = computed(() => JSON.stringify(filter.value))
const activeView = computed(() => QUICK_VIEWS.find(v => JSON.stringify(v.filter()) === filterJson.value)?.key ?? null)
function applyView(key: string) {
  filter.value = QUICK_VIEW_BY_KEY[key]!.filter()
  void navigateTo({ query: { ...route.query, vue: key === 'tout' ? undefined : key } }, { replace: true })
}
watch(activeView, (key) => {
  if (route.query.vue && key !== route.query.vue) void navigateTo({ query: { ...route.query, vue: undefined } }, { replace: true })
})

// Affichage en affiches ou en tableau, mémorisé dans le navigateur.
const VIEW_KEY = 'sortarr.catalogue.view'
function readMode(): 'grid' | 'table' {
  try { return localStorage.getItem(VIEW_KEY) === 'table' ? 'table' : 'grid' } catch { return 'grid' }
}
const mode = ref<'grid' | 'table'>(readMode())
watch(mode, (value) => {
  try { localStorage.setItem(VIEW_KEY, value) } catch { /* stockage indisponible */ }
})
const SORT_ITEMS: { label: string; value: SortField }[] = [
  { label: 'Titre', value: 'title' }, { label: 'Année', value: 'year' }, { label: 'Date d\'ajout', value: 'addedAt' },
  { label: 'Taille', value: 'sizeGb' }, { label: 'Résolution', value: 'resolution' }, { label: 'Dernier visionnage', value: 'lastWatchedAt' },
  { label: 'Nombre de lectures', value: 'playCount' }, { label: 'Note', value: 'rating' },
]
const sortField = computed({
  get: () => sort.value.field,
  set: (field: SortField) => { sort.value = { field, dir: field === 'title' ? 'asc' : 'desc' } },
})
const detailId = ref<number | null>(null)

const filterErrors = computed(() => validateFilter(filter.value))
function countConditions(group: FilterGroup): number {
  return group.children.reduce((n, c) => n + (c.kind === 'group' ? countConditions(c) : 1), 0)
}
const activeConditions = computed(() => countConditions(filter.value))

async function load() {
  // Invalide d'abord une requête en vol : sa réponse ne doit pas écraser l'état d'un filtre devenu invalide.
  const my = ++seq
  if (filterErrors.value.length) {
    loading.value = false
    return
  }
  loading.value = true
  try {
    const res = await api<CatalogResult>('/api/catalog/query', {
      method: 'POST',
      body: { filter: filter.value, search: search.value.trim() || undefined, sort: sort.value, page: page.value, pageSize: PAGE_SIZE },
    })
    if (my !== seq) return
    result.value = res
    loaded.value = true
  } catch (e) {
    if (my !== seq) return
    loaded.value = false
    toast.add({ title: 'Catalogue indisponible', description: errorMessage(e), color: 'error' })
  } finally {
    if (my === seq) loading.value = false
  }
}

let debounce: ReturnType<typeof setTimeout> | undefined
function reloadFromStart() {
  clearTimeout(debounce)
  debounce = setTimeout(() => {
    if (page.value !== 1) page.value = 1
    else void load()
  }, 300)
}
watch([filter, search], reloadFromStart, { deep: true })
watch(page, () => {
  clearTimeout(debounce)
  void load()
})
watch(sort, () => {
  clearTimeout(debounce)
  if (page.value !== 1) page.value = 1
  else void load()
}, { deep: true })
onSyncFinished(() => {
  clearTimeout(debounce)
  void load()
})

onMounted(async () => {
  try {
    const [f, list] = await Promise.all([api<{ fields: FieldDef[] }>('/api/catalog/fields'), api<InstanceDto[]>('/api/instances')])
    fields.value = f.fields
    instances.value = list
  } catch (e) {
    toast.add({ title: 'Chargement impossible', description: errorMessage(e), color: 'error' })
  }
  await load()
})

const instanceName = (id: string) => instances.value.find(i => String(i.id) === id)?.name ?? `#${id}`
const langs = (codes: string[]) => (codes.length ? codes.map(languageLabel).join(', ') : '—')

function sortHeader(label: string, field: SortField) {
  return () => h(UButton, {
    color: 'neutral',
    variant: 'ghost',
    label,
    class: '-mx-2.5',
    icon: sort.value.field === field ? (sort.value.dir === 'asc' ? 'i-lucide-arrow-up-narrow-wide' : 'i-lucide-arrow-down-wide-narrow') : 'i-lucide-arrow-up-down',
    onClick: () => { sort.value = { field, dir: sort.value.field === field && sort.value.dir === 'asc' ? 'desc' : 'asc' } },
  })
}

const COLUMN_LABELS: Record<string, string> = {
  type: 'Type', rating: 'Note', instances: 'Instances', libraries: 'Bibliothèques', sizeGb: 'Taille', resolution: 'Résolution',
  audioLanguages: 'Audio', subtitleLanguages: 'Sous-titres', originalLanguage: 'Langue originale', addedAt: 'Ajouté', lastWatchedAt: 'Dernier visionnage',
}

const columns: TableColumn<CatalogRow>[] = [
  {
    id: 'title',
    header: sortHeader('Titre', 'title'),
    cell: ({ row }) => h('button', { class: 'text-left hover:underline', onClick: () => { detailId.value = row.original.id } }, [
      h('span', { class: 'font-medium' }, row.original.title),
      row.original.year ? h('span', { class: 'text-muted ml-1' }, `(${row.original.year})`) : null,
    ]),
  },
  {
    id: 'type',
    header: 'Type',
    cell: ({ row }) => h(UBadge, { variant: 'subtle', color: row.original.type === 'movie' ? 'primary' : 'info' }, () => (row.original.type === 'movie' ? 'Film' : 'Série')),
  },
  {
    id: 'instances',
    header: 'Instances',
    cell: ({ row }) => row.original.instances.length
      ? h('div', { class: 'flex flex-wrap gap-1' }, row.original.instances.map(id => h(UBadge, { variant: 'outline', color: 'neutral', size: 'sm' }, () => instanceName(id))))
      : h('span', { class: 'text-warning' }, 'aucune'),
  },
  { id: 'libraries', header: 'Bibliothèques', cell: ({ row }) => row.original.libraries.join(', ') || '—' },
  { id: 'rating', header: sortHeader('Note', 'rating'), cell: ({ row }) => (row.original.rating === null ? '—' : h(RatingBadge, { value: row.original.rating })) },
  { id: 'sizeGb', header: sortHeader('Taille', 'sizeGb'), cell: ({ row }) => formatSize(row.original.sizeGb) },
  { id: 'resolution', header: sortHeader('Résolution', 'resolution'), cell: ({ row }) => resolutionLabel(row.original.resolution) },
  { id: 'audioLanguages', header: 'Audio', cell: ({ row }) => langs(row.original.audioLanguages) },
  { id: 'subtitleLanguages', header: 'Sous-titres', cell: ({ row }) => langs(row.original.subtitleLanguages) },
  { id: 'originalLanguage', header: 'Langue originale', cell: ({ row }) => (row.original.originalLanguage ? languageLabel(row.original.originalLanguage) : '—') },
  { id: 'addedAt', header: sortHeader('Ajouté', 'addedAt'), cell: ({ row }) => formatDate(row.original.addedAt) },
  { id: 'lastWatchedAt', header: sortHeader('Dernier visionnage', 'lastWatchedAt'), cell: ({ row }) => (row.original.lastWatchedAt ? formatDate(row.original.lastWatchedAt) : 'jamais') },
]

const VISIBILITY_KEY = 'sortarr.catalogue.columns'
function readVisibility(): Record<string, boolean> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(VISIBILITY_KEY) ?? '{}')
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
    return Object.fromEntries(Object.entries(parsed).filter(([, v]) => typeof v === 'boolean')) as Record<string, boolean>
  } catch { return {} }
}
const columnVisibility = ref<Record<string, boolean>>(readVisibility())
watch(columnVisibility, (value) => {
  try { localStorage.setItem(VISIBILITY_KEY, JSON.stringify(value)) } catch { /* stockage indisponible */ }
}, { deep: true })

const columnItems = computed(() => Object.entries(COLUMN_LABELS).map(([id, label]) => ({
  label,
  type: 'checkbox' as const,
  checked: columnVisibility.value[id] !== false,
  onUpdateChecked: (checked: boolean) => { columnVisibility.value = { ...columnVisibility.value, [id]: checked } },
  onSelect: (e: Event) => e.preventDefault(),
})))
</script>

<template>
  <AppPage
    title="Catalogue"
    icon="i-lucide-library"
    description="Tous tes films et séries, croisés entre Radarr, Sonarr, Plex et Jellyfin. Pars d'une vue rapide, ou combine tes propres filtres pour repérer ce qui doit être rangé ou nettoyé."
  >
    <div class="space-y-4">
      <div class="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
        <UTooltip v-for="v in QUICK_VIEWS" :key="v.key" :text="v.hint">
          <UButton
            :label="v.label"
            :icon="v.icon"
            size="sm"
            class="shrink-0 rounded-full"
            :color="activeView === v.key ? 'primary' : 'neutral'"
            :variant="activeView === v.key ? 'solid' : 'outline'"
            @click="applyView(v.key)"
          />
        </UTooltip>
      </div>

      <div class="flex flex-wrap items-center gap-2">
        <UInput v-model="search" icon="i-lucide-search" placeholder="Rechercher un titre…" class="w-full sm:w-72" />
        <UButton
          :label="activeConditions ? `Filtres (${activeConditions})` : 'Filtres avancés'"
          icon="i-lucide-sliders-horizontal"
          :variant="showFilters ? 'solid' : 'soft'"
          @click="showFilters = !showFilters"
        />
        <UButton v-if="activeConditions" label="Effacer" icon="i-lucide-x" color="neutral" variant="ghost" @click="applyView('tout')" />
        <div class="ml-auto flex flex-wrap items-center gap-2">
          <span class="text-sm text-muted tabular-nums">{{ result.total.toLocaleString('fr-FR') }} titres · {{ formatSize(result.totalSizeGb) }}</span>
          <template v-if="mode === 'grid'">
            <USelect v-model="sortField" :items="SORT_ITEMS" class="w-44" aria-label="Trier par" />
            <UButton
              :icon="sort.dir === 'asc' ? 'i-lucide-arrow-up-narrow-wide' : 'i-lucide-arrow-down-wide-narrow'"
              color="neutral"
              variant="outline"
              :aria-label="sort.dir === 'asc' ? 'Ordre croissant' : 'Ordre décroissant'"
              @click="sort = { field: sort.field, dir: sort.dir === 'asc' ? 'desc' : 'asc' }"
            />
          </template>
          <UDropdownMenu v-else :items="columnItems" :content="{ align: 'end' }">
            <UButton label="Colonnes" color="neutral" variant="outline" trailing-icon="i-lucide-chevron-down" />
          </UDropdownMenu>
          <UFieldGroup>
            <UButton icon="i-lucide-layout-grid" :color="mode === 'grid' ? 'primary' : 'neutral'" :variant="mode === 'grid' ? 'soft' : 'outline'" aria-label="Affiches" @click="mode = 'grid'" />
            <UButton icon="i-lucide-table" :color="mode === 'table' ? 'primary' : 'neutral'" :variant="mode === 'table' ? 'soft' : 'outline'" aria-label="Tableau" @click="mode = 'table'" />
          </UFieldGroup>
        </div>
      </div>

      <UCard v-if="showFilters">
        <p class="text-sm text-muted mb-3">Chaque ligne est une condition. « Toutes » = le titre doit les remplir toutes ; « Au moins une » = une seule suffit. Les groupes permettent de mélanger les deux.</p>
        <FilterBuilder v-if="fields.length" v-model="filter" :fields="fields" />
        <UAlert v-if="filterErrors.length" class="mt-3" color="warning" variant="subtle" icon="i-lucide-triangle-alert" title="Filtre incomplet" :description="filterErrors.join(' ; ')" />
      </UCard>

      <div v-if="mode === 'grid'" class="relative">
        <div class="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-x-4 gap-y-5" :class="{ 'opacity-60': loading }">
          <button v-for="r in result.rows" :key="r.id" type="button" class="text-left group self-start" @click="detailId = r.id">
            <PosterImage :id="r.id" :title="r.title" :type="r.type" class="group-hover:ring-2 group-hover:ring-primary transition-shadow">
              <span v-if="r.resolution" class="absolute top-1.5 left-1.5 rounded bg-black/75 px-1.5 py-0.5 text-[11px] font-semibold text-white">{{ resolutionLabel(r.resolution) }}</span>
              <div class="absolute top-1.5 right-1.5"><RatingBadge :value="r.rating" overlay /></div>
            </PosterImage>
            <p class="text-sm font-medium mt-1.5 line-clamp-2 leading-snug group-hover:text-primary">{{ r.title }}</p>
            <p class="text-xs text-muted">{{ r.year ?? '—' }}{{ r.type === 'series' ? ' · série' : '' }} <template v-if="r.sizeGb"> · {{ formatSize(r.sizeGb) }}</template></p>
          </button>
        </div>
      </div>
      <UTable v-else v-model:column-visibility="columnVisibility" :data="result.rows" :columns="columns" :loading="loading" sticky class="max-h-[calc(100vh-16rem)]" />

      <div v-if="loaded && !loading && !result.total" class="text-center py-10 space-y-2">
        <UIcon name="i-lucide-search-x" class="size-10 text-dimmed mx-auto" />
        <p class="text-muted">Aucun titre ne correspond. Élargis les filtres, ou lance une synchro si le catalogue est vide.</p>
      </div>

      <div v-if="result.total > PAGE_SIZE" class="flex justify-center">
        <UPagination v-model:page="page" :total="result.total" :items-per-page="PAGE_SIZE" />
      </div>
    </div>

    <ItemDetail v-model:id="detailId" />
  </AppPage>
</template>
