<script setup lang="ts">
import type { ItemDetail } from '#shared/catalog'
import { KIND_LABELS } from '#shared/instances'
import { formatDate, formatDateTime, formatSize } from '#shared/format'
import { languageLabel, resolutionLabel } from '#shared/media'
import { SEVERITY_COLORS, SEVERITY_LABELS, type IssueGroupDto } from '#shared/rules'

const id = defineModel<number | null>('id', { required: true })
const api = useApi()
const toast = useToast()
const detail = ref<ItemDetail | null>(null)
const issues = ref<IssueGroupDto[]>([])
const { refresh: refreshIssues } = useIssues()
const open = computed({
  get: () => id.value !== null,
  set: (value: boolean) => { if (!value) id.value = null },
})

watch(id, async (value) => {
  if (value === null) return
  detail.value = null
  issues.value = []
  try {
    const [res, found] = await Promise.all([api<ItemDetail>(`/api/catalog/items/${value}`), api<IssueGroupDto[]>(`/api/issues/item/${value}`)])
    if (id.value === value) {
      detail.value = res
      issues.value = found
    }
  } catch (e) {
    if (id.value !== value) return
    toast.add({ title: 'Fiche indisponible', description: errorMessage(e), color: 'error' })
    id.value = null
  }
}, { immediate: true })

const GB = 1024 ** 3
const langs = (codes: string[]) => (codes.length ? codes.map(languageLabel).join(', ') : '—')
const yesNo = (v: boolean | null) => (v === null ? '—' : v ? 'oui' : 'non')
const MAX_FILES = 100

async function ignore(group: IssueGroupDto) {
  if (id.value === null) return
  try {
    await api('/api/exceptions', { method: 'POST', body: { source: group.key, itemId: id.value } })
    issues.value = issues.value.filter(g => g.key !== group.key)
    await refreshIssues()
    toast.add({ title: 'Signalement ignoré', description: `Ce titre n'apparaîtra plus dans « ${group.title} ».`, color: 'neutral' })
  } catch (e) {
    toast.add({ title: 'Impossible d\'ignorer', description: errorMessage(e), color: 'error' })
  }
}
</script>

<template>
  <USlideover
    v-model:open="open"
    :title="detail ? `${detail.item.title}${detail.item.year ? ` (${detail.item.year})` : ''}` : 'Chargement…'"
    :description="detail ? (detail.item.type === 'movie' ? 'Film' : 'Série') : undefined"
    :ui="{ content: 'w-full sm:max-w-2xl' }"
  >
    <template #body>
      <div v-if="detail" class="space-y-6 text-sm">
        <section class="flex gap-4">
          <PosterImage :id="detail.item.id" :title="detail.item.title" :type="detail.item.type" class="w-28 sm:w-36 shrink-0" />
          <div class="min-w-0 space-y-3">
            <div class="flex flex-wrap gap-1.5">
              <UBadge :label="detail.item.type === 'movie' ? 'Film' : 'Série'" variant="subtle" />
              <UBadge v-for="p in detail.presences" :key="`b-${p.instanceId}`" color="neutral" variant="outline" :label="p.instanceName" />
            </div>
            <div class="grid grid-cols-3 gap-2 max-w-md">
              <div class="rounded-lg bg-elevated/50 px-3 py-2">
                <p class="text-xs text-muted">Note</p>
                <p class="font-semibold"><RatingBadge v-if="detail.item.rating !== null" :value="detail.item.rating" /><span v-else>—</span></p>
              </div>
              <div class="rounded-lg bg-elevated/50 px-3 py-2">
                <p class="text-xs text-muted">Taille</p>
                <p class="font-semibold">{{ formatSize(detail.files.reduce((n, f) => n + f.size, 0) / GB) }}</p>
              </div>
              <div class="rounded-lg bg-elevated/50 px-3 py-2">
                <p class="text-xs text-muted">Lectures</p>
                <p class="font-semibold">{{ detail.history.reduce((n, h) => n + h.playCount, 0) }}</p>
              </div>
            </div>
            <p v-if="detail.item.genres.length" class="text-muted">{{ detail.item.genres.join(' · ') }}</p>
          </div>
        </section>

        <section v-if="issues.length">
          <h3 class="font-semibold mb-2">Signalements</h3>
          <ul class="space-y-1.5">
            <li v-for="g in issues" :key="g.key" class="flex items-center gap-2 rounded-lg border border-default px-3 py-2">
              <UIcon :name="g.icon" class="size-4 shrink-0" :class="SEVERITY_TEXT[g.severity]" />
              <span class="flex-1 min-w-0">{{ g.title }}</span>
              <UBadge :color="SEVERITY_COLORS[g.severity]" variant="subtle" size="sm" :label="SEVERITY_LABELS[g.severity]" />
              <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-eye-off" label="Ignorer" @click="ignore(g)" />
            </li>
          </ul>
        </section>

        <section>
          <h3 class="font-semibold mb-2">Informations</h3>
          <dl class="grid grid-cols-[10rem_1fr] gap-y-1">
            <dt class="text-muted">Langue originale</dt><dd>{{ detail.item.originalLanguage ? languageLabel(detail.item.originalLanguage) : '—' }}</dd>
            <dt class="text-muted">Genres</dt><dd>{{ detail.item.genres.join(', ') || '—' }}</dd>
            <dt class="text-muted">Notes</dt><dd>TMDB {{ detail.item.ratingTmdb ?? '—' }} · IMDb {{ detail.item.ratingImdb ?? '—' }}<template v-if="detail.item.type === 'series'"> · Sonarr {{ detail.item.rating ?? '—' }}</template></dd>
            <dt class="text-muted">Ajouté le</dt><dd>{{ formatDate(detail.item.addedAt) }}</dd>
            <dt class="text-muted">Identifiants</dt><dd>TMDB {{ detail.item.tmdbId ?? '—' }} · TVDB {{ detail.item.tvdbId ?? '—' }} · IMDb {{ detail.item.imdbId ?? '—' }}</dd>
          </dl>
        </section>

        <section>
          <h3 class="font-semibold mb-2">Présences</h3>
          <table class="w-full [&_th]:pr-3 [&_td]:pr-3">
            <thead class="text-left text-muted"><tr><th>Instance</th><th>Bibliothèque / dossier racine</th><th>Suivi</th><th>Chemin réel</th></tr></thead>
            <tbody>
              <tr v-for="p in detail.presences" :key="`${p.instanceId}-${p.externalId}`" class="border-t border-default">
                <td class="py-1">{{ p.instanceName }} <span class="text-muted">({{ KIND_LABELS[p.kind] }})</span></td>
                <td>{{ p.library ?? p.rootFolder ?? '—' }}</td>
                <td>{{ yesNo(p.monitored) }}</td>
                <td class="break-all"><code>{{ p.realFolder ?? 'sans correspondance' }}</code></td>
              </tr>
            </tbody>
          </table>
        </section>

        <section>
          <h3 class="font-semibold mb-2">Fichiers ({{ detail.files.length }})</h3>
          <table v-if="detail.files.length" class="w-full [&_th]:pr-3 [&_td]:pr-3">
            <thead class="text-left text-muted"><tr><th v-if="detail.item.type === 'series'">Épisode</th><th>Résolution</th><th>Codec</th><th>Audio</th><th>Sous-titres</th><th>Taille</th></tr></thead>
            <tbody>
              <tr v-for="(f, i) in detail.files.slice(0, MAX_FILES)" :key="i" class="border-t border-default" :title="f.realPath ?? ''">
                <td v-if="detail.item.type === 'series'" class="py-1">S{{ String(f.season ?? 0).padStart(2, '0') }}E{{ String(f.episode ?? 0).padStart(2, '0') }}</td>
                <td class="py-1">{{ resolutionLabel(f.resolution) }}{{ f.isRemux ? ' remux' : '' }}</td>
                <td>{{ f.videoCodec ?? '—' }}</td>
                <td>{{ langs(f.audioLanguages) }}</td>
                <td>{{ langs(f.subtitleLanguages) }}</td>
                <td>{{ formatSize(f.size / GB) }}</td>
              </tr>
            </tbody>
          </table>
          <p v-if="detail.files.length > MAX_FILES" class="text-muted mt-1">… et {{ detail.files.length - MAX_FILES }} autres fichiers.</p>
          <p v-if="!detail.files.length" class="text-muted">Aucun fichier connu des *arr.</p>
        </section>

        <section>
          <h3 class="font-semibold mb-2">Visionnage</h3>
          <ul v-if="detail.history.length" class="space-y-1">
            <li v-for="(h, i) in detail.history" :key="i">{{ h.serverName }} · {{ h.user }} — {{ h.playCount }} lecture(s), dernière le {{ formatDateTime(h.lastWatchedAt) }}</li>
          </ul>
          <p v-else class="text-muted">Jamais vu.</p>
        </section>
      </div>
    </template>
  </USlideover>
</template>
