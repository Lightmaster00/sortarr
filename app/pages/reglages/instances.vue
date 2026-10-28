<script setup lang="ts">
import { KIND_LABELS, isArrKind, type InstanceDto, type InstanceKind, type TestResult } from '#shared/instances'

const api = useApi()
const toast = useToast()
const instances = useState<InstanceDto[]>('instances', () => [])
const { state: sync } = useSyncState()
const loading = ref(true)
const showHelp = ref(false)

async function refresh() {
  try {
    instances.value = await api<InstanceDto[]>('/api/instances')
  } catch (e) {
    toast.add({ title: 'Instances indisponibles', description: errorMessage(e), color: 'error' })
  } finally {
    loading.value = false
  }
}

const managers = computed(() => instances.value.filter(i => isArrKind(i.kind)))
const servers = computed(() => instances.value.filter(i => !isArrKind(i.kind)))
const resultOf = (id: number) => sync.value?.results.find(r => r.instanceId === id)

// Formulaire d'ajout / édition
const formOpen = ref(false)
const editing = ref<InstanceDto | null>(null)
const presetKind = ref<InstanceKind | null>(null)
const formKey = ref(0)
function openForm(instance: InstanceDto | null, kind: InstanceKind | null = null) {
  editing.value = instance
  presetKind.value = kind
  formKey.value++
  formOpen.value = true
}
async function onSaved(instance: InstanceDto, created: boolean) {
  formOpen.value = false
  await refresh()
  const saved = instances.value.find(i => i.id === instance.id) ?? instance
  if (!created) {
    toast.add({ title: `${saved.name} enregistrée`, color: 'success' })
    return
  }
  toast.add(saved.pathCount > 0
    ? { title: `${saved.name} ajoutée`, description: 'Ses dossiers ont été retrouvés automatiquement. Lance une synchro pour remplir le catalogue.', color: 'success', icon: 'i-lucide-circle-check' }
    : { title: `${saved.name} ajoutée`, description: 'Ses dossiers n\'ont pas été retrouvés dans les dossiers de médias : vérifie les volumes montés, ou règle-les à la main.', color: 'warning', actions: [{ label: 'Régler les dossiers', to: `/reglages/chemins?instance=${saved.id}` }] })
}

const testingId = ref<number | null>(null)
async function test(instance: InstanceDto) {
  testingId.value = instance.id
  try {
    const r = await api<TestResult>('/api/instances/test', { method: 'POST', body: { id: instance.id, kind: instance.kind, url: instance.url } })
    toast.add(r.ok
      ? { title: `${instance.name} : connexion réussie`, description: `Version ${r.discovery.version}`, color: 'success' }
      : { title: `${instance.name} : connexion impossible`, description: r.error, color: 'error', duration: 15_000 })
  } catch (e) {
    toast.add({ title: 'Test impossible', description: errorMessage(e), color: 'error' })
  } finally {
    testingId.value = null
  }
  await refresh()
}

async function toggle(instance: InstanceDto) {
  try {
    await api(`/api/instances/${instance.id}`, { method: 'PUT', body: { name: instance.name, url: instance.url, enabled: !instance.enabled } })
    await refresh()
  } catch (e) {
    toast.add({ title: 'Modification impossible', description: errorMessage(e), color: 'error' })
  }
}

// Suppression
const toDelete = ref<InstanceDto | null>(null)
const deleting = ref(false)
async function confirmDelete() {
  if (!toDelete.value) return
  deleting.value = true
  try {
    await api(`/api/instances/${toDelete.value.id}`, { method: 'DELETE' })
    toast.add({ title: `${toDelete.value.name} supprimée`, color: 'success' })
    toDelete.value = null
    await refresh()
  } catch (e) {
    toast.add({ title: 'Suppression impossible', description: errorMessage(e), color: 'error' })
  } finally {
    deleting.value = false
  }
}

onMounted(refresh)
onSyncFinished(refresh)

const SECTIONS = [
  { key: 'managers', title: 'Gestionnaires', hint: 'Radarr et Sonarr : ce que tu possèdes.', kinds: ['radarr', 'sonarr'] as InstanceKind[] },
  { key: 'servers', title: 'Serveurs média', hint: 'Plex et Jellyfin : ce qui est visible et ce qui a été regardé.', kinds: ['plex', 'jellyfin'] as InstanceKind[] },
] as const
const listOf = (key: 'managers' | 'servers') => (key === 'managers' ? managers.value : servers.value)
</script>

<template>
  <AppPage
    title="Instances"
    icon="i-lucide-server"
    description="Branche ici tes services. Sortarr lit leurs informations (sans jamais rien modifier) et retrouve tout seul leurs dossiers sur le disque."
  >
    <template #actions>
      <UButton label="Comment ça marche ?" icon="i-lucide-circle-help" color="neutral" variant="ghost" @click="showHelp = !showHelp" />
      <UButton icon="i-lucide-plus" label="Ajouter une instance" @click="openForm(null)" />
    </template>

    <div class="space-y-8">
      <UCard v-if="showHelp || (!loading && !instances.length)">
        <HowItWorks />
      </UCard>

      <section v-for="s in SECTIONS" :key="s.key" class="space-y-3">
        <div class="flex flex-wrap items-baseline gap-x-3">
          <h2 class="text-base font-semibold">{{ s.title }}</h2>
          <p class="text-sm text-muted">{{ s.hint }}</p>
        </div>
        <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <InstanceCard
            v-for="i in listOf(s.key)"
            :key="i.id"
            :instance="i"
            :result="resultOf(i.id)"
            :testing="testingId === i.id"
            @edit="openForm(i)"
            @test="test(i)"
            @toggle="toggle(i)"
            @remove="toDelete = i"
          />
          <button
            v-for="kind in s.kinds"
            :key="kind"
            type="button"
            class="group rounded-xl border-2 border-dashed border-default hover:border-primary/60 hover:bg-primary/5 transition-colors p-4 flex items-center gap-3 text-left min-h-24"
            @click="openForm(null, kind)"
          >
            <ServiceLogo :kind="kind" />
            <span>
              <span class="block font-medium text-sm group-hover:text-primary">Ajouter {{ KIND_LABELS[kind] }}</span>
              <span class="block text-xs text-muted">{{ SERVICES[kind].description }}</span>
            </span>
          </button>
        </div>
      </section>
    </div>

    <USlideover v-model:open="formOpen" :title="editing ? `Modifier ${editing.name}` : 'Ajouter une instance'" :description="editing ? undefined : 'Trois informations suffisent : le type, l\'adresse et la clé API.'">
      <template #body>
        <InstanceForm :key="formKey" :instance="editing" :preset-kind="presetKind" @saved="onSaved" @cancel="formOpen = false" />
      </template>
    </USlideover>

    <UModal :open="toDelete !== null" title="Supprimer l'instance ?" @update:open="(open: boolean) => { if (!open) toDelete = null }">
      <template #body>
        <p>
          « {{ toDelete?.name }} » sera retirée de Sortarr, avec ses données synchronisées.
          Rien n'est modifié dans {{ toDelete ? KIND_LABELS[toDelete.kind] : '' }}.
        </p>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2 w-full">
          <UButton label="Annuler" color="neutral" variant="ghost" @click="toDelete = null" />
          <UButton label="Supprimer" color="error" :loading="deleting" @click="confirmDelete" />
        </div>
      </template>
    </UModal>
  </AppPage>
</template>
