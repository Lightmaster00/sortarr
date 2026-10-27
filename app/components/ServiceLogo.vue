<script setup lang="ts">
import type { InstanceKind } from '#shared/instances'

const props = withDefaults(defineProps<{ kind: InstanceKind; size?: 'sm' | 'md' | 'lg' }>(), { size: 'md' })
const info = computed(() => SERVICES[props.kind])
const box = { sm: 'size-7 rounded-md', md: 'size-10 rounded-lg', lg: 'size-14 rounded-xl' }
const icon = { sm: 'size-4', md: 'size-6', lg: 'size-8' }
</script>

<template>
  <span
    class="inline-flex shrink-0 items-center justify-center ring-1 ring-inset ring-default"
    :class="box[size]"
    :style="{ backgroundColor: `color-mix(in oklab, ${info.color} 14%, transparent)` }"
    aria-hidden="true"
  >
    <UIcon :name="info.icon" :class="icon[size]" :style="{ color: info.color }" />
  </span>
</template>
