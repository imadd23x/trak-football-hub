import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  ageFromDateOfBirth,
  needsParentalConsent,
  CONSENT_THRESHOLD_AGE,
  CONSENT_PURPOSES,
} from '@/lib/consent'

/**
 * Keep calendar ages consistent with the database's UTC current_date. The
 * existing fifteenth-birthday policy tests stay until the coordinated backend
 * migration changes the pilot threshold to 18.
 */
describe('ageFromDateOfBirth', () => {
  afterEach(() => vi.useRealTimers())

  const freeze = (iso: string) => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(iso))
  }

  it('counts whole years, not elapsed time', () => {
    freeze('2026-09-12T12:00:00Z')
    expect(ageFromDateOfBirth('2011-09-12')).toBe(15)
  })

  it('does not round up the day before a birthday', () => {
    freeze('2026-09-11T12:00:00Z')
    expect(ageFromDateOfBirth('2011-09-12')).toBe(14)
  })

  it('ticks over on the birthday itself', () => {
    freeze('2026-09-12T00:00:01Z')
    expect(ageFromDateOfBirth('2011-09-12')).toBe(15)
  })

  it('handles a birthday later in the same year', () => {
    freeze('2026-03-01T12:00:00Z')
    expect(ageFromDateOfBirth('2011-12-25')).toBe(14)
  })

  it('returns null for an unparseable date rather than guessing', () => {
    expect(ageFromDateOfBirth('not-a-date')).toBeNull()
  })

  it.each([
    ['2026-09-11T23:59:59.999Z', 14],
    ['2026-09-12T00:00:00.000Z', 15],
  ])('uses the UTC calendar day at %s regardless of device timezone', (now, expected) => {
    freeze(now)
    expect(ageFromDateOfBirth('2011-09-12')).toBe(expected)
  })

  it.each([
    ['2024-02-28T12:00:00Z', 15],
    ['2024-02-29T00:00:00Z', 16],
    ['2025-02-28T12:00:00Z', 16],
    ['2025-03-01T00:00:00Z', 17],
  ])('counts a leap-day birthday correctly on %s', (now, expected) => {
    freeze(now)
    expect(ageFromDateOfBirth('2008-02-29')).toBe(expected)
  })

  it.each([
    '2011-02-29',
    '2012-02-30',
    '2012-02-31',
    '1900-02-29',
    '2011-04-31',
    '2011-00-12',
    '2011-13-12',
    '2011-09-00',
    '2011-09-32',
    '0000-01-01',
    '2011-9-12',
    '2011-09-2',
    '09/12/2011',
    '2011-09-12T00:00:00Z',
    '2011-09-12 ',
    ' 2011-09-12',
    '2011-09-12\n',
  ])('rejects invalid or non-date-only input %j', dob => {
    freeze('2026-09-12T12:00:00Z')
    expect(ageFromDateOfBirth(dob)).toBeNull()
  })

  it.each(['2026-09-13', '2026-10-01', '2027-01-01'])(
    'rejects a future birthday %s', dob => {
      freeze('2026-09-12T23:59:59.999Z')
      expect(ageFromDateOfBirth(dob)).toBeNull()
    },
  )

  it('accepts today as age zero', () => {
    freeze('2026-09-12T00:00:00Z')
    expect(ageFromDateOfBirth('2026-09-12')).toBe(0)
  })

  it('accepts February 29 in a Gregorian leap century', () => {
    freeze('2026-09-12T12:00:00Z')
    expect(ageFromDateOfBirth('2000-02-29')).toBe(26)
  })
})

describe('needsParentalConsent', () => {
  afterEach(() => vi.useRealTimers())

  const freeze = (iso: string) => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(iso))
  }

  it('is true below the threshold', () => {
    freeze('2026-09-12T12:00:00Z')
    expect(needsParentalConsent('2012-09-13')).toBe(true) // 13
  })

  it('is false on the day the child reaches the threshold', () => {
    freeze('2026-09-12T12:00:00Z')
    expect(needsParentalConsent('2011-09-12')).toBe(false) // exactly 15
  })

  it('is true on the last day before the threshold', () => {
    freeze('2026-09-11T12:00:00Z')
    expect(needsParentalConsent('2011-09-12')).toBe(true) // 14
  })

  it('preserves the existing missing-DOB result until the backend consent migration', () => {
    expect(needsParentalConsent('')).toBe(false)
  })
})

describe('consent purposes', () => {
  it('offers exactly one required purpose, so the rest are genuine choices', () => {
    expect(CONSENT_PURPOSES.filter(p => p.required)).toHaveLength(1)
    expect(CONSENT_PURPOSES.filter(p => !p.required).length).toBeGreaterThan(0)
  })

  it('keeps the existing threshold until the coordinated under-18 migration', () => {
    expect(CONSENT_THRESHOLD_AGE).toBe(15)
  })
})
