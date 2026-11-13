import { afterEach, describe, expect, it } from 'vitest'
import { i18n, showLanguage, SOURCE_LANGUAGE } from '@/lib/i18n'
import { appearanceWord, bandWord } from '@/lib/band-words'
import { APPEARANCE_LABEL, BANDS } from '@/lib/types'
import { waitText } from '@/lib/wait-reason'

/* TRAK-407 (Languages 2/8, Assess): every band and appearance has a word; what is saved stays as it is. */

afterEach(async () => {
  await i18n.changeLanguage(SOURCE_LANGUAGE)
  localStorage.clear()
})

describe('TRAK-407: Assess in Greek', () => {
  it('has a word for every band and appearance, the same in English', async () => {
    for (const band of BANDS) expect(bandWord(band.word)).toBe(band.word)
    for (const [value, label] of Object.entries(APPEARANCE_LABEL)) expect(appearanceWord(value)).toBe(label)
    await showLanguage('el')
    for (const band of BANDS) expect(bandWord(band.word)).not.toBe(band.word)
    for (const [value, label] of Object.entries(APPEARANCE_LABEL)) expect(appearanceWord(value)).not.toBe(label)
    expect(bandWord('Something else')).toBe('Something else')
  })

  it('names the Feedback page\'s levels and the card\'s label in the language showing', async () => {
    expect(i18n.t('coachAssess:levelOnTrack')).toBe('On track')
    expect(i18n.t('coachAssess:cardAriaNamed', { label: 'Draft', name: 'Cal Moss', date: '12 Nov' })).toBe('Draft assessment, Cal Moss, 12 Nov')
    expect(i18n.t('coachAssess:fbAll', { count: 18 })).toBe('All 18')
    await showLanguage('el')
    expect(i18n.t('coachAssess:levelOnTrack')).toBe('Σε καλό δρόμο')
    expect(i18n.t('coachAssess:fbAll', { count: 18 })).toBe('Όλοι 18')
  })

  it('says why a player cannot be assessed yet in the language showing', async () => {
    expect(waitText('parent', 'Cal Moss')).toBe('You can assess Cal Moss once a parent has approved their account.')
    expect(waitText(null, 'Cal Moss')).toBe("You can assess Cal Moss once a parent has approved and they've set up their Trak account.")
    await showLanguage('el')
    expect(waitText('parent', 'Cal Moss')).toContain('Cal Moss')
    expect(waitText('parent', 'Cal Moss')).toContain('γονέας')
  })
})
