<script setup lang="ts">
import { INSTANCE_KINDS, KIND_LABELS, instanceCreateSchema, instanceUpdateSchema, type InstanceDto, type InstanceKind, type TestResult } from '#shared/instances'

const props = defineProps<{ instance: InstanceDto | null; presetKind?: InstanceKind | null }>()
const emit = defineEmits<{ saved: [instance: InstanceDto, created: boolean]; cancel: [] }>()

const api = useApi()
const toast = useToast()

const isEdit = computed(() => props.instance !== null)
const initialKind: InstanceKind = props.instance?.kind ?? props.presetKind ?? 'radarr'
const state = reactive({
  kind: initialKind,
  name: props.instance?.name ?? KIND_LABELS[initialKind],
  url: props.instance?.url ?? '',
  apiKey: '',
  enabled: props.instance?.enabled ?? true,
})
const info = computed(() => SERVICES[state.kind])
const keyLabel = computed(() => (state.kind === 'plex' ? 'Jeton Plex (X-Plex-Token)' : 'Clé API'))

// Le nom suit le type tant que l'utilisateur ne l'a pas personnalisé.
function pickKind(kind: InstanceKind) {
  if (isEdit.value) return
  if (state.name === KIND_LABELS[state.kind] || !state.name.trim()) state.name = KIND_LABELS[kind]
  state.kind = kind
}

const replaceKey = ref(!isEdit.value)
const urlChanged = computed(() => isEdit.value && state.url !== props.instance?.url)
watch(urlChanged, (changed) => { if (changed) replaceKey.value = true })
const schema = computed(() => (isEdit.value ? instanceUpdateSchema : instanceCreateSchema))
const saving = ref(false)
const testing = ref(false)
const testResult = ref<TestResult | null>(null)

/** Erreurs d'adresse fréquentes dans Docker, signalées avant même le test. */
const urlWarning = computed(() => {
  const url = state.url.trim().toLowerCase()
  if (/^https?:\/\/(localhost|127\.|\[::1\])/.test(url)) return 'Dans Docker, « localhost » désigne Sortarr lui-même. Mets l\'adresse IP du serveur, par exemple ' + info.value.placeholder + '.'
  if (state.kind === 'plex' && /^https:\/\//.test(url)) return 'Plex refuse souvent les connexions HTTPS par adresse IP (certificat *.plex.direct). Préfère ' + info.value.placeholder + '.'
  if (/plex\.tv/.test(url)) return 'Il faut l\'adresse de ton serveur Plex, pas celle de plex.tv.'
  return null
})

watch(() => [state.kind, state.url, state.apiKey], () => { testResult.value = null })

async function runTest() {
  testing.value = true
  testResult.value = null
  try {
    testResult.value = await api<TestResult>('/api/instances/test', {
      method: 'POST',
      body: { id: props.instance?.id, kind: state.kind, url: state.url, apiKey: state.apiKey || undefined },
    })
  } catch (e) {
    testResult.value = { ok: false, error: errorMessage(e) }
  } finally {
    testing.value = false
  }
}

async function submit() {
  saving.value = true
  try {
    const body = { ...state, apiKey: replaceKey.value && state.apiKey ? state.apiKey : undefined }
    const saved = props.instance
      ? await api<InstanceDto>(`/api/instances/${props.instance.id}`, { method: 'PUT', body })
      : await api<InstanceDto>('/api/instances', { method: 'POST', body })
    emit('saved', saved, !props.instance)
  } catch (e) {
    toast.add({ title: 'Enregistrement impossible', description: errorMessage(e), color: 'error' })
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <UForm :schema="schema" :state="state" class="space-y-6" @submit="submit">
    <section v-if="!isEdit" class="space-y-2">
      <p class="text-sm font-medium"><span class="text-primary">1.</span> Quel service ?</p>
      <div class="grid grid-cols-2 gap-2">
        <button
          v-for="k in INSTANCE_KINDS"
          :key="k"
          type="button"
          class="rounded-lg border p-3 flex items-center gap-2.5 text-left transition-colors"
          :class="state.kind === k ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'border-default hover:bg-elevated/60'"
          :aria-pressed="state.kind === k"
          @click="pickKind(k)"
        >
          <ServiceLogo :kind="k" size="sm" />
          <span class="min-w-0">
            <span class="block text-sm font-medium">{{ KIND_LABELS[k] }}</span>
            <span class="block text-xs text-muted truncate">{{ SERVICES[k].role }}</span>
          </span>
        </button>
      </div>
      <p class="text-xs text-muted">{{ info.description }}</p>
    </section>

    <section class="space-y-3">
      <p v-if="!isEdit" class="text-sm font-medium"><span class="text-primary">2.</span> Où le trouver ?</p>
      <UFormField label="Nom" name="name" description="Affiché partout dans Sortarr. Utile si tu as plusieurs instances, par exemple « Radarr 4K ».">
        <UInput v-model="state.name" class="w-full" />
      </UFormField>
      <UFormField label="Adresse" name="url" :description="`L'adresse que tu tapes dans ton navigateur pour ouvrir ${KIND_LABELS[state.kind]}.`">
        <UInput v-model="state.url" :placeholder="info.placeholder" class="w-full font-mono" />
      </UFormField>
      <UAlert v-if="urlWarning" color="warning" variant="subtle" icon="i-lucide-triangle-alert" :description="urlWarning" :ui="{ description: 'text-xs' }" />
    </section>

    <section class="space-y-3">
      <p v-if="!isEdit" class="text-sm font-medium"><span class="text-primary">3.</span> La clé d'accès</p>
      <UFormField :label="keyLabel" name="apiKey" :help="urlChanged ? 'Nouvelle adresse : saisis la clé à nouveau.' : undefined">
        <UInput v-if="replaceKey" v-model="state.apiKey" type="password" autocomplete="new-password" class="w-full" />
        <div v-else class="flex items-center gap-2">
          <span class="text-sm text-muted">•••••••• enregistrée</span>
          <UButton size="xs" variant="soft" label="Remplacer la clé" @click="replaceKey = true" />
        </div>
      </UFormField>
      <div v-if="replaceKey" class="rounded-lg bg-elevated/50 p-3">
        <p class="text-xs font-medium mb-1.5">Où la trouver ?</p>
        <ol class="space-y-1">
          <li v-for="(step, n) in info.keyHelp" :key="n" class="flex gap-2 text-xs text-muted">
            <span class="inline-flex size-4 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary text-[10px] font-semibold">{{ n + 1 }}</span>
            <span>{{ step }}</span>
          </li>
        </ol>
        <p class="text-xs text-muted mt-2 flex gap-1.5"><UIcon name="i-lucide-lock" class="size-3.5 mt-0.5 shrink-0" />Chiffrée sur ton serveur, jamais réaffichée.</p>
      </div>
    </section>

    <UFormField name="enabled">
      <USwitch v-model="state.enabled" label="Activée" description="Désactivée, l'instance est ignorée par la synchro." />
    </UFormField>

    <UAlert v-if="testResult && !testResult.ok" color="error" variant="subtle" icon="i-lucide-circle-x" title="Connexion impossible" :description="testResult.error" :ui="{ description: 'break-words' }" />
    <DiscoveryResult v-if="testResult && testResult.ok" :discovery="testResult.discovery" />

    <div class="flex flex-wrap gap-2 pt-2 border-t border-default">
      <UButton label="Tester la connexion" icon="i-lucide-plug-zap" variant="soft" :loading="testing" @click="runTest" />
      <UButton type="submit" :label="isEdit ? 'Enregistrer' : 'Ajouter'" icon="i-lucide-check" :loading="saving" />
      <UButton label="Annuler" color="neutral" variant="ghost" @click="emit('cancel')" />
    </div>
  </UForm>
</template>
