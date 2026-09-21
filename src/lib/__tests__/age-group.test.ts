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
 * Built from the UTC calendar day, which is the clock #38 makes
 * `ageFromDateOfBirth` read on both sides, to match the database's
 * `current_date`.
 *
 * The default puts the birthday a week back so that the assertions which are
 * NOT about the boundary — playing up, playing down, the lowest eligible band —
 * cannot be disturbed by a one-day clock disagreement. That is a free
 * robustness win and nothing depends on it.
 *
 * The boundary assertion below is a different matter and is deliberately exact.
 * It is RED on main today and green under #38, and that is the correct
 * behaviour for it: main's `ageFromDateOfBirth` parses UTC midnight and then
 * compares with LOCAL getters, so west of Greenwich it is a day out at every
 * hour. Widening this assertion to hide that was my first instinct and it was
 * wrong — it would have removed the only assertion in the repository that
 * catches the defect, on the argument that the defect makes it fail.
 *
 * #42 therefore depends on #38. See the boundary test for why that is the
 * cheap direction.
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

  it('is exact at the boundary', () => {
    // Under 17 means under 17: someone who turned 17 today is not eligible,
    // and someone whose 17th birthday is tomorrow still is.
    //
    // This assertion fails on main west of Greenwich and passes under #38, so
    // #38 must merge first. I briefly replaced it with a three-day window to
    // make this branch green on its own, and Imad was right to push back:
    // widening it removes the only assertion anywhere that catches the
    // mixed-clock defect, and the justification for widening was that the
    // defect makes it fail. A test that fails because the code is broken is
    // doing its job.
    //
    // Verified under #38 at 241357d in UTC, Asia/Dubai, America/New_York,
    // America/Los_Angeles, America/Sao_Paulo, Pacific/Auckland and
    // Pacific/Kiritimati — green in all seven.
    expect(ageGroupMatches(dob(17, 0), 'U17')).toBe(false)
    expect(ageGroupMatches(dob(17, 1), 'U17')).toBe(true)
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
