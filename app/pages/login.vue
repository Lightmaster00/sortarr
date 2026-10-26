<script setup lang="ts">
import { loginSchema } from '#shared/auth'

definePageMeta({ layout: 'auth' })

const api = useApi()
const toast = useToast()
const state = reactive({ username: '', password: '' })
const loading = ref(false)

async function submit() {
  loading.value = true
  try {
    await api('/api/auth/login', { method: 'POST', body: state })
    await navigateTo('/')
  } catch (e) {
    toast.add({ title: 'Connexion impossible', description: errorMessage(e), color: 'error' })
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <UCard class="w-full max-w-sm">
    <template #header>
      <h1 class="text-lg font-semibold">Connexion à Sortarr</h1>
    </template>
    <UForm :schema="loginSchema" :state="state" class="space-y-4" @submit="submit">
      <UFormField label="Nom d'utilisateur" name="username">
        <UInput v-model="state.username" autocomplete="username" class="w-full" />
      </UFormField>
      <UFormField label="Mot de passe" name="password">
        <UInput v-model="state.password" type="password" autocomplete="current-password" class="w-full" />
      </UFormField>
      <UButton type="submit" label="Se connecter" block :loading="loading" />
    </UForm>
  </UCard>
</template>
