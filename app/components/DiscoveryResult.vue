<script setup lang="ts">
import type { Discovery } from '#shared/instances'

defineProps<{ discovery: Discovery }>()
</script>

<template>
  <UAlert color="success" variant="subtle" icon="i-lucide-circle-check" :title="`Connexion réussie — version ${discovery.version}`">
    <template #description>
      <div class="space-y-2 mt-1 text-sm">
        <div v-if="discovery.libraries.length">
          <p class="font-medium">Bibliothèques trouvées</p>
          <ul class="mt-1 space-y-0.5">
            <li v-for="l in discovery.libraries" :key="l.id" class="flex items-start gap-1.5">
              <UIcon :name="l.type === 'show' || l.type === 'tvshows' ? 'i-lucide-tv' : 'i-lucide-film'" class="size-4 mt-0.5 shrink-0" />
              <span>{{ l.name }} <span class="text-xs opacity-75 font-mono">{{ l.locations.join(', ') }}</span></span>
            </li>
          </ul>
        </div>
        <div v-else-if="discovery.roots.length">
          <p class="font-medium">Dossiers racines</p>
          <ul class="mt-1 space-y-0.5">
            <li v-for="r in discovery.roots" :key="r.path" class="flex items-center gap-1.5"><UIcon name="i-lucide-folder" class="size-4 shrink-0" /><span class="font-mono text-xs">{{ r.path }}</span></li>
          </ul>
        </div>
        <p v-if="discovery.qualityProfiles.length" class="text-xs">
          <span class="font-medium">Profils de qualité :</span> {{ discovery.qualityProfiles.join(', ') }}
        </p>
        <p class="text-xs opacity-80">Les dossiers seront retrouvés automatiquement sur le disque à l'enregistrement.</p>
      </div>
    </template>
  </UAlert>
</template>
