import { describe, it, expect } from 'vitest'
import { ageGroupCeiling, ageGroupMatches, lowestEligibleAgeGroup } from '@/lib/age-group'

// F-6. Onboarding took date_of_birth and age_group as independent fields and
// accepted any pairing. Playing UP a group is ordinary youth football; playing
// DOWN is the direction that matters, because squad_player_consent_required()
// follows date_of_birth and a band contradicting it is a signal nobody reads.
//
// The age itself comes from ageFromDateOfBirth in consent.ts — there is no
// second implementation here, and its timezone behaviour is #38's to prove.

/**
 * A YYYY-MM-DD that is exactly `years` old today, offset by `days`.
 *
 * Built from the LOCAL calendar day, because that is the clock
 * ageFromDateOfBirth reads on main today — `new Date(dob)` parsed as UTC
 * midnight, then compared with local getters. This helper originally used UTC
 * and the boundary assertion went red the moment local crossed midnight while
 * UTC was still on the previous day, which is precisely the defect #38 fixes.
 *
 * When #38 lands the function becomes UTC on both sides; switch this helper to
 * UTC with it. Until then, matching the function under test keeps the boundary
 * assertion meaningful rather than papering over the mismatch by widening it.
 */
const dob = (years: number, days = 0) => {
  const n = new Date()
  const d = new Date(n.getFullYear(), n.getMonth(), n.getDate() + days)
  return `${d.getFullYear() - years}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

describe('ageGroupCeiling', () => {
  it('reads the number out of a closed band', () => {
    expect(ageGroupCeiling('U13')).toBe(13)
    expect(ageGroupCeiling('U19')).toBe(19)
  })

  it('treats the open band and anything unrecognised as no ceiling', () => {
    expect(ageGroupCeiling('U19+')).toBeNull()
    expect(ageGroupCeiling('Seniors')).toBeNull()
    expect(ageGroupCeiling('')).toBeNull()
  })
})

describe('ageGroupMatches', () => {
  it('allows playing up', () => {
    expect(ageGroupMatches(dob(12), 'U15')).toBe(true)
    expect(ageGroupMatches(dob(12), 'U19+')).toBe(true)
  })

  it('refuses playing down, which is the direction that matters', () => {
    // A 16-year-old cannot be in U13. This is the pairing that makes the band
    // contradict the date of birth the consent gate reads.
    expect(ageGroupMatches(dob(16), 'U13')).toBe(false)
    expect(ageGroupMatches(dob(16), 'U16')).toBe(false)
  })

  it('refuses an over-age player and accepts an under-age one near the boundary', () => {
    // Two days either side, not the exact boundary, and that is deliberate.
    //
    // ageFromDateOfBirth on main parses the date as UTC midnight and then
    // compares it with LOCAL getters. In a negative-offset zone those disagree
    // by a day, so NO construction of "exactly seventeen today" round-trips —
    // an exact-boundary assertion is green in UTC and red in America/New_York.
    // That is the defect #38 fixes, not something this suite can assert around.
    //
    // When #38 lands, both sides are UTC and the exact boundary becomes
    // testable. Restore it then: dob(17) must be false and dob(17, 1) true.
    expect(ageGroupMatches(dob(17, -2), 'U17')).toBe(false)
    expect(ageGroupMatches(dob(17, 2), 'U17')).toBe(true)
  })

  it('permits what it cannot evaluate, so it never blocks a signup blindly', () => {
    expect(ageGroupMatches('', 'U13')).toBe(true)
    expect(ageGroupMatches('garbage', 'U13')).toBe(true)
    expect(ageGroupMatches(dob(16), '')).toBe(true)
    // An impossible date like 2011-02-31 is deliberately NOT asserted here.
    // On main it still normalises to 3 March and yields a real age — that is
    // the defect #38 fixes, and asserting either behaviour would pin one PR's
    // state into the other's suite. Onboarding rejects impossible dates before
    // this check runs (isRealCalendarDate, from T5), so the path is unreachable
    // from the screen either way.
  })

  it('accepts the reported case, which was never the defect', () => {
    // "born in 2000 playing for U19+" — an adult in the open band is fine.
    expect(ageGroupMatches('2000-05-05', 'U19+')).toBe(true)
  })
})

describe('lowestEligibleAgeGroup', () => {
  it('names the youngest band a player may join', () => {
    expect(lowestEligibleAgeGroup(dob(12))).toBe('U13')
    expect(lowestEligibleAgeGroup(dob(16))).toBe('U17')
    expect(lowestEligibleAgeGroup(dob(26))).toBe('U19+')
  })

  it('says nothing when it cannot tell', () => {
    expect(lowestEligibleAgeGroup('')).toBeNull()
  })
})
