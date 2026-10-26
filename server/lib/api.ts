import { createError, defineEventHandler, getRouterParam, type EventHandlerRequest, type H3Event } from 'h3'
import type { ZodType } from 'zod'
import { AppError } from './errors'
import { HttpError } from './http'

/** Route API : les AppError deviennent des erreurs HTTP avec un message lisible. */
export function defineApiHandler<T>(fn: (event: H3Event<EventHandlerRequest>) => T | Promise<T>) {
  return defineEventHandler(async (event) => {
    try {
      return await fn(event)
    } catch (error) {
      throw toHttpError(error)
    }
  })
}

export function toHttpError(error: unknown): unknown {
  if (error instanceof AppError) {
    return createError({ statusCode: error.statusCode, statusMessage: 'Error', message: error.message, data: { details: error.details } })
  }
  if (error instanceof HttpError) {
    return createError({ statusCode: 502, statusMessage: 'Bad Gateway', message: error.message, data: { details: [] } })
  }
  return error
}

export function parseOrThrow<T>(schema: ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data)
  if (!result.success) {
    const details = result.error.issues.map(i => (i.path.length ? `${i.path.join('.')} : ${i.message}` : i.message))
    throw new AppError('Données invalides.', 400, details)
  }
  return result.data
}

export function parseId(event: H3Event): number {
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id) || id <= 0) throw new AppError('Identifiant invalide.')
  return id
}
