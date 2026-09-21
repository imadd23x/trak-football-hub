import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { validateMatchInput, isValidMatchInput, MATCH_LIMITS } from '../match-input-rules'

const ok = (i: Parameters<typeof validateMatchInput>[0]) => validateMatchInput(i)
const fields = (i: Parameters<typeof validateMatchInput>[0]) => ok(i).map(x => x.field)

describe('match input rules', () => {
  describe('the ordinary cases a coach actually enters', () => {
    // If any of these is refused the rules are wrong, not the football.
    it.each([
      ['a full match, nothing scored',      { minutes: 90, goals: 0, assists: 0, teamScore: 0 }],
      ['a striker with a brace',            { minutes: 90, goals: 2, assists: 1, teamScore: 3 }],
      ['a hat-trick',                       { minutes: 90, goals: 3, assists: 0, teamScore: 4 }],
      ['an unused substitute',              { minutes: 0,  goals: 0, assists: 0, teamScore: 2 }],
      ['extra time',                        { minutes: 120, goals: 1, assists: 0, teamScore: 2 }],
      ['score not entered yet',             { minutes: 90, goals: 2, assists: 0 }],
    ])('accepts %s', (_label, input) => {
      expect(ok(input)).toEqual([])
    })

    // The regression this module was nearly shipped with. `goals + assists <=
    // minutes / 5` alone refuses both of these, which are ordinary football.
    it.each([
      ['a sub on for 5 minutes who scores twice',  { minutes: 5, goals: 2, assists: 0, teamScore: 2 }],
      ['an 89th-minute sub who scores at once',    { minutes: 1, goals: 1, assists: 0, teamScore: 1 }],
      ['a sub on for 10 minutes with 3',           { minutes: 10, goals: 2, assists: 1, teamScore: 3 }],
    ])('accepts %s — the contribution floor exists for this', (_label, input) => {
      expect(ok(input)).toEqual([])
    })
  })

  describe('the values the database accepts today', () => {
    // Each of these was measured as ACCEPTED and STORED by a direct insert
    // against a fresh replay of every migration. They are the reason for this
    // module, so each is named rather than folded into a range test.
    it('refuses 999 goals', () => {
      expect(fields({ minutes: 90, goals: 999, assists: 0 })).toContain('goals')
    })
    it('refuses −45 minutes', () => {
      expect(fields({ minutes: -45, goals: 1, assists: 0 })).toContain('minutes')
    })
    it('refuses −3 goals', () => {
      expect(fields({ minutes: 90, goals: -3, assists: 0 })).toContain('goals')
    })
  })

  describe('ranges', () => {
    it.each([
      ['minutes below zero',   { minutes: -1, goals: 0, assists: 0 },  'minutes'],
      ['minutes above 120',    { minutes: 121, goals: 0, assists: 0 }, 'minutes'],
      ['goals above the cap',  { minutes: 90, goals: 21, assists: 0 }, 'goals'],
      ['assists above the cap',{ minutes: 90, goals: 0, assists: 21 }, 'assists'],
    ])('refuses %s', (_l, input, field) => {
      expect(fields(input)).toContain(field)
    })

    it.each([0, 1, 120])('accepts the boundary minute %i', m => {
      expect(ok({ minutes: m, goals: 0, assists: 0 })).toEqual([])
    })
  })

  describe('whole numbers', () => {
    it.each([
      ['fractional minutes', { minutes: 45.5, goals: 0, assists: 0 }, 'minutes'],
      ['fractional goals',   { minutes: 90, goals: 1.5, assists: 0 }, 'goals'],
      ['fractional assists', { minutes: 90, goals: 0, assists: 0.5 }, 'assists'],
    ])('refuses %s', (_l, input, field) => {
      expect(fields(input)).toContain(field)
    })

    it('refuses NaN rather than letting it pass every comparison', () => {
      // NaN > 20 is false and NaN < 0 is false, so a range-only check would
      // have accepted this and written NaN to an integer column.
      expect(fields({ minutes: 90, goals: NaN, assists: 0 })).toContain('goals')
    })

    it('reports the type problem instead of its consequences', () => {
      const v = ok({ minutes: NaN, goals: 5, assists: 5 })
      expect(v).toHaveLength(1)
      expect(v[0].field).toBe('minutes')
    })
  })

  describe('a player who did not play did not contribute', () => {
    it('refuses goals with zero minutes', () => {
      expect(ok({ minutes: 0, goals: 1, assists: 0 })[0].message)
        .toMatch(/no minutes cannot have goals/)
    })
    it('refuses assists with zero minutes', () => {
      expect(fields({ minutes: 0, goals: 0, assists: 1 })).toContain('minutes')
    })
  })

  describe("goals cannot exceed the team's score", () => {
    it('refuses 3 goals in a 2-goal win', () => {
      expect(ok({ minutes: 90, goals: 3, assists: 0, teamScore: 2 })[0].message)
        .toMatch(/cannot score more than the team's 2/)
    })
    it('accepts goals equal to the score', () => {
      expect(ok({ minutes: 90, goals: 2, assists: 0, teamScore: 2 })).toEqual([])
    })
    it('does not invent a comparison when the score is unknown', () => {
      // Entering goals before the score must not be refused against an
      // imagined 0 — that would reject every goals-first entry.
      expect(ok({ minutes: 90, goals: 2, assists: 0 })).toEqual([])
    })
    it('refuses a goal when the team scored none', () => {
      expect(fields({ minutes: 90, goals: 1, assists: 0, teamScore: 0 })).toContain('goals')
    })
  })

  describe('contributions against time on the pitch', () => {
    it('refuses 12 contributions in 20 minutes', () => {
      expect(ok({ minutes: 20, goals: 12, assists: 0, teamScore: 12 })[0].message)
        .toMatch(/not possible \(max 4\)/)
    })
    it('allows up to the floor at any minute above zero', () => {
      expect(ok({ minutes: 1, goals: 3, assists: 0, teamScore: 3 })).toEqual([])
    })
    it('refuses one past the floor at a low minute', () => {
      expect(fields({ minutes: 1, goals: 4, assists: 0, teamScore: 4 })).toContain('goals')
    })
    it('scales above the floor', () => {
      // 90 / 5 = 18, which exceeds the floor, so the ratio governs.
      expect(ok({ minutes: 90, goals: 9, assists: 9, teamScore: 9 })).toEqual([])
      expect(fields({ minutes: 90, goals: 10, assists: 9, teamScore: 10 })).toContain('goals')
    })
  })

  describe('reporting', () => {
    it('returns every violation, not only the first', () => {
      // A coach fixing one problem should not discover the next on the next
      // save.
      const v = ok({ minutes: 200, goals: 50, assists: 50 })
      expect(v.length).toBeGreaterThan(1)
      expect(v.map(x => x.field)).toEqual(expect.arrayContaining(['minutes', 'goals', 'assists']))
    })
    it('isValidMatchInput agrees with validateMatchInput', () => {
      expect(isValidMatchInput({ minutes: 90, goals: 1, assists: 0, teamScore: 2 })).toBe(true)
      expect(isValidMatchInput({ minutes: 90, goals: 999, assists: 0 })).toBe(false)
    })
  })

  describe('the same rules are enforced in the database', () => {
    // These rules are worth nothing if only the screen applies them — the RPC
    // is reachable directly. This asserts the migration exists and carries the
    // same numbers, so the two cannot drift apart silently.
    const sql = readFileSync(
      resolve(__dirname, '../../../supabase/migrations/20260920150000_match_stats_must_be_possible.sql'),
      'utf8',
    )

    it('constrains the same columns', () => {
      for (const col of ['minutes_played', 'goals', 'assists']) {
        expect(sql).toContain(col)
      }
    })

    it('uses the same numeric limits as this module', () => {
      expect(sql).toContain(String(MATCH_LIMITS.minutesMax))
      expect(sql).toContain(String(MATCH_LIMITS.goalsMax))
      expect(sql).toContain(String(MATCH_LIMITS.contributionFloor))
      expect(sql).toContain(String(MATCH_LIMITS.minutesPerContribution))
    })

    it('validates inside the RPC, not only as a table constraint', () => {
      // A CHECK constraint raises a Postgres error a coach cannot read. The
      // RPC must fail with its own message as well.
      expect(sql).toMatch(/log_match_for_player/)
      expect(sql).toMatch(/RAISE EXCEPTION/)
    })
  })
})
