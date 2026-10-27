<script setup lang="ts">
import { KIND_LABELS, isArrKind, statusLabel, type InstanceDto } from '#shared/instances'
import type { SyncInstanceResult } from '#shared/sync'
import { formatDateTime, formatRelative } from '#shared/format'

const props = defineProps<{ instance: InstanceDto; result?: SyncInstanceResult; testing?: boolean }>()
const emit = defineEmits<{ edit: []; test: []; toggle: []; remove: [] }>()

const i = computed(() => props.instance)
const info = computed(() => SERVICES[i.value.kind])
const tone = computed(() => {
  if (!i.value.enabled) return { color: 'neutral' as const, icon: 'i-lucide-pause', label: 'désactivée' }
  if (i.value.lastStatus === 'erreur') return { color: 'error' as const, icon: 'i-lucide-circle-x', label: statusLabel(i.value) }
  if (i.value.stale || i.value.lastStatus === 'perime') return { color: 'warning' as const, icon: 'i-lucide-clock-alert', label: statusLabel(i.value) }
  if (i.value.lastStatus === 'ok') return { color: 'success' as const, icon: 'i-lucide-circle-check', label: statusLabel(i.value) }
  return { color: 'neutral' as const, icon: 'i-lucide-circle-dashed', label: statusLabel(i.value) }
})
/** Problème de chemins à montrer : rien de détecté, ou des titres dont le dossier n'est pas retrouvé. */
const pathProblem = computed(() => {
  if (!i.value.enabled) return null
  if (i.value.pathCount === 0) return isArrKind(i.value.kind)
    ? 'Sortarr n\'a pas retrouvé les dossiers de cette instance sous /media : il ne peut pas vérifier les fichiers sur le disque.'
    : 'Sortarr n\'a pas retrouvé les dossiers des bibliothèques sous /media : les titres seront reliés seulement par leurs identifiants.'
  if (props.result?.ok && props.result.unmapped > 0) return `${props.result.unmapped} titre(s) dans un dossier que Sortarr ne retrouve pas sous /media.`
  return null
})
const menu = computed(() => [
  [
    { label: 'Modifier', icon: 'i-lucide-pencil', onSelect: () => emit('edit') },
    { label: 'Chemins des dossiers (avancé)', icon: 'i-lucide-folder-tree', to: `/reglages/chemins?instance=${i.value.id}` },
    { label: i.value.enabled ? 'Désactiver' : 'Activer', icon: 'i-lucide-power', onSelect: () => emit('toggle') },
  ],
  [{ label: 'Supprimer', icon: 'i-lucide-trash-2', color: 'error' as const, onSelect: () => emit('remove') }],
])
</script>

<template>
  <UCard :ui="{ body: 'p-4 sm:p-4 space-y-3' }" :class="{ 'opacity-60': !i.enabled }">
    <div class="flex items-start gap-3">
      <ServiceLogo :kind="i.kind" />
      <div class="min-w-0 flex-1">
        <p class="font-semibold truncate">{{ i.name }}</p>
        <p class="text-xs text-muted">{{ KIND_LABELS[i.kind] }} · {{ info.role }}</p>
      </div>
      <UDropdownMenu :items="menu" :content="{ align: 'end' }">
        <UButton icon="i-lucide-ellipsis-vertical" color="neutral" variant="ghost" size="sm" aria-label="Actions" />
      </UDropdownMenu>
    </div>

    <div class="flex flex-wrap items-center gap-2">
      <UBadge :color="tone.color" variant="subtle" :icon="tone.icon" :label="tone.label" />
      <UBadge v-if="i.version" color="neutral" variant="outline" :label="`v${i.version}`" />
    </div>

    <dl class="grid grid-cols-2 gap-2 text-sm">
      <div class="rounded-lg bg-elevated/50 px-3 py-2">
        <dt class="text-xs text-muted">Titres</dt>
        <dd class="font-semibold tabular-nums">{{ result?.ok ? result.items.toLocaleString('fr-FR') : '—' }}</dd>
      </div>
      <div class="rounded-lg bg-elevated/50 px-3 py-2" :title="formatDateTime(i.lastSyncAt)">
        <dt class="text-xs text-muted">Dernière synchro</dt>
        <dd class="font-semibold">{{ formatRelative(i.lastSyncAt) }}</dd>
      </div>
    </dl>

    <p class="text-xs text-muted truncate font-mono" :title="i.url">{{ i.url }}</p>

    <UAlert v-if="i.lastError && i.enabled" color="error" variant="subtle" icon="i-lucide-triangle-alert" :description="i.lastError" :ui="{ description: 'text-xs break-words' }" />
    <UAlert
      v-if="pathProblem"
      color="warning"
      variant="subtle"
      icon="i-lucide-folder-search"
      :description="pathProblem"
      :ui="{ description: 'text-xs' }"
      :actions="[{ label: 'Régler les dossiers', size: 'xs', color: 'warning', variant: 'outline', to: `/reglages/chemins?instance=${i.id}` }]"
    />

    <div class="flex gap-2 pt-1">
      <UButton label="Tester" icon="i-lucide-plug-zap" size="sm" variant="soft" :loading="testing" @click="emit('test')" />
      <UButton label="Modifier" icon="i-lucide-pencil" size="sm" color="neutral" variant="ghost" @click="emit('edit')" />
    </div>
  </UCard>
</template>
