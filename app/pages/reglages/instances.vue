<script setup lang="ts">
import { h, resolveComponent } from 'vue'
import type { TableColumn } from '@nuxt/ui'
import { KIND_LABELS, statusDot, statusLabel, type InstanceDto, type TestResult } from '#shared/instances'
import { formatDateTime } from '#shared/format'

const UBadge = resolveComponent('UBadge')
const UButton = resolveComponent('UButton')
const UDropdownMenu = resolveComponent('UDropdownMenu')

const api = useApi()
const toast = useToast()
const instances = useState<InstanceDto[]>('instances', () => [])
const loading = ref(true)

async function refresh() {
  loading.value = true
  try {
    instances.value = await api<InstanceDto[]>('/api/instances')
  } catch (e) {
    toast.add({ title: 'Instances indisponibles', description: errorMessage(e), color: 'error' })
  } finally {
    loading.value = false
  }
}

// Formulaire d'ajout / édition
const formOpen = ref(false)
const editing = ref<InstanceDto | null>(null)
const formKey = ref(0)
function openForm(instance: InstanceDto | null) {
  editing.value = instance
  formKey.value++
  formOpen.value = true
}
async function onSaved(instance: InstanceDto, created: boolean) {
  formOpen.value = false
  await refresh()
  toast.add(created
    ? { title: `${instance.name} ajoutée`, description: 'Configure maintenant la correspondance des chemins.', color: 'success', actions: [{ label: 'Configurer les chemins', to: `/reglages/chemins?instance=${instance.id}` }] }
    : { title: `${instance.name} enregistrée`, color: 'success' })
}

async function test(instance: InstanceDto) {
  toast.add({ title: `${instance.name} : test en cours…`, color: 'neutral' })
  try {
    const r = await api<TestResult>('/api/instances/test', { method: 'POST', body: { id: instance.id, kind: instance.kind, url: instance.url } })
    toast.add(r.ok
      ? { title: `${instance.name} : connexion réussie`, description: `Version ${r.discovery.version}`, color: 'success' }
      : { title: `${instance.name} : connexion impossible`, description: r.error, color: 'error' })
  } catch (e) {
    toast.add({ title: 'Test impossible', description: errorMessage(e), color: 'error' })
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

const columns: TableColumn<InstanceDto>[] = [
  {
    accessorKey: 'name',
    header: 'Instance',
    cell: ({ row }) => h('div', [
      h('p', { class: 'font-medium' }, row.original.name),
      h('p', { class: 'text-xs text-muted' }, row.original.url),
    ]),
  },
  {
    accessorKey: 'kind',
    header: 'Type',
    cell: ({ row }) => h(UBadge, { variant: 'subtle', color: 'neutral' }, () => KIND_LABELS[row.original.kind]),
  },
  {
    accessorKey: 'lastStatus',
    header: 'État',
    cell: ({ row }) => h('div', { class: 'flex items-center gap-2 max-w-80' }, [
      h('span', { class: ['block size-2.5 shrink-0 rounded-full', row.original.enabled ? statusDot(row.original) : 'bg-neutral-300'] }),
      h('span', { class: 'text-sm' }, row.original.enabled ? statusLabel(row.original) : 'désactivée'),
      row.original.lastError ? h('span', { class: 'text-xs text-error truncate', title: row.original.lastError }, row.original.lastError) : null,
    ]),
  },
  { accessorKey: 'version', header: 'Version', cell: ({ row }) => row.original.version ?? '—' },
  { accessorKey: 'lastSyncAt', header: 'Dernière synchro', cell: ({ row }) => formatDateTime(row.original.lastSyncAt) },
  {
    id: 'actions',
    meta: { class: { td: 'text-right' } },
    cell: ({ row }) => h(UDropdownMenu, {
      content: { align: 'end' },
      items: [
        [
          { label: 'Modifier', icon: 'i-lucide-pencil', onSelect: () => openForm(row.original) },
          { label: 'Tester la connexion', icon: 'i-lucide-plug-zap', onSelect: () => test(row.original) },
          { label: 'Chemins', icon: 'i-lucide-folder-tree', to: `/reglages/chemins?instance=${row.original.id}` },
          { label: row.original.enabled ? 'Désactiver' : 'Activer', icon: 'i-lucide-power', onSelect: () => toggle(row.original) },
        ],
        [{ label: 'Supprimer', icon: 'i-lucide-trash-2', color: 'error', onSelect: () => { toDelete.value = row.original } }],
      ],
    }, () => h(UButton, { icon: 'i-lucide-ellipsis-vertical', color: 'neutral', variant: 'ghost', 'aria-label': 'Actions' })),
  },
]
</script>

<template>
  <AppPage title="Instances">
    <div class="space-y-4">
      <div class="flex justify-between items-center">
        <p class="text-sm text-muted">Radarr, Sonarr, Plex et Jellyfin : ajoute autant d'instances que nécessaire.</p>
        <UButton icon="i-lucide-plus" label="Ajouter une instance" @click="openForm(null)" />
      </div>

      <UTable :data="instances" :columns="columns" :loading="loading">
        <template #empty>
          <p class="text-center text-muted py-8">Aucune instance pour l'instant.</p>
        </template>
      </UTable>
    </div>

    <USlideover v-model:open="formOpen" :title="editing ? `Modifier ${editing.name}` : 'Ajouter une instance'">
      <template #body>
        <InstanceForm :key="formKey" :instance="editing" @saved="onSaved" @cancel="formOpen = false" />
      </template>
    </USlideover>

    <UModal :open="toDelete !== null" title="Supprimer l'instance ?" @update:open="(open: boolean) => { if (!open) toDelete = null }">
      <template #body>
        <p>
          « {{ toDelete?.name }} » sera retirée de Sortarr, avec ses correspondances de chemins et ses données synchronisées.
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
