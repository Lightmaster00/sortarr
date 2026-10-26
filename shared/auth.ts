import { z } from 'zod'

export const MIN_PASSWORD_LENGTH = 8

const password = z.string().min(MIN_PASSWORD_LENGTH, `Au moins ${MIN_PASSWORD_LENGTH} caractères`)

export const loginSchema = z.object({
  username: z.string().trim().min(1, "Nom d'utilisateur obligatoire"),
  password: z.string().min(1, 'Mot de passe obligatoire'),
})

export const setupSchema = z.object({
  username: z.string().trim().min(1, "Nom d'utilisateur obligatoire").max(60),
  password,
  confirm: z.string(),
}).refine(v => v.password === v.confirm, { message: 'Les mots de passe ne correspondent pas', path: ['confirm'] })

export const passwordChangeSchema = z.object({
  current: z.string().min(1, 'Mot de passe actuel obligatoire'),
  next: password,
  confirm: z.string(),
}).refine(v => v.next === v.confirm, { message: 'Les mots de passe ne correspondent pas', path: ['confirm'] })
