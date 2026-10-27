<script setup lang="ts">
const props = defineProps<{ id: number; title: string; type: 'movie' | 'series' }>()
const failed = ref(false)
watch(() => props.id, () => { failed.value = false })
</script>

<template>
  <div class="relative aspect-[2/3] w-full overflow-hidden rounded-lg bg-elevated ring-1 ring-default">
    <img
      v-if="!failed"
      :src="`/api/catalog/items/${id}/poster`"
      :alt="`Affiche : ${title}`"
      loading="lazy"
      decoding="async"
      class="absolute inset-0 size-full object-cover"
      @error="failed = true"
    >
    <div v-else class="absolute inset-0 flex flex-col items-center justify-center gap-2 p-2 text-center bg-gradient-to-b from-elevated to-accented/40">
      <UIcon :name="type === 'movie' ? 'i-lucide-film' : 'i-lucide-tv'" class="size-8 text-dimmed" />
      <span class="text-xs text-muted line-clamp-3">{{ title }}</span>
    </div>
    <slot />
  </div>
</template>
