<script setup lang="ts">
import type { NavigationMenuItem } from '@nuxt/ui'

const api = useApi()
const toast = useToast()

const main: NavigationMenuItem[] = [
  { label: 'Tableau de bord', icon: 'i-lucide-layout-dashboard', to: '/' },
  { label: 'Catalogue', icon: 'i-lucide-film', to: '/catalogue' },
]
const settings: NavigationMenuItem[] = [
  { label: 'Instances', icon: 'i-lucide-server', to: '/reglages/instances' },
  { label: 'Chemins', icon: 'i-lucide-folder-tree', to: '/reglages/chemins' },
  { label: 'Général', icon: 'i-lucide-settings', to: '/reglages/general' },
]

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
        <div class="flex items-center gap-2 font-semibold">
          <UIcon name="i-lucide-clapperboard" class="size-5 text-primary" />
          <span v-if="!collapsed">Sortarr</span>
        </div>
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
