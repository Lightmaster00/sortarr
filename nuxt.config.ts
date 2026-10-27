// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  modules: ['@nuxt/ui'],
  css: ['~/assets/css/main.css'],
  // Icônes embarquées dans l'appli (y compris celles citées dans app/utils et shared) : pas d'affichage retardé.
  icon: {
    clientBundle: { scan: { globInclude: ['app/**/*.{vue,ts}', 'shared/**/*.ts'] }, icons: ['lucide:loader-circle', 'lucide:chevron-down', 'lucide:check', 'lucide:x'] },
  },
  devtools: { enabled: false },
  // Application d'administration privée : rendu côté client uniquement.
  ssr: false,
  nitro: {
    externals: { external: ['better-sqlite3'] },
  },
  app: {
    head: {
      title: 'Sortarr',
      htmlAttrs: { lang: 'fr' },
      meta: [{ name: 'robots', content: 'noindex, nofollow' }],
      link: [{ rel: 'icon', type: 'image/svg+xml', href: '/icon.svg' }],
    },
  },
})
