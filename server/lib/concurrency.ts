/** Comme Promise.all(items.map(fn)) mais avec au plus `limit` appels en parallèle. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  async function worker(): Promise<void> {
    while (next < items.length) {
      const index = next++
      out[index] = await fn(items[index]!, index)
    }
  }
  const workers = Math.max(1, Math.floor(limit) || 1)
  await Promise.all(Array.from({ length: Math.min(workers, items.length) }, worker))
  return out
}
