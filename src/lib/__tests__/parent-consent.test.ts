import { describe, expect, it } from 'vitest'
import { parseAwaitingConsent } from '../parent-consent'

const child = {
  player_user_id: 'AAAAAAAA-1111-4111-8111-111111111111',
  full_name: '  Alex Synthetic  ',
  age_years: 12,
}

describe('pending approval response boundary', () => {
  it('accepts a real empty result and normalizes a usable child identity', () => {
    expect(parseAwaitingConsent([])).toEqual([])
    expect(parseAwaitingConsent([child])).toEqual([{
      ...child, player_user_id: child.player_user_id.toLowerCase(), full_name: 'Alex Synthetic',
    }])
  })

  it.each([
    null, undefined, {}, '[]', [null], [true], [[]],
    [{ ...child, player_user_id: 'not-a-uuid' }],
    [{ ...child, full_name: null }], [{ ...child, full_name: '  ' }],
    [{ ...child, age_years: null }], [{ ...child, age_years: '12' }],
    [{ ...child, age_years: -1 }], [{ ...child, age_years: 12.5 }],
    [{ ...child, age_years: Infinity }], [{ ...child, age_years: Number.MAX_SAFE_INTEGER + 1 }],
  ])('rejects unusable data rather than treating it as no pending approval (%j)', data => {
    expect(() => parseAwaitingConsent(data)).toThrow('Invalid pending approval response')
  })

  it('rejects duplicate children regardless of UUID casing', () => {
    expect(() => parseAwaitingConsent([
      child, { ...child, player_user_id: child.player_user_id.toLowerCase() },
    ])).toThrow('Duplicate pending approval response')
  })

  it('rejects the complete response when a later row is unusable', () => {
    expect(() => parseAwaitingConsent([child, { ...child, full_name: null }])).toThrow()
  })
})
