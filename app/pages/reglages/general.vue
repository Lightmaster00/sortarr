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
  { label: 'Toutes les heures', value: '0 * * * *' },
  { label: 'Toutes les 6 heures', value: '0 */6 * * *' },
  { label: 'Chaque nuit à 4 h', value: '0 4 * * *' },
]

onMounted(async () => {
  try {
    general.value = await api<General>('/api/settings/general')
    cron.value = general.value.syncCron
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
  <AppPage title="Général">
    <div class="space-y-6 max-w-2xl">
      <UCard>
        <template #header><h2 class="font-medium">Synchronisation</h2></template>
        <div class="space-y-3">
          <div class="flex flex-wrap gap-2">
            <UButton v-for="p in PRESETS" :key="p.value" size="sm" :variant="cron === p.value ? 'solid' : 'outline'" :label="p.label" @click="cron = p.value" />
          </div>
          <UFormField label="Expression cron" description="Minute, heure, jour du mois, mois, jour de la semaine.">
            <UInput v-model="cron" class="w-60 font-mono" />
          </UFormField>
          <div v-if="general && cron.trim() !== general.syncCron" class="flex flex-wrap items-center gap-2 text-sm text-warning">
            <span>Non enregistré : la planification active reste {{ general.syncCron }}.</span>
            <UButton size="xs" variant="link" label="Revenir à la valeur active" @click="cron = general.syncCron" />
          </div>
          <div class="flex items-center gap-3">
            <UButton label="Enregistrer" :loading="savingCron" @click="saveCron" />
            <span class="text-sm text-muted">Prochaine synchro : {{ formatDateTime(general?.nextSyncAt ?? null) }}</span>
          </div>
        </div>
      </UCard>

      <UCard>
        <template #header><h2 class="font-medium">Mot de passe</h2></template>
        <UForm :schema="passwordChangeSchema" :state="password" class="space-y-3" @submit="changePassword">
          <UFormField label="Mot de passe actuel" name="current"><UInput v-model="password.current" type="password" autocomplete="current-password" class="w-72" /></UFormField>
          <UFormField label="Nouveau mot de passe" name="next"><UInput v-model="password.next" type="password" autocomplete="new-password" class="w-72" /></UFormField>
          <UFormField label="Confirmation" name="confirm"><UInput v-model="password.confirm" type="password" autocomplete="new-password" class="w-72" /></UFormField>
          <UButton type="submit" label="Changer le mot de passe" :loading="savingPassword" />
        </UForm>
      </UCard>

      <UCard v-if="general">
        <template #header><h2 class="font-medium">Dossiers</h2></template>
        <dl class="grid grid-cols-1 sm:grid-cols-[12rem_1fr] gap-y-1 text-sm">
          <dt class="text-muted">Racine médias</dt><dd><code class="break-all">{{ general.mediaRoot }}</code></dd>
          <dt class="text-muted">Configuration</dt><dd><code class="break-all">{{ general.configDir }}</code></dd>
        </dl>
      </UCard>
    </div>
  </AppPage>
</template>
