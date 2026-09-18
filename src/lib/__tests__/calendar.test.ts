import { describe, it, expect } from 'vitest'
import { daysInMonth, isRealCalendarDate } from '../calendar'

describe('daysInMonth', () => {
  it('knows the short months', () => {
    expect(daysInMonth(2026, 4)).toBe(30)
    expect(daysInMonth(2026, 6)).toBe(30)
    expect(daysInMonth(2026, 9)).toBe(30)
    expect(daysInMonth(2026, 11)).toBe(30)
  })

  it('knows the long months', () => {
    expect(daysInMonth(2026, 1)).toBe(31)
    expect(daysInMonth(2026, 12)).toBe(31)
  })

  it('handles February and leap years', () => {
    expect(daysInMonth(2026, 2)).toBe(28)
    expect(daysInMonth(2024, 2)).toBe(29)
    expect(daysInMonth(2000, 2)).toBe(29)
    expect(daysInMonth(1900, 2)).toBe(28)
  })
})

describe('isRealCalendarDate', () => {
  it('rejects 31 February rather than rolling it into March', () => {
    expect(isRealCalendarDate(2010, 2, 31)).toBe(false)
  })

  it('rejects the other impossible days', () => {
    expect(isRealCalendarDate(2010, 4, 31)).toBe(false)
    expect(isRealCalendarDate(2011, 2, 29)).toBe(false)
    expect(isRealCalendarDate(2010, 6, 31)).toBe(false)
  })

  it('accepts real dates, including 29 February in a leap year', () => {
    expect(isRealCalendarDate(2010, 2, 28)).toBe(true)
    expect(isRealCalendarDate(2024, 2, 29)).toBe(true)
    expect(isRealCalendarDate(2010, 12, 31)).toBe(true)
    expect(isRealCalendarDate(2010, 1, 1)).toBe(true)
  })

  it('rejects out-of-range months and days outright', () => {
    expect(isRealCalendarDate(2010, 0, 15)).toBe(false)
    expect(isRealCalendarDate(2010, 13, 15)).toBe(false)
    expect(isRealCalendarDate(2010, 5, 0)).toBe(false)
    expect(isRealCalendarDate(2010, 5, 32)).toBe(false)
  })

  it('rejects non-integers', () => {
    expect(isRealCalendarDate(2010, 5, NaN)).toBe(false)
    expect(isRealCalendarDate(NaN, 5, 10)).toBe(false)
  })
})
