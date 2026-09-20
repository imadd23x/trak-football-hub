import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { BANDS } from '@/lib/types'

/**
 * Findings from Kostas's manual test of the player surface, 18 September 2026.
 * Full triage: docs/reviews/player-surface-findings-2026-09-18.md
 *
 * ── What these are, and what they are not
 *
 * These are TRIPWIRES READ FROM SOURCE, not executed user journeys. Imad's
 * criticism of my K8 tests was exactly that a source-string check does not
 * execute the path, and he was right. The player surface belongs to Tarek and
 * this was written while he was offline, so nothing here edits his files —
 * which also means nothing here can execute his components without first
 * building the fixtures that would amount to rewriting them.
 *
 * So each assertion names a specific defective construct and fails while it is
 * present. That is weaker than a journey and it is stated rather than implied.
 *
 * ── Why they are gated
 *
 * They FAIL on purpose. `npm test` and CI must stay green, because a
 * permanently red main teaches people to ignore the colour — Tarek's rule from
 * the consent suite, and the reason his own failing assertions sit behind
 * `--consent-review` rather than in `--all`.
 *
 *     npm run test:findings
 *
 * Each one turns green when its finding is fixed, and not before.
 */

const ENABLED = process.env.TRAK_FINDINGS === '1'
const src = (...p: string[]) => readFileSync(join(process.cwd(), 'src', ...p), 'utf8')

/** Strip comments, so a finding described in prose is not mistaken for code. */
const code = (text: string) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')

describe.skipIf(!ENABLED)('player surface findings (expected to fail until fixed)', () => {
  // ── F-1 ────────────────────────────────────────────────────────────────
  //
  // "Latest coach assessments on home page shows all ratings on 'mixed' with
  //  orange colours whereas on profile page under performance trend the
  //  colours are blue and show 'steady'."
  //
  // PlayerProfilePage carries its own band ladder. A score of 5 is Mixed
  // (orange) canonically and Steady (blue) there, which is the contradiction
  // as reported. This compares the numbers rather than asserting the absence
  // of a string, so it fails on the divergence itself.
  it('F-1: the profile page does not define its own band thresholds', () => {
    const text = code(src('pages', 'player', 'PlayerProfilePage.tsx'))

    // Every `score >= N` in a band ladder, in source order.
    const thresholds = [...text.matchAll(/score\s*>=\s*(\d+(?:\.\d+)?)/g)].map(m => Number(m[1]))

    // BANDS' own cut points, highest first, excluding the 0 floor.
    const canonical = BANDS.map(b => b.minScore).filter(n => n > 0).sort((a, b) => b - a)

    expect(
      thresholds,
      'PlayerProfilePage defines a local score->band ladder. It disagrees with ' +
        'scoreToBand(): a 5 is "Mixed" (orange) canonically and "Steady" (blue) here, ' +
        'and the local copy has no Exceptional and no Difficult at all. CLAUDE.md: ' +
        'colours and bands come from BANDS, never a second copy.',
    ).toEqual(thresholds.length === 0 ? [] : canonical)
  })

  // Corrected after @t-bones29 fixed F-1 and this assertion stayed red on a
  // construct that was never the defect.
  //
  // The original checked PlayerProfilePage for ANY band hex and found #C8F25A
  // four times — all four the BRAND ACCENT: three icon tints and the
  // trend-filter highlight. #C8F25A is also the Exceptional band colour, so a
  // grep cannot tell the two uses apart, and Tarek was right to leave the file
  // alone rather than contort it to satisfy a bad test. He notes the same
  // approach matches 52 files repo-wide for exactly this reason.
  //
  // The accent is excluded and the other six stay, which is still a real
  // tripwire: none of them has a second meaning. The threshold assertion above
  // is the load-bearing one and it is green.
  const ACCENT = '#C8F25A'
  it('F-1: the profile page renders no unambiguous band colours', () => {
    const text = code(src('pages', 'player', 'PlayerProfilePage.tsx'))
    const bandColours = BANDS.map(b => b.color).filter(c => c.startsWith('#') && c !== ACCENT)
    const found = bandColours.filter(c => text.includes(c))
    expect(
      found,
      `PlayerProfilePage hardcodes band colours ${found.join(', ')} rather than reading ` +
        `them from BANDS, so a change to the palette updates one screen and not the other.`,
    ).toEqual([])
  })

  // The fifth ladder, which @t-bones29 found and I had missed: a score of 4
  // read "Developing" here against "Mixed" canonically, live on the player's
  // match detail screen. Covered now so the tripwire matches what was actually
  // wrong rather than only the copy I happened to find.
  it('F-1: matchDetailHelpers defines no band thresholds of its own', () => {
    const text = code(src('lib', 'matchDetailHelpers.ts'))
    const thresholds = [...text.matchAll(/score\s*>=\s*(\d+(?:\.\d+)?)/g)].map(m => Number(m[1]))
    expect(
      thresholds,
      'matchDetailHelpers carries its own score->band ladder again. It disagreed with ' +
        'scoreToBand() on 2, 3 and 4, so the same child read differently depending on ' +
        'which screen they opened.',
    ).toEqual([])
  })

  // ── F-2 ────────────────────────────────────────────────────────────────
  //
  // "Name updates after refreshing the page."
  //
  // saveName() writes profiles.full_name and toasts "Name updated" without
  // calling refreshProfile(), so AuthContext keeps the old name and every
  // screen reading profile.full_name shows it until a reload. The same file's
  // avatar handler does call refreshProfile, so the pattern was available.
  it('F-2: saving a name refreshes the profile in context', () => {
    const text = code(src('pages', 'Settings.tsx'))
    const start = text.indexOf("update({ full_name")
    expect(start, 'the name-save path moved').toBeGreaterThan(-1)
    // From the write to the end of its handler.
    const handler = text.slice(start, start + 600)
    expect(
      /refreshProfile\s*\(/.test(handler),
      'Settings saves the name and reports success without refreshing the profile in ' +
        'AuthContext, so every screen keeps showing the old name until a page reload.',
    ).toBe(true)
  })

  it('F-2: the name write is verified rather than assumed', () => {
    const text = code(src('pages', 'Settings.tsx'))
    const start = text.indexOf("update({ full_name")
    const handler = text.slice(start, start + 600)
    expect(
      /\.select\(/.test(handler),
      'The name update has no read-back, so a zero-row update — an absent profile row or ' +
        'an RLS denial — returns no error and is reported as "Name updated". Twenty-second ' +
        'instance of absence-of-error treated as success.',
    ).toBe(true)
  })

  // ── F-4 ────────────────────────────────────────────────────────────────
  //
  // "I tried sharing evolution card on messages and it showed a text with
  //  everything in writing."
  //
  // PlayerPassport captures an image and shares `files`. PlayerEvolutionCard
  // shares `{ title, text }` with no files key, so the OS share sheet has only
  // a string to hand to Messages.
  // Re-pointed after @t-bones29 fixed F-4. The original anchored on
  // `navigator.share` inside this file; the fix moved the share behind a shared
  // `@/lib/card-export` helper, so the anchor vanished and the assertion failed
  // with "the share path moved" rather than on the defect. The property that
  // matters is unchanged: the card leaves as an image, not a sentence.
  it('F-4: the Evolution Card shares an image, not a string', () => {
    const text = code(src('pages', 'player', 'PlayerEvolutionCard.tsx'))
    const viaHelper = /captureElementToPng|shareOrSaveImage/.test(text)
    const directShare = text.indexOf('navigator.share')
    if (directShare > -1) {
      const call = text.slice(directShare, directShare + 300)
      expect(
        /files\s*:/.test(call),
        'PlayerEvolutionCard calls navigator.share without a `files` key, so the card is ' +
          'shared as plain text and Messages pastes it as writing.',
      ).toBe(true)
      return
    }
    expect(
      viaHelper,
      'PlayerEvolutionCard neither shares an image through the card-export helper nor calls ' +
        'navigator.share directly. If the share path moved again, re-point this assertion — ' +
        'the property is that the card leaves as an image.',
    ).toBe(true)
  })

  // ── F-5 ────────────────────────────────────────────────────────────────
  //
  // "I created a new player account using an email that I had already used…
  //  it sent an email to the parent that was linked to the old account."
  //
  // Supabase returns the EXISTING user for a duplicate-email signup, so
  // auth.uid() is the old account for everything downstream. Two independent
  // consequences, and the second is the serious one.
  //
  // ⚠️ CORRECTED 19 September. The rename half above is UNVERIFIED.
  //
  // @t-bones29 traced it (#56) and the chain does not survive: onboarding data
  // reaches provision_my_profile only through user_metadata.trak_onboarding, so
  // a stranger's data renames a child only if Supabase writes that stranger's
  // options.data onto the existing user's metadata — untested by either of us.
  // Kostas's own report says "It didnt override the old account", and the
  // triage explained the guardian email with a rename he said did not happen.
  //
  // The database cannot settle it: trak_onboarding is cleared once provisioning
  // succeeds and is absent on all 12 live accounts. It needs the console
  // experiment, which is Kostas's.
  //
  // Both assertions stay anyway, and Tarek agrees they should: they are correct
  // even if the branch is unreachable today, it is one Supabase behaviour change
  // from being reachable, and nothing would warn us. What changed is the
  // justification, not the target.
  //
  // If it IS reachable it is worse than either of us first said — the same
  // ON CONFLICT also overwrites date_of_birth, which squad_player_consent_required()
  // reads, and runs link_player_to_coach with the signup's own code.
  //
  // No fix is asserted here, because the right behaviour is a product decision
  // with a real tradeoff — telling the user an account exists gives up
  // email-enumeration protection for a product whose users are minors. These
  // assertions pin the two mechanisms so that whichever way it is decided,
  // the decision has to touch them.
  it('F-5: a second signup cannot rename an existing profile', () => {
    const sql = readFileSync(
      join(process.cwd(), 'supabase', 'migrations', '20260611000001_signup_provisioning_rpc.sql'),
      'utf8',
    )
    const conflictAt = sql.indexOf('ON CONFLICT (user_id) DO UPDATE')
    expect(conflictAt, 'the profile upsert moved').toBeGreaterThan(-1)
    const clause = sql.slice(conflictAt, conflictAt + 300)
    expect(
      /full_name\s*=\s*EXCLUDED\.full_name\s*,/.test(clause),
      'provision_my_profile overwrites full_name unconditionally on conflict. Because a ' +
        'duplicate-email signup authenticates as the EXISTING user, the second signup ' +
        "renames the first account's profile.",
    ).toBe(false)
  })

  it('F-5: a parent invite is only sent to an address this signup supplied', () => {
    const handler = readFileSync(
      join(process.cwd(), 'supabase', 'functions', 'send-parent-invite', 'handler.ts'),
      'utf8',
    )
    expect(
      /supplied_by_this_signup|invite_requested_at|p_parent_email/.test(handler),
      'send-parent-invite selects invites by player_user_id === caller.id and mails ' +
        "invite.parent_email. On a duplicate-email signup the caller IS the old account, so " +
        "it mails the FIRST child's guardian about a signup they have nothing to do with. " +
        'Nothing ties the invite it sends to the address the current signup actually gave.',
    ).toBe(true)
  })

  // ── F-6 ────────────────────────────────────────────────────────────────
  //
  // "I was able to sign up as a player born in 2000 playing for the team U19+."
  //
  // Stated precisely: that specific pairing may well be correct, since U19+
  // plausibly means 19-and-over. The defect is that NO pairing is checked, so
  // a child born in 2010 selecting U19+ passes identically — and that is the
  // direction that matters, because squad_player_consent_required() follows
  // date_of_birth and an age band contradicting it is a signal nobody reads.
  it('F-6: the age group is checked against the date of birth', () => {
    const text = code(src('pages', 'OnboardingPage.tsx'))
    const hasDob = text.includes('date_of_birth') || text.includes('dateOfBirth')
    expect(hasDob, 'onboarding no longer collects a date of birth').toBe(true)
    expect(
      /ageGroupFor|deriveAgeGroup|ageGroupMatches|validateAgeGroup/.test(text),
      'OnboardingPage collects date_of_birth and age_group as independent fields with no ' +
        'cross-check, so any combination is accepted in either direction.',
    ).toBe(true)
  })
})
