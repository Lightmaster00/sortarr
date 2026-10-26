<script setup lang="ts">
import { INSTANCE_KINDS, KIND_LABELS, instanceCreateSchema, instanceUpdateSchema, type InstanceDto, type InstanceKind, type TestResult } from '#shared/instances'

const props = defineProps<{ instance: InstanceDto | null }>()
const emit = defineEmits<{ saved: [instance: InstanceDto, created: boolean]; cancel: [] }>()

const api = useApi()
const toast = useToast()

const PLACEHOLDERS: Record<InstanceKind, string> = {
  radarr: 'http://192.168.1.10:7878',
  sonarr: 'http://192.168.1.10:8989',
  plex: 'http://192.168.1.10:32400',
  jellyfin: 'http://192.168.1.10:8096',
}
const KEY_HELP: Record<InstanceKind, string> = {
  radarr: 'Radarr › Settings › General › Security › API Key',
  sonarr: 'Sonarr › Settings › General › Security › API Key',
  plex: 'Jeton X-Plex-Token du compte admin (support.plex.tv/articles/204059436)',
  jellyfin: 'Jellyfin › Tableau de bord › Clés API › +',
}

const isEdit = computed(() => props.instance !== null)
const state = reactive({
  kind: (props.instance?.kind ?? 'radarr') as InstanceKind,
  name: props.instance?.name ?? '',
  url: props.instance?.url ?? '',
  apiKey: '',
  enabled: props.instance?.enabled ?? true,
})
const replaceKey = ref(!isEdit.value)
const urlChanged = computed(() => isEdit.value && state.url !== props.instance?.url)
watch(urlChanged, (changed) => { if (changed) replaceKey.value = true })
const schema = computed(() => (isEdit.value ? instanceUpdateSchema : instanceCreateSchema))
const kindItems = INSTANCE_KINDS.map(k => ({ label: KIND_LABELS[k], value: k }))
const saving = ref(false)
const testing = ref(false)
const testResult = ref<TestResult | null>(null)

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
  <UForm :schema="schema" :state="state" class="space-y-4" @submit="submit">
    <UFormField label="Type" name="kind">
      <USelect v-model="state.kind" :items="kindItems" :disabled="isEdit" class="w-full" />
    </UFormField>
    <UFormField label="Nom" name="name" description="Affiché partout dans Sortarr, par exemple « Radarr 4K ».">
      <UInput v-model="state.name" class="w-full" />
    </UFormField>
    <UFormField label="URL" name="url">
      <UInput v-model="state.url" :placeholder="PLACEHOLDERS[state.kind]" class="w-full" />
    </UFormField>
    <UFormField label="Clé API" name="apiKey" :description="KEY_HELP[state.kind]" :help="urlChanged ? 'Nouvelle adresse : saisis la clé API.' : undefined">
      <UInput v-if="replaceKey" v-model="state.apiKey" type="password" autocomplete="new-password" class="w-full" />
      <div v-else class="flex items-center gap-2">
        <span class="text-sm text-muted">•••••••• enregistrée</span>
        <UButton size="xs" variant="soft" label="Remplacer la clé" @click="replaceKey = true" />
      </div>
    </UFormField>
    <UFormField name="enabled">
      <USwitch v-model="state.enabled" label="Activée (incluse dans la synchro)" />
    </UFormField>

    <div class="flex flex-wrap gap-2">
      <UButton label="Tester la connexion" icon="i-lucide-plug-zap" variant="soft" :loading="testing" @click="runTest" />
      <UButton type="submit" label="Enregistrer" :loading="saving" />
      <UButton label="Annuler" color="neutral" variant="ghost" @click="emit('cancel')" />
    </div>

    <UAlert v-if="testResult && !testResult.ok" color="error" variant="subtle" icon="i-lucide-circle-x" title="Connexion impossible" :description="testResult.error" />
    <DiscoveryResult v-if="testResult && testResult.ok" :discovery="testResult.discovery" />
  </UForm>
</template>
