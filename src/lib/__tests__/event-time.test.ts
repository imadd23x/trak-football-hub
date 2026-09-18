import { describe, it, expect } from 'vitest'
import { toInstant, localParts, isTimeTBC, normalizeInstant, calendarFields, displayEventTime } from '../event-time'

describe('event time round-trip', () => {
  it('gives back the wall clock the coach typed, whatever zone the run is in', () => {
    const iso = toInstant('2026-03-01', '18:00')!
    expect(localParts(iso)).toEqual({ date: '2026-03-01', time: '18:00' })
  })

  it('produces a real instant carrying an offset, not a naive string', () => {
    const iso = toInstant('2026-03-01', '18:00')!
    expect(iso).toMatch(/Z$/)
    expect(Number.isNaN(new Date(iso).getTime())).toBe(false)
  })

  it('does not store the typed time as though it were UTC', () => {
    // The old bug: `${date}T${time}:00` handed straight to timestamptz.
    const naive = '2026-03-01T18:00:00'
    const iso = toInstant('2026-03-01', '18:00')!
    const offsetMinutes = new Date('2026-03-01T12:00:00').getTimezoneOffset()
    if (offsetMinutes !== 0) {
      expect(iso.slice(11, 16)).not.toBe(naive.slice(11, 16))
    }
    // Either way the instant must be the local 18:00.
    expect(new Date(iso).getHours()).toBe(18)
  })

  it('treats a blank time as local midnight and reports it as TBC', () => {
    const iso = toInstant('2026-03-01', null)!
    expect(isTimeTBC(iso)).toBe(true)
    expect(localParts(iso).time).toBe('00:00')
  })

  it('does not call a real evening kick-off TBC', () => {
    expect(isTimeTBC(toInstant('2026-03-01', '18:00')!)).toBe(false)
  })

  it('survives a date near a month boundary', () => {
    expect(localParts(toInstant('2026-12-31', '23:30')!)).toEqual({ date: '2026-12-31', time: '23:30' })
    expect(localParts(toInstant('2026-01-01', '00:30')!)).toEqual({ date: '2026-01-01', time: '00:30' })
  })

  it('returns empty parts for an unparseable value rather than throwing', () => {
    expect(localParts('not a date')).toEqual({ date: '', time: '' })
    expect(isTimeTBC('not a date')).toBe(true)
  })
})

describe('normalizeInstant', () => {
  it('reads a naive parser string as local wall clock, not as UTC', () => {
    const iso = normalizeInstant('2026-03-01T18:00:00')!
    expect(localParts(iso)).toEqual({ date: '2026-03-01', time: '18:00' })
  })

  it('leaves a value that already carries an offset alone', () => {
    const already = '2026-03-01T18:00:00Z'
    expect(normalizeInstant(already)).toBe(new Date(already).toISOString())
  })

  it('handles a date with no time at all', () => {
    expect(localParts(normalizeInstant('2026-03-01')!).time).toBe('00:00')
  })

  it('returns null for empty or unusable input', () => {
    expect(normalizeInstant(null)).toBeNull()
    expect(normalizeInstant('')).toBeNull()
  })
})

describe('toInstant strictness — Imad review findings on #20', () => {
  it('returns null instead of throwing on a malformed date', () => {
    // Previously RangeError: Invalid time value, which crashed saveAllDrafts
    // rather than reporting one bad row.
    expect(() => toInstant('not a date', null)).not.toThrow()
    expect(toInstant('not a date', null)).toBeNull()
  })

  it('rejects 31 February rather than rolling it into March', () => {
    expect(toInstant('2026-02-31', '10:00')).toBeNull()
    expect(toInstant('2026-04-31', '10:00')).toBeNull()
    expect(toInstant('2026-02-29', '10:00')).toBeNull()
  })

  it('accepts 29 February in a leap year', () => {
    expect(toInstant('2024-02-29', '10:00')).not.toBeNull()
  })

  it('rejects a malformed time instead of silently using midnight', () => {
    expect(toInstant('2026-03-01', 'banana')).toBeNull()
    expect(toInstant('2026-03-01', '25:00')).toBeNull()
    expect(toInstant('2026-03-01', '10:75')).toBeNull()
  })

  it('still treats a genuinely absent time as midnight', () => {
    expect(toInstant('2026-03-01', null)).not.toBeNull()
    expect(toInstant('2026-03-01', '')).not.toBeNull()
  })

  it('normalizeInstant rejects the same malformed values', () => {
    expect(normalizeInstant('not a date')).toBeNull()
    expect(normalizeInstant('2026-02-31T10:00:00')).toBeNull()
  })
})

describe('normalizeInstant — offset-bearing values are validated too (Imad, PR30 review)', () => {
  it('rejects an impossible day carrying a Z', () => {
    // JavaScript parses this as 3 March rather than rejecting it, so the
    // calendar save path stored the wrong date.
    expect(normalizeInstant('2026-02-31T10:00:00Z')).toBeNull()
    expect(normalizeInstant('2026-04-31T10:00:00Z')).toBeNull()
  })

  it('rejects an impossible day carrying a numeric offset', () => {
    expect(normalizeInstant('2026-02-31T10:00:00+04:00')).toBeNull()
    expect(normalizeInstant('2026-02-31T10:00:00+0400')).toBeNull()
    expect(normalizeInstant('2026-02-31T10:00:00-05:00')).toBeNull()
  })

  it('rejects 29 February in a non-leap year however it is written', () => {
    expect(normalizeInstant('2026-02-29T10:00:00Z')).toBeNull()
    expect(normalizeInstant('2026-02-29T10:00:00+04:00')).toBeNull()
    expect(normalizeInstant('2026-02-29T10:00:00')).toBeNull()
  })

  it('still accepts real dates with an offset, preserving the instant', () => {
    expect(normalizeInstant('2024-02-29T10:00:00Z')).toBe('2024-02-29T10:00:00.000Z')
    expect(normalizeInstant('2026-03-01T18:00:00Z')).toBe('2026-03-01T18:00:00.000Z')
    // +04:00 means 18:00 in Dubai, which is 14:00Z — the offset is authoritative.
    expect(normalizeInstant('2026-03-01T18:00:00+04:00')).toBe('2026-03-01T14:00:00.000Z')
  })
})

describe('normalizeInstant — input forms Kostas found rejected or misread (PR30 review)', () => {
  it('treats a lowercase z as an offset, not as local wall clock', () => {
    expect(normalizeInstant('2026-03-01T18:00:00z')).toBe('2026-03-01T18:00:00.000Z')
  })

  it('accepts an hour-only offset', () => {
    // Valid ISO, and Date.parse rejects it unexpanded.
    expect(normalizeInstant('2026-03-01T18:00:00+04')).toBe('2026-03-01T14:00:00.000Z')
    expect(normalizeInstant('2026-03-01T18:00:00-05')).toBe('2026-03-01T23:00:00.000Z')
  })

  it('accepts a space between date and time, as Postgres writes it', () => {
    const iso = normalizeInstant('2026-03-01 18:00:00')!
    expect(iso).not.toBeNull()
    expect(localParts(iso)).toEqual({ date: '2026-03-01', time: '18:00' })
  })

  it('still validates the calendar date in every one of those forms', () => {
    expect(normalizeInstant('2026-02-31T10:00:00z')).toBeNull()
    expect(normalizeInstant('2026-02-31T10:00:00+04')).toBeNull()
    expect(normalizeInstant('2026-02-31 10:00:00')).toBeNull()
  })
})

describe('calendar columns (PR41 contract)', () => {
  it('stores the day and wall clock the coach typed, unconverted', () => {
    expect(calendarFields('2026-03-01', '18:00')).toEqual({
      event_date: '2026-03-01',
      start_time: '18:00:00',
    })
  })

  it('records an unknown time as NULL rather than midnight', () => {
    // An instant cannot express "1 March, time to be confirmed"; encoding it as
    // local midnight is what moved the date across timezones.
    expect(calendarFields('2026-03-01', null)).toEqual({
      event_date: '2026-03-01',
      start_time: null,
    })
  })

  it('refuses the same input toInstant refuses, so the columns cannot disagree', () => {
    expect(calendarFields('2026-02-31', '10:00')).toBeNull()
    expect(calendarFields('not a date', null)).toBeNull()
    expect(calendarFields('2026-03-01', '25:00')).toBeNull()
  })

  it('reads the calendar columns in preference to the instant', () => {
    expect(displayEventTime({
      event_date: '2026-03-01', start_time: '18:00:00',
      starts_at: '2026-02-28T20:00:00.000Z',
    })).toEqual({ date: '2026-03-01', time: '18:00' })
  })

  it('falls back to the instant for a row written before the backfill', () => {
    const iso = toInstant('2026-03-01', '18:00')!
    expect(displayEventTime({ starts_at: iso })).toEqual({ date: '2026-03-01', time: '18:00' })
  })

  it('reports an untimed legacy row as TBC', () => {
    const iso = toInstant('2026-03-01', null)!
    expect(displayEventTime({ starts_at: iso }).time).toBeNull()
  })
})
