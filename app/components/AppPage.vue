<script setup lang="ts">
defineProps<{ title: string }>()
</script>

<template>
  <UDashboardPanel :id="title">
    <template #header>
      <UDashboardNavbar :title="title">
        <template #right>
          <AppStatusBar />
        </template>
      </UDashboardNavbar>
    </template>
    <template #body>
      <slot />
    </template>
  </UDashboardPanel>
</template>
