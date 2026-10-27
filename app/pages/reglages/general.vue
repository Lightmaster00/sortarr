<script setup lang="ts">
import { passwordChangeSchema } from '#shared/auth'
import { formatDateTime } from '#shared/format'

interface General { mediaRoot: string; configDir: string; syncCron: string; nextSyncAt: number | null }

const api = useApi()
const toast = useToast()
const general = ref<General | null>(null)
const cron = ref('')
const savingCron = ref(false)
const PRESETS = [
  { label: 'Toutes les heures', hint: 'Toujours à jour, un peu plus de charge sur les services.', icon: 'i-lucide-zap', value: '0 * * * *' },
  { label: 'Toutes les 6 heures', hint: 'Bon compromis.', icon: 'i-lucide-clock', value: '0 */6 * * *' },
  { label: 'Chaque nuit à 4 h', hint: 'Le plus léger : une fois par jour, quand personne ne regarde.', icon: 'i-lucide-moon', value: '0 4 * * *' },
]
const custom = ref(false)
const isPreset = computed(() => PRESETS.some(p => p.value === cron.value.trim()))
function pick(value: string) {
  cron.value = value
  custom.value = false
}

onMounted(async () => {
  try {
    general.value = await api<General>('/api/settings/general')
    cron.value = general.value.syncCron
    custom.value = !PRESETS.some(p => p.value === general.value!.syncCron)
  } catch (e) {
    toast.add({ title: 'Réglages indisponibles', description: errorMessage(e), color: 'error' })
  }
})

async function saveCron() {
  savingCron.value = true
  try {
    general.value = await api<General>('/api/settings/sync', { method: 'PUT', body: { cron: cron.value } })
    cron.value = general.value.syncCron
    toast.add({ title: 'Planification enregistrée', description: `Prochaine synchro : ${formatDateTime(general.value.nextSyncAt)}`, color: 'success' })
  } catch (e) {
    toast.add({ title: 'Enregistrement impossible', description: errorMessage(e), color: 'error' })
  } finally {
    savingCron.value = false
  }
}

const password = reactive({ current: '', next: '', confirm: '' })
const savingPassword = ref(false)
async function changePassword() {
  savingPassword.value = true
  try {
    await api('/api/auth/password', { method: 'POST', body: password })
    Object.assign(password, { current: '', next: '', confirm: '' })
    toast.add({ title: 'Mot de passe changé', description: 'Les autres sessions ont été fermées.', color: 'success' })
  } catch (e) {
    toast.add({ title: 'Changement impossible', description: errorMessage(e), color: 'error' })
  } finally {
    savingPassword.value = false
  }
}
</script>

<template>
  <AppPage title="Général" icon="i-lucide-settings" description="La fréquence de mise à jour du catalogue et ton mot de passe.">
    <div class="space-y-6 max-w-3xl">
      <UCard>
        <template #header>
          <h2 class="font-medium">Synchronisation automatique</h2>
          <p class="text-sm text-muted mt-0.5">Sortarr relit régulièrement tes services pour garder le catalogue à jour. Tu peux aussi lancer une synchro à tout moment avec le bouton en haut à droite.</p>
        </template>
        <div class="space-y-4">
          <div class="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Fréquence">
            <button
              v-for="p in PRESETS"
              :key="p.value"
              type="button"
              role="radio"
              :aria-checked="!custom && cron.trim() === p.value"
              class="rounded-lg border p-3 text-left transition-colors"
              :class="!custom && cron.trim() === p.value ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'border-default hover:bg-elevated/60'"
              @click="pick(p.value)"
            >
              <UIcon :name="p.icon" class="size-5 text-primary mb-1" />
              <span class="block text-sm font-medium">{{ p.label }}</span>
              <span class="block text-xs text-muted">{{ p.hint }}</span>
            </button>
          </div>
          <UButton v-if="!custom" size="xs" variant="link" color="neutral" label="Horaire personnalisé (expression cron, avancé)" @click="custom = true" />
          <UFormField v-else label="Expression cron" description="Minute, heure, jour du mois, mois, jour de la semaine. Exemple : « 30 2 * * 1 » = chaque lundi à 2 h 30.">
            <UInput v-model="cron" class="w-60 font-mono" />
          </UFormField>
          <div v-if="general && cron.trim() !== general.syncCron" class="flex flex-wrap items-center gap-2 text-sm text-warning">
            <UIcon name="i-lucide-circle-alert" class="size-4" />
            <span>Pas encore enregistré.</span>
            <UButton size="xs" variant="link" label="Annuler" @click="cron = general.syncCron; custom = !isPreset" />
          </div>
          <div class="flex flex-wrap items-center gap-3">
            <UButton label="Enregistrer" :loading="savingCron" :disabled="!!general && cron.trim() === general.syncCron" @click="saveCron" />
            <span class="text-sm text-muted inline-flex items-center gap-1.5"><UIcon name="i-lucide-calendar-clock" class="size-4" />Prochaine synchro : {{ formatDateTime(general?.nextSyncAt ?? null) }}</span>
          </div>
        </div>
      </UCard>

      <UCard>
        <template #header>
          <h2 class="font-medium">Mot de passe</h2>
          <p class="text-sm text-muted mt-0.5">Le changer déconnecte tes autres appareils.</p>
        </template>
        <UForm :schema="passwordChangeSchema" :state="password" class="space-y-3" @submit="changePassword">
          <UFormField label="Mot de passe actuel" name="current"><UInput v-model="password.current" type="password" autocomplete="current-password" class="w-72" /></UFormField>
          <UFormField label="Nouveau mot de passe" name="next" description="8 caractères minimum."><UInput v-model="password.next" type="password" autocomplete="new-password" class="w-72" /></UFormField>
          <UFormField label="Confirmation" name="confirm"><UInput v-model="password.confirm" type="password" autocomplete="new-password" class="w-72" /></UFormField>
          <UButton type="submit" label="Changer le mot de passe" :loading="savingPassword" />
        </UForm>
      </UCard>

      <UCollapsible v-if="general">
        <UButton label="Informations techniques" icon="i-lucide-info" color="neutral" variant="ghost" size="sm" trailing-icon="i-lucide-chevron-down" />
        <template #content>
          <dl class="grid grid-cols-1 sm:grid-cols-[14rem_1fr] gap-y-1 text-sm px-3 pt-2">
            <dt class="text-muted">Dossier des médias (volume /media)</dt><dd><code class="break-all">{{ general.mediaRoot }}</code></dd>
            <dt class="text-muted">Dossier de configuration</dt><dd><code class="break-all">{{ general.configDir }}</code></dd>
          </dl>
        </template>
      </UCollapsible>
    </div>
  </AppPage>
</template>
