import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * One defect class, six instances, three files, all found in a single day:
 *
 *   K5              three writes in CoachAddSession discarded their error, then
 *                   said "Match saved" and navigated away
 *   Imad on #44     three more in CoachAssessPage — a failed publish that
 *                   navigated home, and a save that saved nothing and reported
 *                   success through .maybeSingle() returning null with no error
 *   this sweep      CoachHomePage treated a FAILED READ as "no invite code" and
 *                   overwrote the coach's existing one
 *
 * The shape is always the same: **absence of an error taken as evidence of
 * success.** CLAUDE.md states the rule — "Always inspect query errors; a failed
 * request is not an empty result" — and it kept being broken anyway.
 *
 * So this asserts the rule over every routed coach surface rather than pinning
 * the six lines that happened to be wrong, because the next instance will be a
 * seventh line nobody remembers to add here.
 */

const DIRS = [
  join(process.cwd(), 'src', 'pages', 'coach'),
  join(process.cwd(), 'src', 'components', 'coach'),
]

/** Components nothing imports or routes. Fixing them is editing dead code. */
const UNREFERENCED = new Set(['CoachQuickMatchLog.tsx', 'CoachAssess.tsx', 'CoachSessionDetail.tsx'])

function sources(): { name: string; path: string; code: string }[] {
  return DIRS.flatMap(dir =>
    readdirSync(dir)
      .filter(f => f.endsWith('.tsx') && !UNREFERENCED.has(f))
      .map(name => {
        const path = join(dir, name)
        const code = readFileSync(path, 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
          .replace(/(^|[^:])\/\/.*$/gm, '$1')
        return { name, path, code }
      }),
  )
}

describe('routed coach surfaces do not treat a missing error as success', () => {
  const files = sources()

  it('finds coach sources to check', () => {
    expect(files.length, 'no coach sources found — did the directories move?').toBeGreaterThan(3)
  })

  for (const { name, code } of files) {
    it(`${name}: every write captures its error`, () => {
      const offenders: string[] = []
      const lines = code.split('\n')

      lines.forEach((line, i) => {
        if (!/await\s+supabase\b/.test(line)) return
        // The write verb may sit on this line or the next few (chained builder).
        const window = lines.slice(i, i + 4).join('\n')
        if (!/\.(insert|update|upsert|delete|rpc)\s*\(/.test(window)) return
        // Walk back to the start of the enclosing statement rather than a fixed
        // number of lines. A ternary puts the destructure several lines above
        // the `await` on its second branch:
        //
        //   const { data, error } = existingId
        //     ? await supabase...update(...)
        //     : await supabase...insert(...)   <- the error IS captured
        //
        // A 2-line window called that a discarded error. Stop at a blank line
        // or a completed statement instead.
        let start = i
        while (start > 0) {
          const prev = lines[start - 1].trim()
          if (prev === '' || prev.endsWith(';') || prev.endsWith('{') || prev.endsWith('}')) break
          start--
        }
        const context = lines.slice(start, i + 1).join('\n')
        if (!/\berror\b/.test(context)) offenders.push(`${i + 1}: ${line.trim().slice(0, 72)}`)
      })

      expect(
        offenders,
        `${name} has writes whose error is discarded. A rejected write then looks identical to a ` +
          `successful one, which is how a coach gets told "saved" while nothing was written.`,
      ).toEqual([])
    })
  }

  // The sharpest instance of the class, because it does not merely hide a
  // failure — it causes one. A discarded read error falls through to the
  // "no code yet" branch and overwrites the coach's existing invite code,
  // invalidating every code already handed to a player.
  //
  // Asserted across every file that generates a code, not just the one I fixed
  // first: CoachProfilePage carried an identical copy, commented "same pattern
  // as CoachHomePage". The duplicate was deliberate, so a single-file check
  // would have proved nothing about the bug.
  const codeGenerators = files.filter(f => f.code.includes('generateCode()'))

  it('finds the invite-code generators', () => {
    expect(codeGenerators.length, 'no coach surface generates an invite code').toBeGreaterThan(0)
  })

  for (const { name, code } of codeGenerators) {
    it(`${name}: cannot rotate an invite code on a failed read`, () => {
      const lookup = code.slice(code.indexOf("select('invite_code')"))
      const generateAt = lookup.indexOf('generateCode()')
      expect(generateAt, `${name}: the invite-code generation path moved`).toBeGreaterThan(-1)
      expect(
        /if \(error\)/.test(lookup.slice(0, generateAt)),
        `${name} generates and stores a new invite code without first ruling out a failed read. ` +
          `An offline moment silently rotates the code every player was already given, and ` +
          `nothing they were told will match.`,
      ).toBe(true)
    })

    it(`${name}: verifies the generated code was actually stored`, () => {
      // Imad, second review: both writes checked only `error`. An absent
      // profile row updates nothing, returns no error, and the coach is shown
      // a code the database never accepted — the same "no error means success"
      // mistake one layer down from the one I had just fixed.
      const lookup = code.slice(code.indexOf('generateCode()'))
      expect(
        /\.select\('invite_code'\)/.test(lookup),
        `${name} stores a generated invite code without selecting it back, so a zero-row update ` +
          `is indistinguishable from a successful one.`,
      ).toBe(true)
      expect(
        /stored\?\.invite_code !== newCode/.test(lookup),
        `${name} does not compare the stored code against the one it generated.`,
      ).toBe(true)
    })

    it(`${name}: only a verified code is shown as copyable`, () => {
      // A boolean failure flag that nothing clears leaves a valid code reading
      // "Unavailable" after a later read succeeds; and while the first read is
      // pending, the placeholder is copyable. Three states, not two.
      expect(
        /'loading' \| 'ready' \| 'failed'/.test(code),
        `${name} tracks invite-code availability as something other than an explicit ` +
          `loading/ready/failed state, so a pending or stale value can be copied.`,
      ).toBe(true)
      expect(
        (code.match(/setInviteStatus\('ready'\)/g) || []).length >= 2,
        `${name} does not set 'ready' on both success paths — the existing-code path and the ` +
          `freshly generated one — so a recovered read still reads as unavailable.`,
      ).toBe(true)
    })
  }
})
