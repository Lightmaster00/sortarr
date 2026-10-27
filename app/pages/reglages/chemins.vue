<script setup lang="ts">
import { KIND_LABELS, isArrKind, type InstanceDto } from '#shared/instances'
import type { PathCheck, PathMapping, PathSuggestion } from '#shared/paths'

interface OtherEntry { instanceId: number; name: string; mappings: { realPath: string; managed: boolean }[] }
interface Row { servicePath: string; realPath: string; managed: boolean; label?: string }

const route = useRoute()
const api = useApi()
const toast = useToast()
const instances = useState<InstanceDto[]>('instances', () => [])
const selectedId = ref<number | undefined>(route.query.instance ? Number(route.query.instance) : undefined)
const rows = ref<Row[]>([])
const loaded = ref(false)
const mediaRootDir = ref('')
const checks = ref<PathCheck[] | null>(null)
const othersPaths = ref<OtherEntry[]>([])
const busy = ref<'load' | 'suggest' | 'save' | 'verify' | null>(null)

const instanceItems = computed(() => instances.value.map(i => ({ label: `${i.name} (${KIND_LABELS[i.kind]})`, value: i.id })))
const selected = computed(() => instances.value.find(i => i.id === selectedId.value) ?? null)
const locked = computed(() => !selected.value || !loaded.value)
const isArr = computed(() => (selected.value ? isArrKind(selected.value.kind) : false))
const example = computed(() => (rows.value.find(r => r.servicePath && r.realPath) ?? { servicePath: '/movies', realPath: `${mediaRootDir.value || '/media'}/films` }))

function normalize(p: string) {
  return p.trim().replace(/\/+$/, '')
}

function setOwnEntry(id: number, mappings: PathMapping[]) {
  const name = instances.value.find(i => i.id === id)?.name ?? ''
  const entry: OtherEntry = { instanceId: id, name, mappings: mappings.map(m => ({ realPath: normalize(m.realPath), managed: m.managed })) }
  othersPaths.value = [...othersPaths.value.filter(o => o.instanceId !== id), entry]
}

async function load() {
  const id = selectedId.value
  rows.value = []
  checks.value = null
  loaded.value = false
  if (!id) return
  busy.value = 'load'
  try {
    const mappings = await api<PathMapping[]>(`/api/instances/${id}/paths`)
    if (selectedId.value !== id) return
    rows.value = mappings.map(m => ({ servicePath: m.servicePath, realPath: m.realPath, managed: m.managed }))
    setOwnEntry(id, mappings)
    loaded.value = true
  } catch (e) {
    if (selectedId.value !== id) return
    toast.add({ title: 'Chemins indisponibles', description: errorMessage(e), color: 'error' })
  } finally {
    if (selectedId.value === id) busy.value = null
  }
}

async function suggest() {
  const id = selectedId.value
  if (!id) return
  busy.value = 'suggest'
  try {
    const r = await api<{ mediaRoot: string; suggestions: PathSuggestion[] }>(`/api/instances/${id}/paths/suggest`, { method: 'POST' })
    if (selectedId.value !== id) return
    for (const s of r.suggestions) {
      const row = rows.value.find(x => x.servicePath === s.servicePath)
      if (row) {
        row.label = s.label
        if (!row.realPath && s.realPath) row.realPath = s.realPath
      } else {
        rows.value.push({ servicePath: s.servicePath, realPath: s.realPath ?? '', managed: s.managed, label: s.label })
      }
    }
    const missing = rows.value.filter(x => !x.realPath.trim()).length
    toast.add(missing
      ? { title: `${missing} chemin(s) sans suggestion`, description: `Complète-les à la main avec un dossier sous ${r.mediaRoot}.`, color: 'warning' }
      : { title: 'Suggestions ajoutées', description: 'Vérifie-les puis enregistre.', color: 'success' })
  } catch (e) {
    if (selectedId.value !== id) return
    toast.add({ title: 'Suggestions impossibles', description: errorMessage(e), color: 'error' })
  } finally {
    if (selectedId.value === id) busy.value = null
  }
}

async function save() {
  const id = selectedId.value
  if (!id) return
  const filled = rows.value.filter(r => r.servicePath.trim() || r.realPath.trim())
  if (filled.some(r => !r.servicePath.trim() || !r.realPath.trim())) {
    toast.add({ title: 'Lignes incomplètes', description: 'Chaque ligne doit avoir un chemin de service et un chemin réel.', color: 'warning' })
    return
  }
  busy.value = 'save'
  try {
    const saved = await api<PathMapping[]>(`/api/instances/${id}/paths`, {
      method: 'PUT',
      body: { mappings: filled.map(r => ({ servicePath: r.servicePath.trim(), realPath: r.realPath.trim(), managed: r.managed })) },
    })
    if (selectedId.value !== id) return
    rows.value = saved.map(m => ({ servicePath: m.servicePath, realPath: m.realPath, managed: m.managed, label: rows.value.find(r => r.servicePath === m.servicePath)?.label }))
    setOwnEntry(id, saved)
    checks.value = null
    toast.add({ title: 'Chemins enregistrés', description: 'Ils seront utilisés à la prochaine synchro.', color: 'success' })
  } catch (e) {
    if (selectedId.value !== id) return
    toast.add({ title: 'Enregistrement impossible', description: errorMessage(e), color: 'error' })
  } finally {
    if (selectedId.value === id) busy.value = null
  }
}

async function verify() {
  const id = selectedId.value
  if (!id) return
  busy.value = 'verify'
  try {
    const r = await api<{ ok: boolean; checks: PathCheck[] }>(`/api/instances/${id}/paths/verify`, { method: 'POST' })
    if (selectedId.value !== id) return
    checks.value = r.checks
  } catch (e) {
    if (selectedId.value !== id) return
    toast.add({ title: 'Vérification impossible', description: errorMessage(e), color: 'error' })
  } finally {
    if (selectedId.value === id) busy.value = null
  }
}

/** Un même dossier géré par deux *arr du même type (radarr↔radarr, sonarr↔sonarr) mérite un avertissement. */
function usedBy(row: Row): string | null {
  const real = normalize(row.realPath)
  const kind = selected.value?.kind
  if (!real || !row.managed || !kind) return null
  const kindOf = (id: number) => instances.value.find(i => i.id === id)?.kind
  const other = othersPaths.value.find(o => o.instanceId !== selectedId.value && kindOf(o.instanceId) === kind && o.mappings.some(m => m.managed && m.realPath === real))
  return other?.name ?? null
}

async function loadOthers() {
  const results = await Promise.all(instances.value.map(async (i): Promise<OtherEntry> => {
    try {
      const m = await api<PathMapping[]>(`/api/instances/${i.id}/paths`)
      return { instanceId: i.id, name: i.name, mappings: m.map(x => ({ realPath: normalize(x.realPath), managed: x.managed })) }
    } catch {
      return { instanceId: i.id, name: i.name, mappings: [] }
    }
  }))
  // Les entrées déjà à jour (chargées ou enregistrées entre-temps) priment.
  const known = new Set(othersPaths.value.map(o => o.instanceId))
  othersPaths.value = [...othersPaths.value, ...results.filter(r => !known.has(r.instanceId))]
}

function addRow() {
  rows.value.push({ servicePath: '', realPath: '', managed: true })
}

function removeRow(index: number) {
  rows.value.splice(index, 1)
}

watch(selectedId, (id) => {
  void navigateTo({ query: id ? { ...route.query, instance: String(id) } : { ...route.query, instance: undefined } }, { replace: true })
  void load()
})

onMounted(async () => {
  try {
    if (!instances.value.length) instances.value = await api<InstanceDto[]>('/api/instances')
    mediaRootDir.value = (await api<{ mediaRoot: string }>('/api/settings/general')).mediaRoot
  } catch (e) {
    toast.add({ title: 'Chargement impossible', description: errorMessage(e), color: 'error' })
  }
  void loadOthers()
  const valid = selectedId.value !== undefined && instances.value.some(i => i.id === selectedId.value)
  if (valid) void load()
  else if (instances.value[0]) selectedId.value = instances.value[0].id
  else selectedId.value = undefined
})
</script>

<template>
  <AppPage
    title="Dossiers"
    icon="i-lucide-folder-tree"
    description="Réglage avancé, normalement automatique. Chaque service voit tes dossiers sous un nom différent : Sortarr doit savoir à quel dossier du disque correspond chacun d'eux pour relier les titres et vérifier les fichiers."
  >
    <template #actions>
      <UButton label="Retour aux instances" icon="i-lucide-arrow-left" color="neutral" variant="ghost" to="/reglages/instances" />
    </template>

    <div class="space-y-4 max-w-5xl">
      <UCard :ui="{ body: 'p-4 sm:p-4' }">
        <p class="text-xs font-medium text-muted mb-3">Exemple</p>
        <div class="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 text-sm">
          <div class="flex items-center gap-2 rounded-lg border border-default px-3 py-2 min-w-0">
            <ServiceLogo v-if="selected" :kind="selected.kind" size="sm" />
            <div class="min-w-0">
              <p class="text-xs text-muted">{{ selected?.name ?? 'Le service' }} voit</p>
              <p class="font-mono truncate">{{ example.servicePath }}</p>
            </div>
          </div>
          <UIcon name="i-lucide-arrow-right" class="size-5 text-primary self-center rotate-90 sm:rotate-0 shrink-0" />
          <div class="flex items-center gap-2 rounded-lg border-2 border-primary/50 bg-primary/5 px-3 py-2 min-w-0">
            <img src="/icon.svg" alt="" class="size-7 shrink-0">
            <div class="min-w-0">
              <p class="text-xs text-muted">Sortarr lit sur le disque</p>
              <p class="font-mono truncate">{{ example.realPath }}</p>
            </div>
          </div>
        </div>
      </UCard>

      <div class="flex flex-wrap items-center gap-2">
        <USelect v-model="selectedId" :items="instanceItems" placeholder="Choisis une instance" class="w-72" :disabled="busy === 'suggest' || busy === 'save'" />
        <UButton icon="i-lucide-wand-sparkles" label="Détecter automatiquement" variant="soft" :loading="busy === 'suggest'" :disabled="locked" @click="suggest" />
        <div class="ml-auto flex gap-2">
          <UButton icon="i-lucide-search-check" label="Vérifier sur le disque" variant="outline" :loading="busy === 'verify'" :disabled="locked" @click="verify" />
          <UButton icon="i-lucide-save" label="Enregistrer" :loading="busy === 'save'" :disabled="locked" @click="save" />
        </div>
      </div>

      <UCard v-if="selected">
        <div class="grid gap-x-3 gap-y-2 items-center" :class="isArr ? 'grid-cols-[1fr_auto_1fr_auto_auto]' : 'grid-cols-[1fr_auto_1fr_auto]'">
          <span class="text-xs font-medium text-muted">Dossier vu par {{ selected.name }}</span>
          <span />
          <span class="text-xs font-medium text-muted">Dossier sur le disque (sous {{ mediaRootDir }})</span>
          <UTooltip v-if="isArr" text="Décoche pour un dossier que Radarr/Sonarr ne doit pas gérer : son contenu ne sera pas signalé comme orphelin.">
            <span class="text-xs font-medium text-muted inline-flex items-center gap-1">Géré <UIcon name="i-lucide-circle-help" class="size-3.5" /></span>
          </UTooltip>
          <span />
          <template v-for="(row, index) in rows" :key="index">
            <div>
              <UInput v-model="row.servicePath" placeholder="/movies" class="w-full font-mono" />
              <p v-if="row.label && row.label !== row.servicePath" class="text-xs text-muted mt-0.5">{{ row.label }}</p>
            </div>
            <UIcon name="i-lucide-arrow-right" class="size-4 text-muted" />
            <div>
              <UInput v-model="row.realPath" :placeholder="`${mediaRootDir}/movies`" class="w-full font-mono" :color="row.realPath ? undefined : 'warning'" :highlight="!row.realPath" />
              <p v-if="!row.realPath" class="text-xs text-warning mt-0.5">Introuvable automatiquement : indique le dossier.</p>
              <p v-if="usedBy(row)" class="text-xs text-warning mt-0.5">Déjà utilisé par {{ usedBy(row) }}</p>
            </div>
            <USwitch v-if="isArr" v-model="row.managed" :aria-label="`Dossier ${row.servicePath} géré`" />
            <UButton icon="i-lucide-trash-2" color="neutral" variant="ghost" aria-label="Supprimer la ligne" @click="removeRow(index)" />
          </template>
        </div>
        <div v-if="!rows.length" class="py-6 text-center space-y-2">
          <UIcon name="i-lucide-folder-search" class="size-8 text-muted mx-auto" />
          <p class="text-sm text-muted">Aucun dossier pour l'instant. Clique sur « Détecter automatiquement ».</p>
        </div>
        <UButton class="mt-3" icon="i-lucide-plus" label="Ajouter une ligne à la main" size="sm" color="neutral" variant="ghost" :disabled="locked" @click="addRow" />
      </UCard>

      <UCard v-if="checks">
        <template #header><h2 class="font-medium">Vérification sur le disque</h2></template>
        <ul class="space-y-1 text-sm">
          <li v-for="c in checks" :key="c.servicePath" class="flex items-start gap-2">
            <UIcon :name="c.exists ? 'i-lucide-circle-check' : 'i-lucide-circle-x'" :class="c.exists ? 'text-success' : 'text-error'" class="size-4 mt-0.5 shrink-0" />
            <span><code>{{ c.servicePath }}</code> → <code>{{ c.realPath ?? '?' }}</code> — {{ c.message }}</span>
          </li>
        </ul>
        <p v-if="!checks.length" class="text-sm text-muted">Rien à vérifier : enregistre d'abord des dossiers.</p>
      </UCard>
    </div>
  </AppPage>
</template>
