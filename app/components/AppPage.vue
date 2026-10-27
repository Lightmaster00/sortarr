<script setup lang="ts">
defineProps<{ title: string; description?: string; icon?: string }>()
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
      <div v-if="description || $slots.actions" class="flex flex-wrap items-start gap-4 mb-2">
        <span v-if="icon" class="hidden sm:inline-flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <UIcon :name="icon" class="size-6" />
        </span>
        <p v-if="description" class="flex-1 min-w-60 text-sm text-muted leading-relaxed max-w-3xl">{{ description }}</p>
        <div v-if="$slots.actions" class="flex flex-wrap gap-2 ml-auto">
          <slot name="actions" />
        </div>
      </div>
      <slot />
    </template>
  </UDashboardPanel>
</template>
