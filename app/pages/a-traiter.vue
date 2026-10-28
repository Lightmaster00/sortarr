<script setup lang="ts">
import { SEVERITY_COLORS, SEVERITY_ICONS, SEVERITY_LABELS, SEVERITIES, type ExceptionDto, type IssueGroupDto, type IssueItemsResult } from '#shared/rules'
import { formatDate, formatSize } from '#shared/format'
import { KIND_LABELS, isArrKind, type InstanceDto } from '#shared/instances'

const api = useApi()
const toast = useToast()
const route = useRoute()
const { summary, refresh: refreshSummary } = useIssues()
const selectedKey = ref<string | null>(typeof route.query.groupe === 'string' ? route.query.groupe : null)
const result = ref<IssueItemsResult | null>(null)
const loadingItems = ref(false)
const search = ref('')
const page = ref(1)
const PAGE_SIZE = 48
const detailId = ref<number | null>(null)
let seq = 0

const groups = computed(() => summary.value?.groups ?? [])
const visibleGroups = computed(() => groups.value.filter(g => g.count > 0 || g.unavailable))
const cleanGroups = computed(() => groups.value.filter(g => g.count === 0 && !g.unavailable))
const selected = computed<IssueGroupDto | null>(() => groups.value.find(g => g.key === selectedKey.value) ?? null)

async function loadItems() {
  const key = selectedKey.value
  const my = ++seq
  if (!key) { result.value = null; return }
  loadingItems.value = true
  try {
    const res = await api<IssueItemsResult>('/api/issues/items', { method: 'POST', body: { key, search: search.value.trim() || undefined, page: page.value, pageSize: PAGE_SIZE } })
    if (my === seq) result.value = res
  } catch (e) {
    if (my === seq) toast.add({ title: 'Liste indisponible', description: errorMessage(e), color: 'error' })
  } finally {
    if (my === seq) loadingItems.value = false
  }
}

async function refreshAll() {
  await refreshSummary()
  if (!selected.value) selectedKey.value = visibleGroups.value.find(g => g.count > 0)?.key ?? null
  await loadItems()
}

function select(key: string) {
  selectedKey.value = key
  page.value = 1
  search.value = ''
}
watch(selectedKey, (key) => {
  void navigateTo({ query: { ...route.query, groupe: key ?? undefined } }, { replace: true })
  void loadItems()
})
watch(page, loadItems)
let debounce: ReturnType<typeof setTimeout> | undefined
watch(search, () => {
  clearTimeout(debounce)
  debounce = setTimeout(() => { if (page.value !== 1) page.value = 1; else void loadItems() }, 300)
})
onMounted(refreshAll)
onSyncFinished(refreshAll)

// « Ignorer » : le titre sort de ce signalement (réversible dans « Titres ignorés »).
const ignoring = ref<number | null>(null)
async function ignore(itemId: number, title: string) {
  if (!selected.value) return
  ignoring.value = itemId
  try {
    const ex = await api<ExceptionDto>('/api/exceptions', { method: 'POST', body: { source: selected.value.key, itemId } })
    toast.add({ title: `« ${title} » ignoré`, description: `Il n'apparaîtra plus dans « ${selected.value.title} ».`, color: 'neutral', actions: [{ label: 'Annuler', onClick: () => { void restore(ex.id) } }] })
    await refreshAll()
  } catch (e) {
    toast.add({ title: 'Impossible d\'ignorer', description: errorMessage(e), color: 'error' })
  } finally {
    ignoring.value = null
  }
}

const exceptionsOpen = ref(false)
const exceptions = ref<ExceptionDto[]>([])
async function openExceptions() {
  exceptionsOpen.value = true
  try { exceptions.value = await api<ExceptionDto[]>('/api/exceptions') } catch (e) { toast.add({ title: 'Liste indisponible', description: errorMessage(e), color: 'error' }) }
}
async function restore(id: number) {
  try {
    await api(`/api/exceptions/${id}`, { method: 'DELETE' })
    exceptions.value = exceptions.value.filter(e => e.id !== id)
    await refreshAll()
  } catch (e) {
    toast.add({ title: 'Impossible de rétablir', description: errorMessage(e), color: 'error' })
  }
}

const fr = (n: number) => n.toLocaleString('fr-FR')

// Titres ajoutés par un autre outil (Fankarr…) : on règle leur dossier sur le serveur pour ne plus les signaler.
const instances = useState<InstanceDto[]>('instances', () => [])
const serverFolderLinks = computed(() => instances.value.filter(i => !isArrKind(i.kind)).map(i => ({
  label: `Dossiers de ${i.name} (${KIND_LABELS[i.kind]})`, icon: 'i-lucide-folder-tree', to: `/reglages/chemins?instance=${i.id}`,
})))
onMounted(async () => {
  if (!instances.value.length) {
    try { instances.value = await api<InstanceDto[]>('/api/instances') } catch { /* le lien reste simplement absent */ }
  }
})
</script>

<template>
  <AppPage
    title="À traiter"
    icon="i-lucide-inbox"
    description="Tout ce qui cloche dans ta médiathèque, rangé par type de problème. Les contrôles de base sont toujours actifs ; tes règles ajoutent les leurs. Rien n'est modifié ici : c'est un état des lieux."
  >
    <template #actions>
      <UButton label="Titres ignorés" icon="i-lucide-eye-off" color="neutral" variant="ghost" @click="openExceptions" />
      <UButton label="Créer une règle" icon="i-lucide-plus" to="/regles/nouvelle" />
    </template>

    <div v-if="!summary" class="text-muted">Chargement…</div>
    <div v-else class="space-y-6">
      <!-- Synthèse par gravité -->
      <div class="grid grid-cols-3 gap-3">
        <div v-for="s in SEVERITIES" :key="s" class="rounded-xl border border-default p-3 sm:p-4">
          <div class="flex items-center gap-1.5 text-sm" :class="SEVERITY_TEXT[s]">
            <UIcon :name="SEVERITY_ICONS[s]" class="size-4" />
            <span class="font-medium">{{ SEVERITY_LABELS[s] }}</span>
          </div>
          <p class="text-2xl sm:text-3xl font-semibold tabular-nums mt-1">{{ fr(summary.bySeverity[s]) }}</p>
        </div>
      </div>

      <div class="grid gap-6 lg:grid-cols-[20rem_1fr] items-start">
        <!-- Liste des signalements -->
        <nav class="space-y-1.5 lg:sticky lg:top-0" aria-label="Signalements">
          <button
            v-for="g in visibleGroups"
            :key="g.key"
            type="button"
            class="w-full rounded-lg border px-3 py-2.5 text-left flex items-start gap-3 transition-colors"
            :class="g.key === selectedKey ? 'border-primary bg-primary/5' : 'border-default hover:bg-elevated/60'"
            @click="select(g.key)"
          >
            <UIcon :name="g.icon" class="size-5 mt-0.5 shrink-0" :class="g.unavailable ? 'text-dimmed' : SEVERITY_TEXT[g.severity]" />
            <span class="min-w-0 flex-1">
              <span class="block text-sm font-medium leading-snug">{{ g.title }}</span>
              <span class="block text-xs text-muted">{{ g.unavailable ? 'Pas encore évaluable' : [g.sizeGb ? formatSize(g.sizeGb) : '', g.kind === 'rule' ? 'règle' : 'contrôle'].filter(Boolean).join(' · ') }}</span>
            </span>
            <span v-if="!g.unavailable" class="text-sm font-semibold tabular-nums">{{ fr(g.count) }}</span>
          </button>
          <div v-if="cleanGroups.length" class="pt-3">
            <p class="text-xs font-medium text-muted px-1 mb-1.5">Rien à signaler</p>
            <p v-for="g in cleanGroups" :key="g.key" class="flex items-center gap-2 px-1 py-0.5 text-xs text-muted">
              <UIcon name="i-lucide-circle-check" class="size-3.5 text-success" />{{ g.title }}
            </p>
          </div>
        </nav>

        <!-- Titres du signalement choisi -->
        <section v-if="selected" class="space-y-4 min-w-0">
          <div class="rounded-xl border border-default p-4 space-y-2">
            <div class="flex flex-wrap items-center gap-2">
              <h2 class="text-lg font-semibold">{{ selected.title }}</h2>
              <UBadge :color="SEVERITY_COLORS[selected.severity]" variant="subtle" :icon="SEVERITY_ICONS[selected.severity]" :label="SEVERITY_LABELS[selected.severity]" />
              <UButton v-if="selected.ruleId" class="ml-auto" size="xs" color="neutral" variant="outline" icon="i-lucide-pencil" label="Modifier la règle" :to="`/regles/${selected.ruleId}`" />
              <UDropdownMenu v-if="selected.key === 'check:orphelin-serveur' && serverFolderLinks.length" :items="serverFolderLinks" :content="{ align: 'end' }">
                <UButton class="ml-auto" size="xs" color="neutral" variant="outline" icon="i-lucide-folder-x" label="Géré par un autre outil ?" trailing-icon="i-lucide-chevron-down" />
              </UDropdownMenu>
            </div>
            <p v-if="selected.description" class="text-sm text-muted">{{ selected.description }}</p>
            <UAlert v-if="selected.unavailable" color="neutral" variant="subtle" icon="i-lucide-hourglass" :description="selected.unavailable" />
            <p v-else class="text-sm"><span class="font-semibold">{{ fr(selected.count) }} titres</span> <span v-if="selected.sizeGb" class="text-muted">· {{ formatSize(selected.sizeGb) }}</span></p>
          </div>

          <template v-if="!selected.unavailable && selected.count">
            <UInput v-model="search" icon="i-lucide-search" placeholder="Chercher dans cette liste…" class="w-full sm:w-72" />
            <div class="grid grid-cols-[repeat(auto-fill,minmax(8rem,1fr))] gap-x-4 gap-y-5" :class="{ 'opacity-60': loadingItems }">
              <div v-for="r in result?.rows ?? []" :key="r.id" class="self-start group relative">
                <button type="button" class="w-full text-left" @click="detailId = r.id">
                  <PosterImage :id="r.id" :title="r.title" :type="r.type" class="group-hover:ring-2 group-hover:ring-primary transition-shadow">
                    <div class="absolute top-1.5 right-1.5"><RatingBadge :value="r.rating" overlay /></div>
                  </PosterImage>
                  <p class="text-sm font-medium mt-1.5 line-clamp-2 leading-snug">{{ r.title }}</p>
                  <p class="text-xs text-muted">{{ r.year ?? '—' }}<template v-if="r.sizeGb"> · {{ formatSize(r.sizeGb) }}</template></p>
                </button>
                <UButton
                  class="absolute top-1.5 left-1.5 sm:opacity-0 sm:group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
                  size="xs"
                  color="neutral"
                  variant="solid"
                  icon="i-lucide-eye-off"
                  label="Ignorer"
                  :loading="ignoring === r.id"
                  @click.stop="ignore(r.id, r.title)"
                />
              </div>
            </div>
            <div v-if="result && result.total > PAGE_SIZE" class="flex justify-center">
              <UPagination v-model:page="page" :total="result.total" :items-per-page="PAGE_SIZE" />
            </div>
          </template>
          <div v-else-if="!selected.unavailable" class="text-center py-10">
            <UIcon name="i-lucide-party-popper" class="size-10 text-success mx-auto" />
            <p class="text-muted mt-2">Rien à signaler ici.</p>
          </div>
        </section>
        <div v-else class="text-center py-16">
          <UIcon name="i-lucide-circle-check-big" class="size-12 text-success mx-auto" />
          <p class="font-medium mt-3">Tout est en ordre</p>
          <p class="text-sm text-muted">Aucun problème détecté. Crée une règle pour aller plus loin.</p>
        </div>
      </div>
    </div>

    <USlideover v-model:open="exceptionsOpen" title="Titres ignorés" description="Ils n'apparaissent plus dans le signalement indiqué. « Rétablir » les y remet.">
      <template #body>
        <ul v-if="exceptions.length" class="divide-y divide-default">
          <li v-for="e in exceptions" :key="e.id" class="flex items-center gap-3 py-2.5">
            <div class="min-w-0 flex-1">
              <p class="text-sm font-medium truncate">{{ e.title }}</p>
              <p class="text-xs text-muted truncate">{{ e.sourceTitle }} · le {{ formatDate(e.createdAt) }}</p>
            </div>
            <UButton size="xs" variant="soft" label="Rétablir" icon="i-lucide-undo-2" @click="restore(e.id)" />
          </li>
        </ul>
        <p v-else class="text-sm text-muted">Aucun titre ignoré.</p>
      </template>
    </USlideover>

    <ItemDetail v-model:id="detailId" />
  </AppPage>
</template>
