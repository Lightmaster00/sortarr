<script setup lang="ts">
defineProps<{ icon: string; value: string; label: string; hint?: string; to?: string }>()
</script>

<template>
  <component :is="to ? resolveComponent('NuxtLink') : 'div'" :to="to" class="block rounded-xl border border-default bg-default p-4 transition-colors" :class="to ? 'hover:border-primary/50 hover:bg-primary/5' : ''">
    <div class="flex items-center gap-2 text-sm text-muted">
      <UIcon :name="icon" class="size-4 text-primary" />
      <span>{{ label }}</span>
    </div>
    <p class="text-2xl sm:text-3xl font-semibold tabular-nums mt-1.5 tracking-tight">{{ value }}</p>
    <p v-if="hint" class="text-xs text-muted mt-0.5">{{ hint }}</p>
  </component>
</template>
