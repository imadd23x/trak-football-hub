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
 * A YYYY-MM-DD whose age is `years`, with their birthday `-days` ago.
 *
 * The default puts the birthday a week behind us rather than on today, and
 * that margin is the point. `ageFromDateOfBirth` reads one clock on main —
 * `new Date(dob)` is UTC midnight, compared with LOCAL getters — and a
 * different one under #38, which is consistently UTC to match the database's
 * `current_date`. Those two disagree by at most a day, and only while local
 * and UTC are on different calendar days.
 *
 * A helper built on either clock is therefore correct against one
 * implementation and wrong against the other for a few hours each night. This
 * one is built on neither: seven days is wider than any disagreement the two
 * can produce, so every assertion below holds in every timezone under both,
 * and merging #38 cannot turn this file red. It went red twice before I
 * understood that, both times because I picked a clock instead of removing the
 * dependence on one.
 *
 * What is genuinely lost is the assertion on the exact birthday, and that is
 * #38's to prove rather than this file's — its own tests freeze the clock and
 * pin both sides of the boundary.
 */
const dob = (years: number, days = -7) => {
  const n = new Date()
  const d = new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() + days))
  return `${d.getUTCFullYear() - years}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
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
    // Three days either side, not the exact birthday, for the reason given on
    // `dob`: the two implementations of ageFromDateOfBirth can disagree by a
    // day, so an assertion sitting on the birthday itself is green under one
    // and red under the other. Three days leaves two days of margin and still
    // brackets the boundary closely enough to catch an off-by-one in
    // ageGroupMatches, which is what this test is for.
    //
    // The exact birthday belongs in #38's own tests, which freeze the clock
    // and pin both sides of it. It does not belong here, where the clock is
    // live and the function under test is a caller.
    expect(ageGroupMatches(dob(17, -3), 'U17')).toBe(false)
    expect(ageGroupMatches(dob(17, 3), 'U17')).toBe(true)
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
