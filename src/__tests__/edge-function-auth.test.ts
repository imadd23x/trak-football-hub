import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Guards K8 (X4).
 *
 * `parse-schedule` had no authentication of any kind — no getUser, no 401 —
 * with `verify_jwt = false`, so any unauthenticated request on the internet
 * could spend LOVABLE_API_KEY on the Lovable gateway, image input included.
 * `coach-assistant` called getUser() but only to personalise the prompt: no
 * user meant an empty context block and the request proceeded anyway.
 *
 * The reason both survived is worth encoding rather than just fixing:
 * `supabase/config.toml` described coach-assistant as "calls getUser() itself
 * and 401s without a valid user". It did not. A comment asserting a safety
 * property the code does not have is the actual defect — the same shape as the
 * false claim in 20260917000002 that Imad's F4 caught.
 *
 * Static checks over the function sources. They cannot prove the deployed
 * functions reject; they fail if a function that spends the AI key stops
 * checking who is calling.
 */

const FUNCTIONS = join(process.cwd(), 'supabase', 'functions')

function source(name: string): string {
  return readFileSync(join(FUNCTIONS, name, 'index.ts'), 'utf8')
}

/**
 * The source with comments stripped.
 *
 * For assertions about what the code *does*, prose must not count. A comment
 * explaining why a dangerous line was removed otherwise re-triggers the very
 * check that caught it — which is how the first version of the noteRow
 * assertion below failed against its own fix.
 */
function code(name: string): string {
  return source(name)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

/** Functions that spend LOVABLE_API_KEY and must therefore prove a session. */
function aiFunctions(): string[] {
  return readdirSync(FUNCTIONS, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => e.name)
    .filter(name => source(name).includes('LOVABLE_API_KEY'))
}

describe('edge functions that spend the AI key require a session', () => {
  const names = aiFunctions()

  it('finds the AI functions to check', () => {
    // If this drops to zero the suite below silently proves nothing.
    expect(names.length, 'no function references LOVABLE_API_KEY — did the env var get renamed?').toBeGreaterThan(0)
  })

  for (const name of names) {
    it(`${name}: rejects a request with no user`, () => {
      const sql = source(name)
      expect(
        sql.includes('auth.getUser('),
        `${name} spends LOVABLE_API_KEY without ever calling getUser(). Anyone on the internet ` +
          `can invoke it and run up the bill.`,
      ).toBe(true)

      // getUser() alone is what coach-assistant already did. The rejection is
      // the part that was missing, so require the 401 too.
      expect(
        /status:\s*401/.test(sql),
        `${name} calls getUser() but never returns 401. Fetching the user to personalise a ` +
          `prompt is not authentication — the request still reaches the paid gateway.`,
      ).toBe(true)
    })

    it(`${name}: counts the call against a per-user daily cap`, () => {
      expect(
        source(name).includes('claim_ai_call'),
        `${name} has no daily cap. Authentication stops strangers; it does not stop one ` +
          `authenticated coach spending without limit.`,
      ).toBe(true)
    })

    it(`${name}: validates the body before spending the allowance`, () => {
      // Imad's review of #41: parse-schedule claimed the quota before it had
      // even parsed the body, so a malformed request cost the coach one of
      // their forty. Reject everything that costs nothing to reject, then
      // charge. coach-assistant and player-feedback already did this; only
      // parse-schedule did not, which is why the invariant is asserted for all
      // three rather than fixed in one place and forgotten.
      const src = code(name)
      const parsedAt = src.indexOf('req.json()')
      const claimedAt = src.indexOf('claim_ai_call')
      expect(parsedAt, `${name} never parses a request body`).toBeGreaterThan(-1)
      expect(
        parsedAt < claimedAt,
        `${name} claims the daily allowance before parsing and validating the request body, ` +
          `so a malformed request spends the caller's quota. Move the claim after the 400.`,
      ).toBe(true)
    })
  }

  it('player-feedback does not dereference an absent coach note', () => {
    // maybeSingle() returns null when the coach assessed without writing a
    // note, which the function's own comment calls the common case. The
    // response block dereferenced noteRow.note anyway, throwing into the outer
    // catch — so the documented fallback produced a 500 rather than the
    // note-less feedback it was written to produce, after the AI call had
    // already been paid for.
    expect(
      /noteRow\.note/.test(code('player-feedback')),
      'player-feedback dereferences noteRow.note without a guard. maybeSingle() returns null ' +
        'when there is no note, so the feedback screen 500s in exactly the case the fallback ' +
        'above it exists to handle. Use coachNote, which is already "" when absent.',
    ).toBe(false)
  })

  it('the quota RPC only accepts the functions that spend the AI key', () => {
    // Also Imad's review: claim_ai_call took unconstrained text straight into
    // the primary key of ai_usage_daily, and EXECUTE is granted to
    // `authenticated` — so any signed-in user could insert unbounded rows under
    // names nothing enforces. A quota key nothing enforces is worse than none,
    // because it reads like coverage.
    const migrations = join(process.cwd(), 'supabase', 'migrations')
    const latest = readdirSync(migrations)
      .filter(f => f.includes('claim_ai_call') || f.includes('ai_call_quota') || f.includes('ai_quota'))
      .sort()
      .pop()
    expect(latest, 'no migration defines the AI quota RPC').toBeTruthy()
    const sql = readFileSync(join(migrations, latest!), 'utf8')
    for (const fn of ['parse-schedule', 'coach-assistant', 'player-feedback']) {
      expect(
        sql.includes(`'${fn}'`),
        `the newest AI-quota migration does not name ${fn}, so either it is no longer allowed ` +
          `to claim a call or the function name is no longer constrained.`,
      ).toBe(true)
    }
    expect(
      /NOT IN \(/.test(sql) || /RAISE EXCEPTION 'Unknown AI function/.test(sql),
      'claim_ai_call does not reject an unknown function name, so any authenticated user can ' +
        'write arbitrary keys into ai_usage_daily.',
    ).toBe(true)
  })

  it('config.toml does not claim a protection the code lacks', () => {
    const config = readFileSync(join(process.cwd(), 'supabase', 'config.toml'), 'utf8')
    // The specific false sentence that let this survive. Its return would mean
    // the file is describing an intention rather than the code again.
    expect(
      /calls getUser\(\) itself and 401s/.test(config) && !source('coach-assistant').includes('status: 401'),
      'config.toml claims a function 401s without a valid user while that function has no 401. ' +
        'A comment asserting a safety property the code does not have is how X4 went unnoticed.',
    ).toBe(false)
  })
})
