<script setup lang="ts">
import type { NavigationMenuItem } from '@nuxt/ui'

const api = useApi()
const toast = useToast()

const { summary, refresh: refreshIssues } = useIssues()
onMounted(refreshIssues)
onSyncFinished(refreshIssues)
const toFix = computed(() => (summary.value ? summary.value.bySeverity.erreur + summary.value.bySeverity.avertissement : 0))
const main = computed<NavigationMenuItem[]>(() => [
  { label: 'Tableau de bord', icon: 'i-lucide-layout-dashboard', to: '/' },
  { label: 'À traiter', icon: 'i-lucide-inbox', to: '/a-traiter', badge: toFix.value ? { label: toFix.value.toLocaleString('fr-FR'), color: 'warning', variant: 'subtle' } : undefined },
  { label: 'Catalogue', icon: 'i-lucide-film', to: '/catalogue' },
  { label: 'Règles', icon: 'i-lucide-list-checks', to: '/regles' },
])
const route = useRoute()
const settings = computed<NavigationMenuItem[]>(() => [
  // La page des dossiers (avancée) s'ouvre depuis une instance : le menu reste sur « Instances ».
  { label: 'Instances', icon: 'i-lucide-server', to: '/reglages/instances', active: route.path.startsWith('/reglages/instances') || route.path.startsWith('/reglages/chemins') },
  { label: 'Général', icon: 'i-lucide-settings', to: '/reglages/general' },
])

async function logout() {
  try {
    await api('/api/auth/logout', { method: 'POST' })
  } catch (e) {
    toast.add({ title: 'Déconnexion impossible', description: errorMessage(e), color: 'error' })
    return
  }
  stopSyncPolling()
  useState('sync').value = null
  useState('instances').value = []
  await navigateTo('/login')
}
</script>

<template>
  <UDashboardGroup>
    <UDashboardSidebar collapsible resizable :default-size="20" :min-size="14" :max-size="25">
      <template #header="{ collapsed }">
        <NuxtLink to="/" class="flex items-center gap-2 font-semibold">
          <img src="/icon.svg" alt="" class="size-7">
          <span v-if="!collapsed" class="text-lg tracking-tight">Sortarr</span>
        </NuxtLink>
      </template>

      <template #default="{ collapsed }">
        <UNavigationMenu :collapsed="collapsed" :items="main" orientation="vertical" />
        <USeparator class="my-2" />
        <p v-if="!collapsed" class="px-2.5 pb-1 text-xs font-medium text-muted">Réglages</p>
        <UNavigationMenu :collapsed="collapsed" :items="settings" orientation="vertical" />
      </template>

      <template #footer="{ collapsed }">
        <UButton :label="collapsed ? undefined : 'Déconnexion'" icon="i-lucide-log-out" color="neutral" variant="ghost" block @click="logout" />
      </template>
    </UDashboardSidebar>

    <slot />
  </UDashboardGroup>
</template>
