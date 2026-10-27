import type { Severity } from '#shared/rules'

/** Classes écrites en entier pour que Tailwind les génère. */
export const SEVERITY_TEXT: Record<Severity, string> = { erreur: 'text-error', avertissement: 'text-warning', info: 'text-info' }
