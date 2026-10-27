<script setup lang="ts">
import { SEVERITY_COLORS, SEVERITY_LABELS, type RuleDto } from '#shared/rules'
import { formatSize } from '#shared/format'

type RuleRow = RuleDto & { count: number | null; sizeGb: number | null; unavailable: string | null }

const api = useApi()
const toast = useToast()
const { refresh: refreshIssues } = useIssues()
const rules = ref<RuleRow[] | null>(null)

async function load() {
  try {
    rules.value = await api<RuleRow[]>('/api/rules')
  } catch (e) {
    toast.add({ title: 'Règles indisponibles', description: errorMessage(e), color: 'error' })
  }
}
onMounted(load)
onSyncFinished(load)

async function toggle(rule: RuleRow, enabled: boolean) {
  try {
    await api(`/api/rules/${rule.id}`, { method: 'PATCH', body: { enabled } })
    await Promise.all([load(), refreshIssues()])
  } catch (e) {
    toast.add({ title: 'Modification impossible', description: errorMessage(e), color: 'error' })
  }
}

const toDelete = ref<RuleRow | null>(null)
async function confirmDelete() {
  if (!toDelete.value) return
  try {
    await api(`/api/rules/${toDelete.value.id}`, { method: 'DELETE' })
    toast.add({ title: `Règle « ${toDelete.value.name} » supprimée`, color: 'success' })
    toDelete.value = null
    await Promise.all([load(), refreshIssues()])
  } catch (e) {
    toast.add({ title: 'Suppression impossible', description: errorMessage(e), color: 'error' })
  }
}
</script>

<template>
  <AppPage
    title="Règles"
    icon="i-lucide-list-checks"
    description="Une règle décrit ce que tu ne veux pas voir dans ta médiathèque. Chaque titre qui y correspond apparaît dans « À traiter ». Pour l'instant les règles signalent seulement : elles ne suppriment et ne déplacent rien."
  >
    <template #actions>
      <UButton v-if="rules?.length" label="Nouvelle règle" icon="i-lucide-plus" to="/regles/nouvelle" />
    </template>

    <p v-if="!rules" class="text-muted">Chargement…</p>

    <div v-else-if="!rules.length" class="space-y-4">
      <p class="font-medium">Par quoi commencer ?</p>
      <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <NuxtLink
          v-for="t in TEMPLATES"
          :key="t.key"
          :to="`/regles/nouvelle?modele=${t.key}`"
          class="group rounded-xl border border-default p-4 hover:border-primary/60 hover:bg-primary/5 transition-colors"
        >
          <span class="inline-flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary mb-3"><UIcon :name="t.icon" class="size-5" /></span>
          <p class="font-semibold group-hover:text-primary">{{ t.label }}</p>
          <p class="text-sm text-muted mt-1">{{ t.pitch }}</p>
          <p class="text-xs text-dimmed mt-2 italic">Ex. : {{ t.example }}</p>
        </NuxtLink>
      </div>
    </div>

    <ul v-else class="space-y-2">
      <li v-for="r in rules" :key="r.id" class="rounded-xl border border-default p-3 sm:p-4 flex flex-wrap items-center gap-3" :class="{ 'opacity-60': !r.enabled }">
        <span class="inline-flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <UIcon :name="TEMPLATE_BY_KEY[r.template].icon" class="size-5" />
        </span>
        <div class="min-w-0 flex-1">
          <NuxtLink :to="`/regles/${r.id}`" class="font-medium hover:text-primary">{{ r.name }}</NuxtLink>
          <p class="text-xs text-muted">
            {{ TEMPLATE_BY_KEY[r.template].label }}
            <template v-if="r.description"> · {{ r.description }}</template>
          </p>
        </div>
        <UBadge :color="SEVERITY_COLORS[r.severity]" variant="subtle" :label="SEVERITY_LABELS[r.severity]" />
        <NuxtLink
          v-if="r.enabled && r.count !== null && !r.unavailable"
          :to="`/a-traiter?groupe=rule:${r.id}`"
          class="text-sm tabular-nums rounded-lg px-2.5 py-1 hover:bg-elevated"
          :title="`Voir les ${r.count} titres signalés`"
        >
          <span class="font-semibold">{{ r.count.toLocaleString('fr-FR') }}</span> <span class="text-muted">titres · {{ formatSize(r.sizeGb ?? 0) }}</span>
        </NuxtLink>
        <UTooltip v-else-if="r.unavailable" :text="r.unavailable"><span class="text-xs text-muted">en attente</span></UTooltip>
        <USwitch :model-value="r.enabled" :aria-label="r.enabled ? 'Désactiver' : 'Activer'" @update:model-value="(v: boolean) => toggle(r, v)" />
        <UDropdownMenu :items="[[{ label: 'Modifier', icon: 'i-lucide-pencil', to: `/regles/${r.id}` }], [{ label: 'Supprimer', icon: 'i-lucide-trash-2', color: 'error', onSelect: () => { toDelete = r } }]]" :content="{ align: 'end' }">
          <UButton icon="i-lucide-ellipsis-vertical" color="neutral" variant="ghost" size="sm" aria-label="Actions" />
        </UDropdownMenu>
      </li>
    </ul>

    <UModal :open="toDelete !== null" title="Supprimer la règle ?" @update:open="(open: boolean) => { if (!open) toDelete = null }">
      <template #body>
        <p>« {{ toDelete?.name }} » et ses titres ignorés seront supprimés. Aucun média n'est touché.</p>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2 w-full">
          <UButton label="Annuler" color="neutral" variant="ghost" @click="toDelete = null" />
          <UButton label="Supprimer" color="error" @click="confirmDelete" />
        </div>
      </template>
    </UModal>
  </AppPage>
</template>
