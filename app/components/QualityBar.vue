<script setup lang="ts">
import type { QualityBucket } from '#shared/catalog'

const props = defineProps<{ quality: { bucket: QualityBucket; count: number }[] }>()
const LABELS: Record<QualityBucket, string> = { 2160: '4K', 1080: '1080p', 720: '720p', sd: 'SD', unknown: 'Inconnue' }
const total = computed(() => props.quality.reduce((n, q) => n + q.count, 0))
const segments = computed(() => props.quality.filter(q => q.count > 0).map(q => ({
  ...q,
  label: LABELS[q.bucket],
  pct: total.value ? (q.count / total.value) * 100 : 0,
  color: `var(--q-${q.bucket})`,
})))
const pct = (n: number) => `${n < 1 && n > 0 ? '<1' : Math.round(n)} %`
</script>

<template>
  <div v-if="total" class="space-y-3">
    <div class="flex h-6 w-full gap-0.5 overflow-hidden rounded-md" role="img" :aria-label="segments.map(s => `${s.label} ${pct(s.pct)}`).join(', ')">
      <UTooltip v-for="s in segments" :key="s.bucket" :text="`${s.label} : ${s.count.toLocaleString('fr-FR')} titres (${pct(s.pct)})`">
        <div class="h-full first:rounded-l-md last:rounded-r-md hover:opacity-85 transition-opacity" :style="{ width: `${s.pct}%`, minWidth: '4px', backgroundColor: s.color }" />
      </UTooltip>
    </div>
    <ul class="flex flex-wrap gap-x-4 gap-y-1.5 text-sm">
      <li v-for="s in segments" :key="s.bucket" class="flex items-center gap-1.5">
        <span class="size-2.5 rounded-sm" :style="{ backgroundColor: s.color }" />
        <span class="font-medium">{{ s.label }}</span>
        <span class="text-muted tabular-nums">{{ s.count.toLocaleString('fr-FR') }} · {{ pct(s.pct) }}</span>
      </li>
    </ul>
  </div>
  <p v-else class="text-sm text-muted">Pas encore de fichiers connus.</p>
</template>
