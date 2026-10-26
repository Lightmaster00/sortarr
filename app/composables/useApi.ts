export function useApi() {
  return $fetch.create({
    headers: { 'x-sortarr': '1' },
    onResponseError({ response }) {
      if (response.status === 401 && !['/login', '/setup'].includes(window.location.pathname)) {
        void navigateTo('/login')
      }
    },
  })
}

/** Message lisible d'une erreur renvoyée par l'API (ou d'une erreur réseau). */
export function errorMessage(error: unknown): string {
  const e = error as { data?: { message?: string; data?: { details?: string[] } }; message?: string }
  const details = e?.data?.data?.details?.length ? ` (${e.data.data.details.join(' ; ')})` : ''
  return `${e?.data?.message ?? e?.message ?? 'Erreur inconnue'}${details}`
}
