<script setup lang="ts">
import type { Discovery } from '#shared/instances'

defineProps<{ discovery: Discovery }>()
</script>

<template>
  <UAlert color="success" variant="subtle" icon="i-lucide-circle-check" :title="`Connexion réussie — version ${discovery.version}`">
    <template #description>
      <div class="space-y-2 mt-1 text-sm">
        <div v-if="discovery.libraries.length">
          <p class="font-medium">Bibliothèques</p>
          <ul class="list-disc pl-5">
            <li v-for="l in discovery.libraries" :key="l.id">{{ l.name }} — {{ l.locations.join(', ') }}</li>
          </ul>
        </div>
        <div v-else-if="discovery.roots.length">
          <p class="font-medium">Dossiers racines</p>
          <ul class="list-disc pl-5">
            <li v-for="r in discovery.roots" :key="r.path">{{ r.path }}</li>
          </ul>
        </div>
        <p v-if="discovery.qualityProfiles.length">
          <span class="font-medium">Profils de qualité :</span> {{ discovery.qualityProfiles.join(', ') }}
        </p>
      </div>
    </template>
  </UAlert>
</template>
