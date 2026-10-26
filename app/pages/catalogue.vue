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

const api = useApi()
const toast = useToast()
const instances = useState<InstanceDto[]>('instances', () => [])
const fields = ref<FieldDef[]>([])
const filter = ref<FilterGroup>(emptyFilter())
const search = ref('')
const page = ref(1)
const PAGE_SIZE = 50
const sort = ref<{ field: SortField; dir: 'asc' | 'desc' }>({ field: 'title', dir: 'asc' })
const result = ref<CatalogResult>({ rows: [], total: 0, totalSizeGb: 0 })
const loading = ref(false)
const loaded = ref(false)
let seq = 0
const showFilters = ref(false)
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
  type: 'Type', instances: 'Instances', libraries: 'Bibliothèques', sizeGb: 'Taille', resolution: 'Résolution',
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
  <AppPage title="Catalogue">
    <div class="space-y-4">
      <div class="flex flex-wrap items-center gap-2">
        <UInput v-model="search" icon="i-lucide-search" placeholder="Rechercher un titre…" class="w-72" />
        <UButton
          :label="activeConditions ? `Filtres (${activeConditions})` : 'Filtres'"
          icon="i-lucide-filter"
          :variant="showFilters ? 'solid' : 'soft'"
          @click="showFilters = !showFilters"
        />
        <UButton v-if="activeConditions" label="Effacer les filtres" color="neutral" variant="ghost" @click="filter = emptyFilter()" />
        <div class="ml-auto flex items-center gap-3 text-sm text-muted">
          <span>{{ result.total.toLocaleString('fr-FR') }} titres · {{ formatSize(result.totalSizeGb) }}</span>
          <UDropdownMenu :items="columnItems" :content="{ align: 'end' }">
            <UButton label="Colonnes" color="neutral" variant="outline" trailing-icon="i-lucide-chevron-down" />
          </UDropdownMenu>
        </div>
      </div>

      <UCard v-if="showFilters">
        <FilterBuilder v-if="fields.length" v-model="filter" :fields="fields" />
        <UAlert v-if="filterErrors.length" class="mt-3" color="warning" variant="subtle" icon="i-lucide-triangle-alert" title="Filtre incomplet" :description="filterErrors.join(' ; ')" />
      </UCard>

      <UTable v-model:column-visibility="columnVisibility" :data="result.rows" :columns="columns" :loading="loading" sticky class="max-h-[calc(100vh-16rem)]" />
      <p v-if="loaded && !loading && !result.total" class="text-center text-muted py-6">
        Aucun titre. Lance une synchro, ou élargis les filtres.
      </p>

      <div v-if="result.total > PAGE_SIZE" class="flex justify-center">
        <UPagination v-model:page="page" :total="result.total" :items-per-page="PAGE_SIZE" />
      </div>
    </div>

    <ItemDetail v-model:id="detailId" />
  </AppPage>
</template>
