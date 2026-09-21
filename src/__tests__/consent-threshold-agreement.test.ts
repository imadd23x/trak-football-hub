import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { CONSENT_THRESHOLD_AGE } from '@/lib/consent'

/**
 * The digital-consent age exists twice: once in the database, which enforces
 * it, and once in `src/lib/consent.ts`, so the UI can ask the same question
 * without a round trip. `consent.ts` says "Change both together" and nothing
 * made that true.
 *
 * `consent.test.ts` asserts `CONSENT_THRESHOLD_AGE` is 15. That pins the
 * client to a literal and says nothing about the server: change the migration
 * to 16 and the test still passes, while the screen tells a fifteen-year-old
 * they need no parental approval and the database refuses the write. A guard
 * that cannot notice the thing it guards against is the failure mode this
 * repository has hit repeatedly, so this one reads the SQL.
 *
 * Static, like rls-write-policies.test.ts. It cannot prove the deployed
 * function returns this value — only that the two sources in the repository
 * agree. The live value is verified against Supabase by hand.
 */

const MIGRATIONS = join(process.cwd(), 'supabase', 'migrations')

/**
 * The LAST definition wins, in filename order, because that is the one a
 * replay leaves in `pg_proc`. Reading the first is how I once mutated
 * `squad_player_is_mine` in a migration that a later one overwrote and read
 * the resulting green as evidence. There is one definition today; this stays
 * correct when there are two.
 */
function lastDefinitionOf(fn: string): string {
  const files = readdirSync(MIGRATIONS).filter(f => f.endsWith('.sql')).sort()
  let body = ''
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS, file), 'utf8')
    const at = sql.indexOf(`FUNCTION public.${fn}(`)
    if (at !== -1) body = sql.slice(at)
  }
  return body
}

describe('the consent threshold agrees between the client and the database', () => {
  it('finds a definition at all, so a rename cannot make this vacuous', () => {
    expect(lastDefinitionOf('consent_threshold_age')).not.toBe('')
  })

  it('returns the same number the client believes', () => {
    const body = lastDefinitionOf('consent_threshold_age')
    const match = /SELECT\s+(\d+)\s*;/.exec(body)
    expect(match, 'could not read a literal out of consent_threshold_age()').not.toBeNull()
    expect(Number(match![1])).toBe(CONSENT_THRESHOLD_AGE)
  })

  it('is still a single-market constant, which is what the pilot gate assumes', () => {
    // 20260912000001 is explicit that multi-market "needs a country column on
    // the academy, not on the child". The verification matrix asks for ages
    // 17/18 in GR *and* AE, which this shape cannot express — one number
    // applies everywhere. Recording that here so the day the function grows a
    // parameter, this test fails and someone rereads the gate item rather than
    // discovering the mismatch during a rehearsal.
    const body = lastDefinitionOf('consent_threshold_age')
    const signature = body.slice(0, body.indexOf(')') + 1)
    expect(signature).toBe('FUNCTION public.consent_threshold_age()')
  })
})
