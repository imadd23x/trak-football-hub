import { afterEach, describe, expect, it } from 'vitest'
import { i18n, showLanguage, SOURCE_LANGUAGE } from '@/lib/i18n'
import { formatEventDay } from '@/lib/coach-events'

/* TRAK-407 (Languages 2/8, Schedule): the day's name follows the language, and the words that count use Greek's forms. */

afterEach(async () => {
  await i18n.changeLanguage(SOURCE_LANGUAGE)
  localStorage.clear()
})

describe('TRAK-407: the coach\'s Schedule in Greek', () => {
  it('names a day in English as before, and in Greek once picked', async () => {
    expect(formatEventDay('2026-11-12')).toBe('Thursday 12 November')
    await showLanguage('el')
    expect(formatEventDay('2026-11-12')).toBe('Πέμπτη 12 Νοεμβρίου')
  })

  it('says what was saved and what was not, in Greek', async () => {
    await showLanguage('el')
    expect(i18n.t('coachSchedule:savedNotPublished', { count: 1, why: '' }).trim()).toBe('Αποθηκεύτηκε ως πρόχειρο, δεν δημοσιεύτηκε.')
    expect(i18n.t('coachSchedule:savedNotPublished', { count: 3, why: '' }).trim()).toBe('Αποθηκεύτηκαν ως πρόχειρα, δεν δημοσιεύτηκαν.')
    expect(i18n.t('coachSchedule:draftsRemoved', { count: 1 })).toBe(' Αφαιρέθηκε 1 πρόχειρο.')
    expect(i18n.t('coachSchedule:cancelTitle', { title: 'Προπόνηση' })).toBe('Ακύρωση: Προπόνηση;')
  })

  it('keeps English as it was', () => {
    expect(i18n.t('coachSchedule:savedDraft')).toBe('Saved as a draft. Tap Publish when it’s ready.')
    expect(i18n.t('coachSchedule:addedFixtures', { count: 2 })).toBe("Added 2 fixtures as drafts. Publish each when it's ready.")
  })
})
