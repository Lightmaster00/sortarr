import { describe, expect, it } from 'vitest'
import { FIELD_BY_KEY, OPERATORS, validateFilter, type FieldType, type FilterField, type Op, type ValueKind } from '../../shared/filters'
import { toFilterValue } from '../../app/utils/filterValues'

function opFor(type: FieldType, kind: ValueKind): { field: FilterField; op: Op } {
  const field = Object.values(FIELD_BY_KEY).find(f => f.type === type && OPERATORS[type].some(o => o.value === kind))!
  return { field: field.key, op: OPERATORS[type].find(o => o.value === kind)!.op }
}
const errors = (type: FieldType, kind: ValueKind, raw: unknown) => {
  const { field, op } = opFor(type, kind)
  return validateFilter({ kind: 'cond', field, op, value: toFilterValue(kind, type, raw) })
}

describe('toFilterValue', () => {
  it('accepte les saisies valides', () => {
    expect(errors('number', 'single', 12)).toEqual([])
    expect(errors('number', 'single', '1.5')).toEqual([])
    expect(errors('string', 'single', 'dune')).toEqual([])
    expect(errors('enum', 'single', 'movie')).toEqual([])
    expect(errors('number', 'pair', [1, 5])).toEqual([])
    expect(errors('list', 'multi', ['fr', ' en '])).toEqual([])
    expect(toFilterValue('multi', 'number', ['1', 2, 'x', ' '])).toEqual([1, 2])
    expect(errors('date', 'days', 45)).toEqual([])
    expect(errors('date', 'days', 0)).toEqual([])
    expect(errors('date', 'date', '2026-03-01')).toEqual([])
  })

  it('stocke un nombre pour les jours', () => {
    expect(toFilterValue('days', 'date', '45')).toBe(45)
  })

  it('rejette les saisies vidées, sans les convertir en 0', () => {
    expect(toFilterValue('single', 'number', null)).toBeNull()
    expect(toFilterValue('days', 'date', null)).toBeNull()
    expect(toFilterValue('days', 'date', Number.NaN)).toBeNull()
    expect(errors('number', 'single', null)).not.toEqual([])
    expect(errors('number', 'single', '')).not.toEqual([])
    expect(errors('number', 'pair', [1, null])).not.toEqual([])
    expect(errors('list', 'multi', [' ', ''])).not.toEqual([])
    expect(errors('date', 'days', null)).not.toEqual([])
    expect(errors('date', 'days', -1)).not.toEqual([])
    expect(errors('date', 'date', '')).not.toEqual([])
    expect(errors('string', 'single', '')).not.toEqual([])
  })
})
