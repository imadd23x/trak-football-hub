import { afterEach, describe, expect, it } from 'vitest'
import { i18n, showLanguage, SOURCE_LANGUAGE } from '@/lib/i18n'
import { dayMonth, weekdayDayMonth } from '@/lib/squad/format'
import { POSITION_WORD } from '@/lib/position-words'

/* TRAK-407 (Languages 2/8, Squad): dates and positions follow the language; English is as it was. */

afterEach(async () => {
  await i18n.changeLanguage(SOURCE_LANGUAGE)
  localStorage.clear()
})

describe('TRAK-407: the coach\'s Squad in Greek', () => {
  it('writes a day in English as before, and in Greek once picked', async () => {
    expect(dayMonth('2026-10-17')).toBe('17 Oct')
    expect(weekdayDayMonth('2026-10-24')).toBe('Sat 24 Oct')
    await showLanguage('el')
    expect(dayMonth('2026-10-17')).toBe('17 Οκτ')
    expect(weekdayDayMonth('2026-10-24')).toBe('Σάβ 24 Οκτ')
  })

  it('names a saved position in the language showing', async () => {
    expect(i18n.t(POSITION_WORD.Goalkeeper)).toBe('Goalkeeper')
    await showLanguage('el')
    expect(i18n.t(POSITION_WORD.Goalkeeper)).toBe('Τερματοφύλακας')
    expect(i18n.t('coachSquad:notEligibleWhy', { count: 2 })).toContain('οι οικογένειες')
  })

  it('keeps English as it was', () => {
    expect(i18n.t('coachSquad:notEligibleWhy', { count: 1 })).toBe(" — consent pending, so the family can't see or answer events yet.")
    expect(i18n.t('coachSquad:squadPlayers', { squad: 'U14' })).toBe('U14 players')
  })
})
