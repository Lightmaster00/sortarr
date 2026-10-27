<script setup lang="ts">
import { emptyFilter, validateFilter, type FieldDef, type FilterGroup } from '#shared/filters'
import type { CatalogResult } from '#shared/catalog'
import type { InstanceDto } from '#shared/instances'
import { RULE_TEMPLATES, SEVERITIES, SEVERITY_COLORS, SEVERITY_ICONS, SEVERITY_LABELS, ruleFilterProblems, type RuleDto, type RuleTemplate, type Severity } from '#shared/rules'
import { formatSize } from '#shared/format'
import { languageLabel } from '#shared/media'

const route = useRoute()
const api = useApi()
const toast = useToast()
const { refresh: refreshIssues } = useIssues()

const ruleId = computed(() => (route.params.id === 'nouvelle' ? null : Number(route.params.id)))
const isNew = computed(() => ruleId.value === null)
const requested = typeof route.query.modele === 'string' && (RULE_TEMPLATES as readonly string[]).includes(route.query.modele) ? route.query.modele as RuleTemplate : null

const template = ref<RuleTemplate | null>(requested)
const params = ref<Record<string, unknown>>(requested ? defaultParams(requested) : {})
const custom = ref<FilterGroup>(emptyFilter())
const name = ref('')
const nameTouched = ref(false)
const description = ref('')
const severity = ref<Severity>(requested ? TEMPLATE_BY_KEY[requested].severity : 'avertissement')
const enabled = ref(true)
const fields = ref<FieldDef[]>([])
const instances = ref<InstanceDto[]>([])
const loaded = ref(false)
const saving = ref(false)

function pickTemplate(t: RuleTemplate) {
  template.value = t
  params.value = defaultParams(t)
  severity.value = TEMPLATE_BY_KEY[t].severity
  if (t === 'personnalise' && !custom.value.children.length) custom.value = emptyFilter()
}

/** Passe en « sur mesure » en gardant le filtre produit par le modèle, pour l'affiner. */
function toCustom() {
  if (!template.value) return
  custom.value = filter.value ?? emptyFilter()
  template.value = 'personnalise'
  params.value = {}
}

const optionsOf = (key: string) => fields.value.find(f => f.key === key)?.options ?? []
const languageItems = computed(() => optionsOf('originalLanguage').map(o => ({ label: o.label, value: o.value })))
const audioItems = computed(() => optionsOf('audioLanguages').map(o => ({ label: o.label, value: o.value })))
const subtitleItems = computed(() => optionsOf('subtitleLanguages').map(o => ({ label: o.label, value: o.value })))
const arrInstances = computed(() => instances.value.filter(i => i.kind === 'radarr' || i.kind === 'sonarr'))
const rangementInstances = computed(() => {
  const t = params.value.mediaType
  return arrInstances.value.filter(i => t === 'all' || (t === 'movie' ? i.kind === 'radarr' : i.kind === 'sonarr')).map(i => ({ label: i.name, value: String(i.id) }))
})
const MEDIA_TYPES = [{ label: 'Films', value: 'movie' }, { label: 'Séries', value: 'series' }, { label: 'Titres (films et séries)', value: 'all' }]

const filter = computed<FilterGroup | null>(() => (template.value ? buildFilter(template.value, params.value, custom.value) : null))
const problems = computed(() => (filter.value ? [...ruleFilterProblems(filter.value), ...validateFilter(filter.value)] : ['Complète les réglages ci-dessus.']))

const autoName = computed(() => (template.value
  ? suggestName(template.value, params.value, { language: languageLabel, instance: id => instances.value.find(i => String(i.id) === id)?.name ?? '?' })
  : ''))
watch(autoName, (n) => { if (!nameTouched.value) name.value = n }, { immediate: true })

// Aperçu en direct, calculé sur le catalogue.
const preview = ref<CatalogResult | null>(null)
const previewLoading = ref(false)
let seq = 0
let debounce: ReturnType<typeof setTimeout> | undefined
watch(filter, () => {
  clearTimeout(debounce)
  debounce = setTimeout(async () => {
    const my = ++seq
    if (!filter.value || problems.value.length) { preview.value = null; return }
    previewLoading.value = true
    try {
      const res = await api<CatalogResult>('/api/catalog/query', { method: 'POST', body: { filter: filter.value, sort: { field: 'sizeGb', dir: 'desc' }, page: 1, pageSize: 12 } })
      if (my === seq) preview.value = res
    } catch {
      if (my === seq) preview.value = null
    } finally {
      if (my === seq) previewLoading.value = false
    }
  }, 300)
}, { deep: true, immediate: true })

onMounted(async () => {
  try {
    const [f, list] = await Promise.all([api<{ fields: FieldDef[] }>('/api/catalog/fields'), api<InstanceDto[]>('/api/instances')])
    fields.value = f.fields
    instances.value = list
    if (ruleId.value !== null) {
      const rule = await api<RuleDto>(`/api/rules/${ruleId.value}`)
      template.value = rule.template
      params.value = { ...defaultParams(rule.template), ...rule.params }
      custom.value = rule.template === 'personnalise' ? rule.filter : emptyFilter()
      name.value = rule.name
      nameTouched.value = true
      description.value = rule.description
      severity.value = rule.severity
      enabled.value = rule.enabled
    } else if (template.value === 'rangement' && !params.value.instanceId) {
      params.value.instanceId = rangementInstances.value[0]?.value ?? ''
    }
  } catch (e) {
    toast.add({ title: 'Chargement impossible', description: errorMessage(e), color: 'error' })
  } finally {
    loaded.value = true
  }
})

async function save() {
  if (!template.value || !filter.value || problems.value.length) return
  saving.value = true
  try {
    const body = { name: name.value, description: description.value, template: template.value, params: params.value, filter: filter.value, severity: severity.value, enabled: enabled.value }
    const saved = isNew.value
      ? await api<RuleDto>('/api/rules', { method: 'POST', body })
      : await api<RuleDto>(`/api/rules/${ruleId.value}`, { method: 'PUT', body })
    await refreshIssues()
    toast.add({ title: `Règle « ${saved.name} » enregistrée`, description: 'Ses titres apparaissent dans « À traiter ».', color: 'success', actions: [{ label: 'Voir', to: `/a-traiter?groupe=rule:${saved.id}` }] })
    await navigateTo('/regles')
  } catch (e) {
    toast.add({ title: 'Enregistrement impossible', description: errorMessage(e), color: 'error' })
  } finally {
    saving.value = false
  }
}

/** Champ numérique facultatif : vide = critère désactivé. */
function numberParam(key: string) {
  return computed({
    get: () => (params.value[key] as number | null) ?? undefined,
    set: (v: number | undefined) => { params.value[key] = v === undefined || Number.isNaN(v) ? null : v },
  })
}
const addedDays = numberParam('addedOlderThanDays')
const notWatchedDays = numberParam('notWatchedForDays')
const maxRating = numberParam('maxRating')
const minSize = numberParam('minSizeGb')
</script>

<template>
  <AppPage :title="isNew ? 'Nouvelle règle' : 'Modifier la règle'" icon="i-lucide-list-checks" description="Décris ce que tu veux repérer : l'aperçu à droite montre immédiatement les titres concernés.">
    <template #actions>
      <UButton label="Retour aux règles" icon="i-lucide-arrow-left" color="neutral" variant="ghost" to="/regles" />
    </template>

    <div v-if="loaded" class="grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem] items-start">
      <div class="space-y-6 min-w-0">
        <!-- 1. Modèle -->
        <section v-if="isNew || !template" class="space-y-2">
          <p class="text-sm font-medium"><span class="text-primary">1.</span> Que veux-tu vérifier ?</p>
          <div class="grid gap-2 sm:grid-cols-2 2xl:grid-cols-4">
            <button
              v-for="t in TEMPLATES"
              :key="t.key"
              type="button"
              class="rounded-lg border p-3 text-left flex gap-3 transition-colors"
              :class="template === t.key ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'border-default hover:bg-elevated/60'"
              :aria-pressed="template === t.key"
              @click="pickTemplate(t.key)"
            >
              <UIcon :name="t.icon" class="size-5 text-primary shrink-0 mt-0.5" />
              <span>
                <span class="block text-sm font-medium">{{ t.label }}</span>
                <span class="block text-xs text-muted">{{ t.pitch }}</span>
              </span>
            </button>
          </div>
        </section>

        <!-- 2. Réglages du modèle -->
        <section v-if="template" class="space-y-3">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <p class="text-sm font-medium"><span class="text-primary">2.</span> {{ template === 'personnalise' ? 'Conditions' : 'Réglages' }}</p>
            <UButton v-if="template !== 'personnalise'" size="xs" color="neutral" variant="link" icon="i-lucide-sliders-horizontal" label="Affiner avec toutes les conditions" @click="toCustom" />
          </div>

          <UCard v-if="template === 'rangement'">
            <div class="flex flex-wrap items-center gap-2 text-sm leading-9">
              <span>Les</span>
              <USelect v-model="params.mediaType as string" :items="MEDIA_TYPES" class="w-56" />
              <span>dont la langue originale</span>
              <USelect v-model="params.langMode as string" :items="[{ label: 'est', value: 'in' }, { label: 'n\'est pas', value: 'not_in' }]" class="w-28" />
              <USelectMenu v-model="params.languages as string[]" :items="languageItems" value-key="value" multiple placeholder="n'importe laquelle" class="w-56" />
              <USelect v-model="params.mode as string" :items="[{ label: 'doivent être dans', value: 'doit' }, { label: 'ne doivent pas être dans', value: 'interdit' }]" class="w-56" />
              <USelect v-model="params.instanceId as string" :items="rangementInstances" placeholder="choisis une instance" class="w-48" />
            </div>
            <p class="text-xs text-muted mt-3">Seront signalés les titres qui ne respectent pas ce rangement. Les titres gérés par aucun Radarr/Sonarr ont leur propre contrôle.</p>
          </UCard>

          <UCard v-else-if="template === 'qualite'">
            <div class="space-y-4">
              <UFormField label="Pour quelles instances ?" description="Vide = toutes.">
                <USelectMenu v-model="params.instances as string[]" :items="arrInstances.map(i => ({ label: i.name, value: String(i.id) }))" value-key="value" multiple placeholder="Toutes les instances" class="w-full sm:w-96" />
              </UFormField>
              <UFormField label="Résolution minimale">
                <div class="flex flex-wrap gap-2">
                  <UButton v-for="r in [{ value: 0, label: 'Peu importe' }, ...RESOLUTIONS]" :key="r.value" size="sm" :variant="params.minResolution === r.value ? 'solid' : 'outline'" :color="params.minResolution === r.value ? 'primary' : 'neutral'" :label="r.label" @click="params.minResolution = r.value" />
                </div>
              </UFormField>
              <UFormField label="Langues audio obligatoires" description="Chaque langue choisie doit être présente.">
                <USelectMenu v-model="params.audio as string[]" :items="audioItems" value-key="value" multiple placeholder="Aucune exigence" class="w-full sm:w-96" />
              </UFormField>
              <UFormField label="Sous-titres obligatoires">
                <USelectMenu v-model="params.subtitles as string[]" :items="subtitleItems" value-key="value" multiple placeholder="Aucune exigence" class="w-full sm:w-96" />
              </UFormField>
            </div>
          </UCard>

          <UCard v-else-if="template === 'menage'">
            <div class="space-y-4">
              <UFormField label="Quoi ?">
                <USelect v-model="params.mediaType as string" :items="MEDIA_TYPES" class="w-56" />
              </UFormField>
              <p class="text-sm font-medium">Signaler ceux qui sont… <span class="text-muted font-normal">(tous les critères cochés à la fois)</span></p>
              <div class="space-y-3">
                <UCheckbox v-model="params.neverWatched as boolean" label="Jamais vus" description="Personne ne les a lancés sur Plex ou Jellyfin." />
                <div class="flex flex-wrap items-center gap-2 text-sm">
                  <UCheckbox :model-value="addedDays !== undefined" label="Ajoutés il y a plus de" @update:model-value="(v) => { addedDays = v ? 365 : undefined }" />
                  <UInputNumber v-model="addedDays" :min="1" :disabled="addedDays === undefined" class="w-28" />
                  <span>jours</span>
                </div>
                <div class="flex flex-wrap items-center gap-2 text-sm">
                  <UCheckbox :model-value="notWatchedDays !== undefined" label="Pas regardés depuis" @update:model-value="(v) => { notWatchedDays = v ? 365 : undefined }" />
                  <UInputNumber v-model="notWatchedDays" :min="1" :disabled="notWatchedDays === undefined" class="w-28" />
                  <span>jours</span>
                </div>
                <div class="flex flex-wrap items-center gap-2 text-sm">
                  <UCheckbox :model-value="maxRating !== undefined" label="Notés moins de" @update:model-value="(v) => { maxRating = v ? 6 : undefined }" />
                  <UInputNumber v-model="maxRating" :min="0" :max="10" :step="0.5" :disabled="maxRating === undefined" class="w-28" />
                  <span>/ 10</span>
                </div>
                <div class="flex flex-wrap items-center gap-2 text-sm">
                  <UCheckbox :model-value="minSize !== undefined" label="Plus gros que" @update:model-value="(v) => { minSize = v ? 20 : undefined }" />
                  <UInputNumber v-model="minSize" :min="0" :disabled="minSize === undefined" class="w-28" />
                  <span>Go</span>
                </div>
              </div>
            </div>
          </UCard>

          <UCard v-else>
            <p class="text-sm text-muted mb-3">Un titre est signalé quand il remplit ces conditions.</p>
            <FilterBuilder v-if="fields.length" v-model="custom" :fields="fields" />
          </UCard>

          <UAlert v-if="problems.length && template" color="neutral" variant="subtle" icon="i-lucide-info" :description="problems.join(' ')" />
        </section>

        <!-- 3. Nom et importance -->
        <section v-if="template" class="space-y-3">
          <p class="text-sm font-medium"><span class="text-primary">3.</span> Nom et importance</p>
          <UCard>
            <div class="space-y-4">
              <UFormField label="Nom" description="Proposé d'après tes réglages ; modifie-le librement.">
                <UInput v-model="name" class="w-full" @update:model-value="nameTouched = true" />
              </UFormField>
              <UFormField label="Note pour plus tard (facultatif)">
                <UInput v-model="description" placeholder="Pourquoi cette règle ?" class="w-full" />
              </UFormField>
              <UFormField label="Importance">
                <div class="grid gap-2 sm:grid-cols-3">
                  <button
                    v-for="s in SEVERITIES"
                    :key="s"
                    type="button"
                    class="rounded-lg border p-2.5 text-left flex items-center gap-2 text-sm transition-colors"
                    :class="severity === s ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'border-default hover:bg-elevated/60'"
                    :aria-pressed="severity === s"
                    @click="severity = s"
                  >
                    <UIcon :name="SEVERITY_ICONS[s]" class="size-4" :class="SEVERITY_TEXT[s]" />{{ SEVERITY_LABELS[s] }}
                  </button>
                </div>
              </UFormField>
              <USwitch v-model="enabled" label="Active" description="Inactive, la règle est gardée mais ne signale rien." />
            </div>
          </UCard>
          <div class="flex gap-2">
            <UButton :label="isNew ? 'Créer la règle' : 'Enregistrer'" icon="i-lucide-check" :loading="saving" :disabled="!!problems.length || !name.trim()" @click="save" />
            <UButton label="Annuler" color="neutral" variant="ghost" to="/regles" />
          </div>
        </section>
      </div>

      <!-- Aperçu -->
      <aside class="xl:sticky xl:top-0 rounded-xl border border-default p-4 space-y-3">
        <div class="flex items-center gap-2">
          <UIcon name="i-lucide-eye" class="size-4 text-primary" />
          <p class="text-sm font-medium">Aperçu</p>
          <UIcon v-if="previewLoading" name="i-lucide-loader-circle" class="size-4 animate-spin text-muted ml-auto" />
        </div>
        <template v-if="preview">
          <p>
            <span class="text-3xl font-semibold tabular-nums">{{ preview.total.toLocaleString('fr-FR') }}</span>
            <span class="text-sm text-muted"> titres signalés · {{ formatSize(preview.totalSizeGb) }}</span>
          </p>
          <UBadge v-if="template" :color="SEVERITY_COLORS[severity]" variant="subtle" :label="SEVERITY_LABELS[severity]" />
          <div v-if="preview.rows.length" class="grid grid-cols-4 gap-2">
            <div v-for="r in preview.rows" :key="r.id" :title="`${r.title} · ${formatSize(r.sizeGb)}`">
              <PosterImage :id="r.id" :title="r.title" :type="r.type" />
            </div>
          </div>
          <p v-if="preview.total > preview.rows.length" class="text-xs text-muted">Les plus gros d'abord · et {{ (preview.total - preview.rows.length).toLocaleString('fr-FR') }} autres.</p>
          <p v-if="!preview.total" class="text-sm text-muted">Aucun titre ne correspond pour l'instant.</p>
        </template>
        <p v-else class="text-sm text-muted">{{ template ? 'L\'aperçu apparaît dès que les réglages sont complets.' : 'Choisis d\'abord ce que tu veux vérifier.' }}</p>
        <p class="text-xs text-dimmed flex gap-1.5"><UIcon name="i-lucide-shield-check" class="size-3.5 mt-0.5 shrink-0" />Une règle signale seulement : rien n'est supprimé ni déplacé.</p>
      </aside>
    </div>
  </AppPage>
</template>
