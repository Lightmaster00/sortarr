import { defineApiHandler, parseId } from '~~/server/lib/api'
import { AppError } from '~~/server/lib/errors'
import { getPoster } from '~~/server/lib/posters'

export default defineApiHandler(async (event) => {
  const poster = await getPoster(parseId(event))
  if (!poster) throw new AppError('Pas d\'affiche pour ce titre.', 404)
  setResponseHeader(event, 'Content-Type', poster.type)
  setResponseHeader(event, 'Cache-Control', 'private, max-age=604800')
  setResponseHeader(event, 'X-Content-Type-Options', 'nosniff')
  return poster.data
})
