import { defineApiHandler, parseId } from '~~/server/lib/api'
import { getItemDetail } from '~~/server/lib/catalog'
import { AppError } from '~~/server/lib/errors'

export default defineApiHandler((event) => {
  const detail = getItemDetail(parseId(event))
  if (!detail) throw new AppError('Titre introuvable.', 404)
  return detail
})
