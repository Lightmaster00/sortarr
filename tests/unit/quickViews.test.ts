import { describe, expect, it } from 'vitest'
import { validateFilter } from '../../shared/filters'
import { QUICK_VIEWS } from '../../app/utils/quickViews'

describe('vues rapides', () => {
  it('sont toutes des filtres valides', () => {
    for (const v of QUICK_VIEWS) expect(validateFilter(v.filter()), v.key).toEqual([])
  })
})
