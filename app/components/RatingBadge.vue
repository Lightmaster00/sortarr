<script setup lang="ts">
withDefaults(defineProps<{ value: number | null; overlay?: boolean }>(), { overlay: false })
</script>

<template>
  <span
    v-if="value !== null"
    class="inline-flex items-center gap-0.5 font-semibold tabular-nums"
    :class="overlay ? 'rounded bg-black/75 px-1.5 py-0.5 text-[11px] text-white' : 'text-sm'"
    :title="`Note : ${value.toFixed(1)} / 10`"
  >
    <UIcon name="i-lucide-star" class="size-3 text-amber-400" />{{ value.toFixed(1) }}
  </span>
</template>
