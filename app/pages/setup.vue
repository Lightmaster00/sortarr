<script setup lang="ts">
import { setupSchema } from '#shared/auth'

definePageMeta({ layout: 'auth' })

const api = useApi()
const toast = useToast()
const state = reactive({ username: 'admin', password: '', confirm: '' })
const loading = ref(false)

async function submit() {
  loading.value = true
  try {
    await api('/api/auth/setup', { method: 'POST', body: state })
    await navigateTo('/reglages/instances')
  } catch (e) {
    toast.add({ title: 'Création impossible', description: errorMessage(e), color: 'error' })
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <UCard class="w-full max-w-sm">
    <template #header>
      <h1 class="text-lg font-semibold">Bienvenue dans Sortarr</h1>
      <p class="text-sm text-muted mt-1">Crée le compte administrateur. Tu ajouteras ensuite tes instances.</p>
    </template>
    <UForm :schema="setupSchema" :state="state" class="space-y-4" @submit="submit">
      <UFormField label="Nom d'utilisateur" name="username">
        <UInput v-model="state.username" autocomplete="username" class="w-full" />
      </UFormField>
      <UFormField label="Mot de passe" name="password" description="8 caractères minimum">
        <UInput v-model="state.password" type="password" autocomplete="new-password" class="w-full" />
      </UFormField>
      <UFormField label="Confirmation" name="confirm">
        <UInput v-model="state.confirm" type="password" autocomplete="new-password" class="w-full" />
      </UFormField>
      <UButton type="submit" label="Créer le compte" block :loading="loading" />
    </UForm>
  </UCard>
</template>
