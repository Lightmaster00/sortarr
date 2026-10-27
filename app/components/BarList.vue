<script setup lang="ts">
import type { InstanceKind } from '#shared/instances'

export interface BarItem { key: string; label: string; value: number; display: string; detail?: string; kind?: InstanceKind }
const props = defineProps<{ items: BarItem[]; empty?: string }>()
const max = computed(() => Math.max(1, ...props.items.map(i => i.value)))
</script>

<template>
  <ul v-if="items.length" class="space-y-2.5">
    <li v-for="item in items" :key="item.key">
      <UTooltip :text="item.detail ?? `${item.label} : ${item.display}`" :content="{ side: 'top' }">
        <div class="group cursor-default">
          <div class="flex items-center justify-between gap-3 text-sm mb-1">
            <span class="flex items-center gap-2 min-w-0">
              <ServiceLogo v-if="item.kind" :kind="item.kind" size="sm" />
              <span class="truncate">{{ item.label }}</span>
            </span>
            <span class="tabular-nums text-muted shrink-0">{{ item.display }}</span>
          </div>
          <div class="h-2 rounded-full bg-elevated overflow-hidden">
            <div class="h-full rounded-full bg-primary transition-all group-hover:brightness-110" :style="{ width: `${Math.max(1.5, (item.value / max) * 100)}%` }" />
          </div>
        </div>
      </UTooltip>
    </li>
  </ul>
  <p v-else class="text-sm text-muted">{{ empty ?? 'Pas encore de données.' }}</p>
</template>
