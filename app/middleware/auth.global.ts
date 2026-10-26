export default defineNuxtRouteMiddleware(async (to) => {
  let status: { hasAdmin: boolean; authenticated: boolean }
  try {
    status = await $fetch<{ hasAdmin: boolean; authenticated: boolean }>('/api/auth/status')
  } catch {
    return // L'API applique elle-même l'authentification et les pages affichent leurs erreurs.
  }
  if (!status.hasAdmin) return to.path === '/setup' ? undefined : navigateTo('/setup')
  if (!status.authenticated) return to.path === '/login' ? undefined : navigateTo('/login')
  if (to.path === '/login' || to.path === '/setup') return navigateTo('/')
})
