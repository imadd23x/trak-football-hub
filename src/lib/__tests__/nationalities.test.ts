import { describe, it, expect } from 'vitest'
import { NATIONALITIES, EUROPEAN_COUNTRIES } from '../constants'

describe('NATIONALITIES', () => {
  it('lets a UAE academy player pick their real nationality', () => {
    for (const n of ['United Arab Emirates', 'India', 'Pakistan', 'Egypt', 'Philippines', 'Syria', 'Jordan', 'Lebanon']) {
      expect(NATIONALITIES).toContain(n)
    }
  })

  it('still resolves every nationality a player could already have saved', () => {
    const missing = EUROPEAN_COUNTRIES.filter((c) => !NATIONALITIES.includes(c))
    expect(missing).toEqual([])
  })

  it('is sorted alphabetically so a long list stays navigable', () => {
    expect([...NATIONALITIES]).toEqual([...NATIONALITIES].slice().sort())
  })

  it('has no duplicate entries', () => {
    expect(new Set(NATIONALITIES).size).toBe(NATIONALITIES.length)
  })

  it('covers both pilot markets', () => {
    expect(NATIONALITIES).toContain('United Arab Emirates')
    expect(NATIONALITIES).toContain('Greece')
  })
})
