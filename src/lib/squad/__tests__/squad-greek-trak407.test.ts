import { afterEach, describe, expect, it } from 'vitest'
import { i18n, showLanguage, SOURCE_LANGUAGE } from '@/lib/i18n'
import { dayMonth, weekdayDayMonth } from '@/lib/squad/format'
import { POSITION_WORD } from '@/lib/position-words'
import { bornLine } from '@/lib/squad/format'
import { ROLE_HEADING_WORD, ROLE_WORD, TRAIT_GROUP_WORD, TRAIT_WORD, shown } from '@/lib/squad/trait-words'
import { PLAYER_TRAIT_GROUPS, PLAYER_TRAITS } from '@/lib/player-traits'
import { ROLES, roleGroups } from '@/lib/positions'

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

  it('has a word for every trait, trait group, preset role and role heading', async () => {
    for (const trait of PLAYER_TRAITS) expect(shown(TRAIT_WORD, trait)).toBe(trait)
    for (const { group } of PLAYER_TRAIT_GROUPS) expect(shown(TRAIT_GROUP_WORD, group)).toBe(group)
    const roles = Object.values(ROLES).flat()
    for (const role of roles) expect(shown(ROLE_WORD, role)).toBe(role)
    const headings = roleGroups('Goalkeeper', ['Defender', 'Midfielder'], ['Mine'], []).concat(roleGroups('Attacker', [], [], [])).map(g => g.heading)
    await showLanguage('el')
    for (const trait of PLAYER_TRAITS) expect(shown(TRAIT_WORD, trait)).not.toBe(trait)
    for (const { group } of PLAYER_TRAIT_GROUPS) expect(shown(TRAIT_GROUP_WORD, group)).not.toBe(group)
    for (const role of roles) expect(shown(ROLE_WORD, role)).not.toBe(role)
    for (const heading of headings) expect(shown(ROLE_HEADING_WORD, heading)).not.toBe(heading)
    // A coach's own role is shown as written.
    expect(shown(ROLE_WORD, 'Press the keeper')).toBe('Press the keeper')
  })

  it('writes a date of birth and age in the language showing', async () => {
    expect(bornLine('2012-02-26', new Date(2026, 9, 22))).toBe('26/2/2012 · 14 years old')
    await showLanguage('el')
    expect(bornLine('2012-02-26', new Date(2026, 9, 22))).toBe('26/2/2012 · 14 ετών')
  })

  it('counts formations\' players and matches in Greek, and in English as before', async () => {
    expect(i18n.t('coachSquad:fmPlaceToOpen', { count: 1 })).toBe('Place 1 player to open Formations')
    expect(i18n.t('coachSquad:fmCopied', { name: 'Press', count: 1 })).toBe('Press copied to 1 match.')
    expect(i18n.t('coachSquad:fmCopyTo', { count: 3 })).toBe('Copy to 3 matches')
    expect(i18n.t('coachSquad:fmASide', { count: 9 })).toBe('9 a side')
    await showLanguage('el')
    expect(i18n.t('coachSquad:fmCopyTo', { count: 1 })).toBe('Αντιγραφή σε 1 αγώνα')
    expect(i18n.t('coachSquad:fmCopyTo', { count: 3 })).toBe('Αντιγραφή σε 3 αγώνες')
    expect(i18n.t('coachSquad:fmASide', { count: 9 })).toBe('9×9')
  })

  it('keeps English as it was', () => {
    expect(i18n.t('coachSquad:notEligibleWhy', { count: 1 })).toBe(" — consent pending, so the family can't see or answer events yet.")
    expect(i18n.t('coachSquad:squadPlayers', { squad: 'U14' })).toBe('U14 players')
  })
})
