/** Erreur métier : son message est affiché tel quel à l'utilisateur. */
export class AppError extends Error {
  constructor(message: string, public readonly statusCode = 400, public readonly details: string[] = []) {
    super(message)
    this.name = 'AppError'
  }
}
