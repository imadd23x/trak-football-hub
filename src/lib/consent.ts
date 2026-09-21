/**
 * UI helpers for the existing parental-consent implementation.
 *
 * The database is the authority — `consent_threshold_age()` and
 * `player_consent_required()` currently use the legacy threshold of 15.
 * The confirmed under-18 policy for both UAE and Greece still requires a
 * coordinated backend migration; this calendar fix does not implement it.
 * Keep the threshold in step with `20260912000001_parental_consent.sql`
 * until that migration lands.
 */

/** Mirrors `public.consent_threshold_age()`. Change both together. */
export const CONSENT_THRESHOLD_AGE = 15

/**
 * Bump whenever the wording below changes. Stored on every consent record so
 * a past consent can be reconstructed against the text actually shown.
 */
export const CONSENT_NOTICE_VERSION = '2026-09-12.1'

/** Whole years from a valid YYYY-MM-DD, using the database's UTC calendar day. */
export const ageFromDateOfBirth = (dob: string): number | null => {
  if (dob.length !== 10) return null
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dob)
  if (!parts) return null

  const year = Number(parts[1])
  const month = Number(parts[2])
  const day = Number(parts[3])
  if (year < 1 || month < 1 || month > 12 || day < 1) return null

  // Validate calendar components directly: Date parsing normalizes Feb 31.
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  if (day > daysInMonth[month - 1]) return null

  const today = new Date()
  const monthDelta = today.getUTCMonth() + 1 - month
  let age = today.getUTCFullYear() - year
  if (monthDelta < 0 || (monthDelta === 0 && today.getUTCDate() < day)) age--
  return age < 0 ? null : age
}

export const needsParentalConsent = (dob: string): boolean => {
  const age = ageFromDateOfBirth(dob)
  return age !== null && age < CONSENT_THRESHOLD_AGE
}

/**
 * Separate choices, never one bundled yes. The first is the reason the app
 * exists and is presented as required — if a parent declines it there is
 * nothing to use, so the honest answer is not to create the account. The rest
 * are genuinely optional and default to off, per the Children's Code standard
 * that new features start at high privacy.
 */
export type ConsentPurposeKey = 'coaching_records' | 'recognition' | 'parent_visibility'

export const CONSENT_PURPOSES: {
  key: ConsentPurposeKey
  label: string
  detail: string
  required: boolean
}[] = [
  {
    key: 'coaching_records',
    label: "Their coach can record assessments and matches",
    detail:
      "Six skill ratings after a session, the matches they play, and a written note from the coach. This is what the app is for.",
    required: true,
  },
  {
    key: 'recognition',
    label: 'Their coach can give them recognition awards',
    detail: 'Things like player of the week, visible to you and to them.',
    required: false,
  },
  {
    key: 'parent_visibility',
    label: 'I can see their progress',
    detail:
      "Their season band, match history and coach assessments. The coach's private notes are never shared with anyone.",
    required: false,
  },
]

/**
 * The exact wording shown to the parent, stored verbatim on the record. Kept
 * here rather than inline in the component so the string that is displayed and
 * the string that is saved cannot drift apart.
 */
export const CONSENT_STATEMENT =
  'I confirm I hold parental responsibility for this child and I authorise the processing I have selected above. ' +
  'I understand I can withdraw at any time from my profile, and that withdrawing stops future processing.'
