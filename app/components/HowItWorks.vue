<script setup lang="ts">
defineProps<{ compact?: boolean }>()
</script>

<template>
  <div class="grid gap-3 md:grid-cols-[1fr_auto_1fr_auto_1fr] items-stretch">
    <div class="rounded-xl border border-default p-4 bg-elevated/40">
      <div class="flex gap-1.5 mb-2"><ServiceLogo kind="radarr" size="sm" /><ServiceLogo kind="sonarr" size="sm" /></div>
      <p class="font-medium text-sm">Radarr et Sonarr</p>
      <p v-if="!compact" class="text-xs text-muted mt-1">Ce que tu possèdes : fichiers, qualité, langues, dossiers.</p>
    </div>
    <div class="hidden md:flex items-center text-muted"><UIcon name="i-lucide-arrow-right" class="size-5" /></div>
    <div class="rounded-xl border-2 border-primary/60 p-4 bg-primary/5">
      <div class="flex mb-2"><img src="/icon.svg" alt="" class="size-7"></div>
      <p class="font-medium text-sm">Sortarr croise tout</p>
      <p v-if="!compact" class="text-xs text-muted mt-1">Un seul catalogue pour repérer ce qui est mal rangé, en double, jamais vu ou de mauvaise qualité.</p>
    </div>
    <div class="hidden md:flex items-center text-muted"><UIcon name="i-lucide-arrow-left" class="size-5" /></div>
    <div class="rounded-xl border border-default p-4 bg-elevated/40">
      <div class="flex gap-1.5 mb-2"><ServiceLogo kind="plex" size="sm" /><ServiceLogo kind="jellyfin" size="sm" /></div>
      <p class="font-medium text-sm">Plex et Jellyfin</p>
      <p v-if="!compact" class="text-xs text-muted mt-1">Ce qui est visible dans les bibliothèques, et ce qui a été regardé.</p>
    </div>
  </div>
  <p v-if="!compact" class="text-xs text-muted mt-2 flex items-center gap-1.5">
    <UIcon name="i-lucide-shield-check" class="size-4 text-success" />
    Sortarr ne modifie rien chez tes services : il lit seulement leurs informations.
  </p>
</template>
