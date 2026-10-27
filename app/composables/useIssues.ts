import type { IssuesSummary } from '#shared/rules'

/** Résumé des signalements, partagé entre le menu, le tableau de bord et la page « À traiter ». */
export function useIssues() {
  const api = useApi()
  const summary = useState<IssuesSummary | null>('issues', () => null)
  async function refresh(): Promise<void> {
    try {
      summary.value = await api<IssuesSummary>('/api/issues')
    } catch {
      // Les pages affichent leurs propres erreurs ; le menu garde l'ancien compteur.
    }
  }
  return { summary, refresh }
}
