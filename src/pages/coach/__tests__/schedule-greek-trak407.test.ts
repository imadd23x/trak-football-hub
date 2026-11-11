import { afterEach, describe, expect, it } from 'vitest'
import { i18n, showLanguage, SOURCE_LANGUAGE } from '@/lib/i18n'
import { blankForm, formProblem, formatEventDay, pastDateProblem, PAST_DATE_PROBLEM } from '@/lib/coach-events'

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

  it('says what is wrong with the event form in the language showing', async () => {
    const form = { ...blankForm('2026-11-12'), time: '' }
    expect(formProblem(form)).toBe('Pick a start time')
    expect(pastDateProblem('2026-11-01', '2026-11-11')).toBe(PAST_DATE_PROBLEM)
    await showLanguage('el')
    expect(formProblem(form)).toBe('Διαλέξτε ώρα έναρξης')
    expect(pastDateProblem('2026-11-01', '2026-11-11')).toBe('Η ημερομηνία πέρασε: κάντε καταγραφή')
  })

  it('counts who is here and who cannot come, in Greek', async () => {
    await showLanguage('el')
    expect(i18n.t('coachSchedule:registerSaved', { count: 14 })).toBe('Οι παρουσίες αποθηκεύτηκαν: 14 παρόντες.')
    expect(i18n.t('coachSchedule:cantMakeItNames', { count: 1, names: 'Άρης' })).toBe('1 δεν μπορεί: Άρης')
    expect(i18n.t('coachSchedule:cantMakeItNames', { count: 2, names: 'Άρης, Νίκος' })).toBe('2 δεν μπορούν: Άρης, Νίκος')
    expect(i18n.t('coachSchedule:fxAdd', { count: 1 })).toBe('Προσθήκη 1 αγώνα')
    expect(i18n.t('coachSchedule:fxAdd', { count: 3 })).toBe('Προσθήκη 3 αγώνων')
  })

  it('keeps the pop-ups\' English as it was', () => {
    expect(i18n.t('coachSchedule:registerSaved', { count: 14 })).toBe('Register saved: 14 present.')
    expect(i18n.t('coachSchedule:goalCount', { count: 1 })).toBe('1 goal')
    expect(i18n.t('coachSchedule:goalCount', { count: 2 })).toBe('2 goals')
    expect(i18n.t('coachSchedule:fxNeedFixing', { count: 1 })).toBe('1 needs fixing')
    expect(i18n.t('coachSchedule:fxAdded', { count: 2 })).toBe('Added 2 fixtures.')
  })

  it('keeps English as it was', () => {
    expect(i18n.t('coachSchedule:savedDraft')).toBe('Saved as a draft. Tap Publish when it’s ready.')
    expect(i18n.t('coachSchedule:addedFixtures', { count: 2 })).toBe("Added 2 fixtures as drafts. Publish each when it's ready.")
  })
})
