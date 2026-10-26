<script setup lang="ts">
import type { ItemDetail } from '#shared/catalog'
import { KIND_LABELS } from '#shared/instances'
import { formatDate, formatDateTime, formatSize } from '#shared/format'
import { languageLabel, resolutionLabel } from '#shared/media'

const id = defineModel<number | null>('id', { required: true })
const api = useApi()
const toast = useToast()
const detail = ref<ItemDetail | null>(null)
const open = computed({
  get: () => id.value !== null,
  set: (value: boolean) => { if (!value) id.value = null },
})

watch(id, async (value) => {
  if (value === null) return
  detail.value = null
  try {
    const res = await api<ItemDetail>(`/api/catalog/items/${value}`)
    if (id.value === value) detail.value = res
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
</script>

<template>
  <USlideover
    v-model:open="open"
    :title="detail ? `${detail.item.title}${detail.item.year ? ` (${detail.item.year})` : ''}` : 'Chargement…'"
    :description="detail ? (detail.item.type === 'movie' ? 'Film' : 'Série') : undefined"
    :ui="{ content: 'max-w-3xl' }"
  >
    <template #body>
      <div v-if="detail" class="space-y-6 text-sm">
        <section>
          <h3 class="font-semibold mb-2">Informations</h3>
          <dl class="grid grid-cols-[10rem_1fr] gap-y-1">
            <dt class="text-muted">Langue originale</dt><dd>{{ detail.item.originalLanguage ? languageLabel(detail.item.originalLanguage) : '—' }}</dd>
            <dt class="text-muted">Genres</dt><dd>{{ detail.item.genres.join(', ') || '—' }}</dd>
            <dt class="text-muted">Notes</dt><dd>TMDB {{ detail.item.ratingTmdb ?? '—' }} · IMDb {{ detail.item.ratingImdb ?? '—' }}</dd>
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
