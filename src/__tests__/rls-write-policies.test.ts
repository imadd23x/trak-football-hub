import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Guards the fix from 20260614000001.
 *
 * Every write policy on coach- and club-owned tables used to read
 *   WITH CHECK (coach_user_id = auth.uid())
 * which asks "are you claiming to be yourself?" but never "are you a coach?".
 * Signed in as an ordinary player it was therefore possible to insert coach
 * assessments and recognition awards about oneself — data that feeds the band,
 * Evolution Card, passport, parent view and club dashboard.
 *
 * These are static checks over the migration files. They cannot prove the live
 * database is correct (that was verified by hand against Supabase), but they do
 * fail if someone reintroduces an ownership-only write policy on these tables.
 */

const MIGRATIONS = join(process.cwd(), 'supabase', 'migrations')

/** Tables where a write must require the caller to hold a role, not just claim ownership. */
const ROLE_GUARDED: Record<string, string> = {
  coach_assessments: 'is_coach',
  recognition_awards: 'is_coach',
  squad_players: 'is_coach',
  coach_sessions: 'is_coach',
  coach_calendar_events: 'is_coach',
  organizations: 'is_club_admin',
}

interface Policy { name: string; table: string; op: string; body: string; file: string }

function loadPolicies(): Policy[] {
  const files = readdirSync(MIGRATIONS).filter(f => f.endsWith('.sql')).sort()
  const created: Policy[] = []
  const dropped: { name: string; table: string; file: string }[] = []

  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS, file), 'utf8')
    const dropRe = /DROP POLICY IF EXISTS\s+"([^"]+)"\s+ON\s+(?:public\.)?(\w+)/gi
    for (let m; (m = dropRe.exec(sql)); ) {
      dropped.push({ name: m[1], table: m[2], file })
    }
    const createRe =
      /CREATE POLICY\s+"([^"]+)"\s+ON\s+(?:public\.)?(\w+)\s+(?:AS\s+\w+\s+)?FOR\s+(INSERT|UPDATE|ALL|SELECT|DELETE)([\s\S]*?);/gi
    for (let m; (m = createRe.exec(sql)); ) {
      created.push({ name: m[1], table: m[2], op: m[3].toUpperCase(), body: m[4], file })
    }
  }

  // A policy is live if its newest CREATE is not followed by a later DROP.
  // A DROP in the same file counts as superseded, because migrations drop and
  // recreate a policy together to redefine it.
  return created.filter(p => {
    const lastCreate = created
      .filter(c => c.name === p.name && c.table === p.table)
      .map(c => c.file)
      .sort()
      .at(-1)!
    const lastDrop = dropped
      .filter(d => d.name === p.name && d.table === p.table)
      .map(d => d.file)
      .sort()
      .at(-1)
    return p.file === lastCreate && (!lastDrop || lastDrop <= lastCreate)
  })
}

describe('RLS write policies require a role, not just claimed ownership', () => {
  const live = loadPolicies()

  it('finds write policies to check', () => {
    expect(live.length).toBeGreaterThan(0)
  })

  for (const [table, guard] of Object.entries(ROLE_GUARDED)) {
    it(`${table}: every live INSERT/UPDATE policy calls ${guard}()`, () => {
      const writes = live.filter(p => p.table === table && ['INSERT', 'UPDATE', 'ALL'].includes(p.op))
      expect(writes.length, `no write policy found for ${table} — did it get renamed?`).toBeGreaterThan(0)

      for (const p of writes) {
        expect(
          p.body.includes(`${guard}()`),
          `Policy "${p.name}" on ${table} (${p.file}) permits a write without checking ${guard}(). ` +
            `An ownership-only check lets any authenticated user set the owner column to their own id.`,
        ).toBe(true)
      }
    })
  }

  it('get_profile_role is restricted to the caller', () => {
    // Must not be dropped: the "users can update own profile" policy relies on it
    // to pin role to its current value, which is what stops self-promotion.
    const files = readdirSync(MIGRATIONS).filter(f => f.endsWith('.sql')).sort()
    let latest = ''
    for (const f of files) {
      const sql = readFileSync(join(MIGRATIONS, f), 'utf8')
      const i = sql.indexOf('FUNCTION public.get_profile_role')
      if (i >= 0) latest = sql.slice(i, i + 600)
    }
    expect(latest, 'get_profile_role has been removed — profile role-change protection depends on it').not.toBe('')
    expect(
      latest.includes('auth.uid()'),
      'get_profile_role no longer restricts to the caller — it would leak any user’s role',
    ).toBe(true)
  })
})

/**
 * Guards K1 (X2) from 20260917000001.
 *
 * Checking the role is not the same as checking ownership. Before the fix,
 * coach_assessments.INSERT read
 *   (coach_user_id = auth.uid()) AND is_coach() AND NOT consent_required(...)
 * with nothing at all constraining squad_player_id, session_id or
 * organization_id. A coach in academy B could therefore write a permanent
 * assessment onto a child in academy A — permanent because DELETE is `false`
 * on that table — and stamp it with academy A's organization_id so it
 * surfaced on their dashboard.
 *
 * Static checks over the migration files, like the suite above. They cannot
 * prove the live database is correct; they fail if someone reintroduces a
 * write policy that references another table's row without proving ownership.
 */
describe('RLS writes prove ownership of the row they reference', () => {
  const live = loadPolicies()

  /** table -> helpers every live write policy on it must call */
  const REFERENCE_GUARDED: Record<string, string[]> = {
    coach_assessments: ['squad_player_is_mine'],
    recognition_awards: ['squad_player_is_mine'],
    session_attendance: ['coach_session_is_mine'],
    coach_assessment_notes: ['squad_player_is_mine'],
  }

  for (const [table, helpers] of Object.entries(REFERENCE_GUARDED)) {
    it(`${table}: every live INSERT/UPDATE policy proves ownership`, () => {
      const writes = live.filter(p => p.table === table && ['INSERT', 'UPDATE', 'ALL'].includes(p.op))
      expect(writes.length, `no write policy found for ${table} — did it get renamed?`).toBeGreaterThan(0)

      for (const p of writes) {
        const called = helpers.some(h => p.body.includes(`${h}(`))
        expect(
          called,
          `Policy "${p.name}" on ${table} (${p.file}) writes a row that references another ` +
            `table without calling one of ${helpers.join(', ')}. That lets a coach write against ` +
            `a player, session or academy that is not theirs.`,
        ).toBe(true)
      }
    })
  }

  it('assessments and awards cannot be stamped with an arbitrary academy', () => {
    const inserts = live.filter(
      p => ['coach_assessments', 'recognition_awards'].includes(p.table) && p.op === 'INSERT',
    )
    expect(inserts.length).toBeGreaterThan(0)
    for (const p of inserts) {
      expect(
        p.body.includes('my_coach_organization_id()'),
        `Policy "${p.name}" on ${p.table} (${p.file}) does not pin organization_id to the writer's ` +
          `own academy. The BEFORE INSERT trigger only fills a NULL, so a supplied value survives ` +
          `and the row appears on another academy's dashboard.`,
      ).toBe(true)
    }
  })
})

/**
 * Guards K2 (X3) from 20260917000002.
 *
 * remove_coach_from_org() nulls the coach's organization_id and marks their
 * roster rows 'coach_departed', but every coach policy is keyed on
 * coach_user_id, which departure does not touch. A removed coach kept read
 * and write access to the academy's children, and could set status back to
 * 'active' to undo their own removal.
 */
describe('a departed coach keeps nothing', () => {
  const live = loadPolicies()

  it('squad_player_is_mine() excludes departed rows', () => {
    const files = readdirSync(MIGRATIONS).filter(f => f.endsWith('.sql')).sort()
    let latest = ''
    for (const f of files) {
      const sql = readFileSync(join(MIGRATIONS, f), 'utf8')
      const i = sql.indexOf('FUNCTION public.squad_player_is_mine')
      if (i >= 0) latest = sql.slice(i, i + 600)
    }
    expect(latest, 'squad_player_is_mine() is missing — the coach write policies depend on it').not.toBe('')
    expect(
      latest.includes('coach_departed'),
      'squad_player_is_mine() no longer excludes coach_departed rows, so a removed coach ' +
        'keeps write access to the academy’s children',
    ).toBe(true)
  })

  it('squad_players policies exclude departed rows, so removal cannot be undone', () => {
    // INSERT is covered separately: a row being created is never already
    // departed, so the invariant there is a different one.
    const own = live.filter(
      p =>
        p.table === 'squad_players' &&
        ['SELECT', 'UPDATE', 'DELETE', 'ALL'].includes(p.op) &&
        p.body.includes('coach_user_id = auth.uid()'),
    )
    expect(own.length, 'no coach-owned squad_players policy found — did it get renamed?').toBeGreaterThan(0)
    for (const p of own) {
      expect(
        p.body.includes('coach_departed'),
        `Policy "${p.name}" on squad_players (${p.file}) still grants a coach access by ownership ` +
          `alone. A removed coach can read the squad, and on UPDATE can set status back to 'active'.`,
      ).toBe(true)
    }
  })

  it('a roster row cannot be created already departed', () => {
    const inserts = live.filter(p => p.table === 'squad_players' && p.op === 'INSERT')
    expect(inserts.length).toBeGreaterThan(0)
    for (const p of inserts) {
      expect(
        p.body.includes('coach_departed'),
        `Policy "${p.name}" on squad_players (${p.file}) lets a coach insert a row that is already ` +
          `'coach_departed' — invisible to them, but still counted by the academy.`,
      ).toBe(true)
    }
  })

  it('coach reads of assessments and awards route through the roster row', () => {
    const reads = live.filter(
      p =>
        ['coach_assessments', 'recognition_awards'].includes(p.table) &&
        p.op === 'SELECT' &&
        p.body.includes('coach_user_id = auth.uid()'),
    )
    expect(reads.length).toBeGreaterThan(0)
    for (const p of reads) {
      expect(
        p.body.includes('squad_player_is_mine('),
        `Policy "${p.name}" on ${p.table} (${p.file}) lets a coach read by coach_user_id alone, ` +
          `so a departed coach keeps every record they wrote about that academy's children.`,
      ).toBe(true)
    }
  })

  it("a roster row's academy comes from the row, not from its coach's current club", () => {
    const files = readdirSync(MIGRATIONS).filter(f => f.endsWith('.sql')).sort()
    let latest = ''
    for (const f of files) {
      const sql = readFileSync(join(MIGRATIONS, f), 'utf8')
      const i = sql.indexOf('FUNCTION public.squad_player_in_my_org')
      if (i >= 0) latest = sql.slice(i, i + 600)
    }
    expect(latest, 'squad_player_in_my_org() is missing').not.toBe('')
    expect(
      latest.includes('coach_in_my_org'),
      'squad_player_in_my_org() resolves the academy through the coach again. Moving a coach ' +
        'from academy A to academy B then hands B every roster row A’s coach still owns.',
    ).toBe(false)
  })
})
