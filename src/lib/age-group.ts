import { AGE_GROUPS } from '@/lib/constants'
import { ageFromDateOfBirth } from '@/lib/consent'

// F-6. Onboarding collected a date of birth and an age group as independent
// fields and accepted any combination. The reported case was harmless — someone
// born in 2000 choosing U19+ — but the same absence of a check lets a child
// born in 2010 choose U19+, and that is the direction that matters:
// squad_player_consent_required() follows date_of_birth, so an age band
// contradicting it is a signal nobody is reading.
//
// The rule is not "the band must equal the age". Playing UP an age group is
// normal and legitimate in youth football, so a 12-year-old in U15 is fine.
// Playing DOWN is the one that should never happen, so the rule is eligibility:
// for "U15" the player must be under 15. U19+ is the open top band.
//
// The age itself is NOT computed here. ageFromDateOfBirth in consent.ts is the
// single implementation, and Imad's #38 is the PR that makes it correct across
// timezones. I wrote a second one before reading the queue; this is the version
// without it.
//
// LIMITATION, stated rather than papered over: real competitions set age groups
// from a season cut-off date, not from the player's birthday. We have no season
// configured anywhere in this product, and inventing a cut-off would be worse
// than using current age, so this uses current age and is deliberately
// permissive at the boundary. If a season is ever configured, this is the one
// place to change.

/** The ceiling in "U15" → 15. Null for the open band or anything unrecognised. */
export function ageGroupCeiling(ageGroup: string): number | null {
  const m = /^U(\d{1,2})$/.exec(ageGroup?.trim() ?? '')
  return m ? Number(m[1]) : null
}

/**
 * Is this player eligible for this age group?
 * Playing up is allowed; playing down is not. Unknown or incomplete input is
 * permitted, because this guards a mismatch and must not block a signup it
 * cannot actually evaluate.
 */
export function ageGroupMatches(dateOfBirth: string, ageGroup: string): boolean {
  const ceiling = ageGroupCeiling(ageGroup)
  if (ceiling === null) return true          // U19+ or unrecognised: open band
  const age = ageFromDateOfBirth(dateOfBirth)
  if (age === null) return true              // no usable date: not this check's job
  return age < ceiling
}

/** The youngest band this player is eligible for, for the error message. */
export function lowestEligibleAgeGroup(dateOfBirth: string): string | null {
  const age = ageFromDateOfBirth(dateOfBirth)
  if (age === null) return null
  return AGE_GROUPS.find(g => {
    const ceiling = ageGroupCeiling(g)
    return ceiling === null || age < ceiling
  }) ?? null
}
