import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { needsCoachInput, canRecordAssessment } from '../assessment-entry'

/**
 * A first assessment must not be recorded from the slider defaults.
 *
 * Found by @t-bones29 while counting the coach loop for the 3-minute gate, and
 * left on the coach surface. It is the upstream half of the "everything reads
 * 5" problem: some of those 5s may never have been chosen by anyone.
 *
 * Live data when this was written: 134 assessments, 55 of them a player's
 * first, and exactly 1 first assessment that is all-fives. So it is rare
 * historically — and that number is an upper bound, since a coach may
 * genuinely rate a child 5 across. What makes it worth fixing is not the
 * history: at a demo with a fresh squad EVERY assessment is a first
 * assessment, so the rare path becomes the only path.
 *
 * ⚠️ A render test was written first and deliberately discarded. Four `it`
 * blocks mounting CoachQuickAssess into the same jsdom left exactly one with a
 * mounted tree and the rest with an empty body, and which one survived changed
 * between runs; collapsing to a single test did not stabilise it. Three
 * assertions silently examining an empty page would be worse than no suite at
 * all — "control not found" would read as "control correctly absent", which is
 * the very class of defect this fix addresses. So the rule was extracted to a
 * pure function and is tested as a truth table instead. The DOM wiring is
 * covered by the source assertions at the bottom, and that gap is named here
 * rather than left for someone to discover.
 */

const SCREEN = join(process.cwd(), 'src', 'pages', 'coach', 'CoachQuickAssess.tsx')

/** Source with comments stripped: a comment explaining the rule must not satisfy a check for it. */
function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

describe('when the sliders may be recorded', () => {
  // The whole rule is four cases. Stating them as a table means a change to the
  // logic has to change an expectation here, rather than quietly widening.
  const cases: Array<[boolean, boolean, boolean, string]> = [
    // hasPreviousScores, touched, needsInput, why
    [false, false, true,  'first assessment, untouched — the 5s are the control default'],
    [false, true,  false, 'first assessment, coach moved something — that is a judgement'],
    [true,  false, false, 'returning player, untouched — carries previous scores, "nothing changed"'],
    [true,  true,  false, 'returning player, adjusted — plainly a judgement'],
  ]

  it.each(cases)(
    'hasPreviousScores=%s touched=%s -> needsCoachInput=%s (%s)',
    (hasPreviousScores, touched, expected) => {
      expect(needsCoachInput({ hasPreviousScores, touched })).toBe(expected)
    },
  )

  it('is the only case that blocks: exactly one of four', () => {
    const blocked = cases.filter(([, , needsInput]) => needsInput)
    expect(blocked).toHaveLength(1)
    expect(blocked[0][0]).toBe(false)  // no previous scores
    expect(blocked[0][1]).toBe(false)  // untouched
  })

  it('canRecordAssessment is the exact inverse', () => {
    for (const [hasPreviousScores, touched] of cases) {
      const state = { hasPreviousScores, touched }
      expect(canRecordAssessment(state)).toBe(!needsCoachInput(state))
    }
  })

  it('the returning-player fast path is preserved — the 3-minute loop depends on it', () => {
    // POSITIVE CONTROL. A rule of "always require input" would pass every
    // blocking assertion above and cost the per-session loop its speed.
    expect(canRecordAssessment({ hasPreviousScores: true, touched: false })).toBe(true)
  })
})

describe('the screen actually applies the rule', () => {
  const src = code(SCREEN)

  it('asks the shared helper rather than reimplementing the condition', () => {
    expect(src).toMatch(/needsCoachInput\s*\(/)
    expect(src).toMatch(/from\s+['"]@\/lib\/assessment-entry['"]/)
  })

  it('guards the save path, not only the button', () => {
    // The disabled attribute is an affordance. handleNext is the line that
    // decides what reaches a child's record, so it must refuse too.
    const handleNext = src.slice(src.indexOf('const handleNext'), src.indexOf('const handleSkip'))
    expect(handleNext).toContain('needsInput')
  })

  it('disables the save control while input is still needed', () => {
    expect(src).toMatch(/disabled=\{\s*saving\s*\|\|\s*needsInput\s*\}/)
  })

  it('tracks that the coach moved a slider', () => {
    // Six sliders, all of them marking the screen as touched. A missed one
    // would leave a metric able to record its default.
    const slides = src.match(/onChange=\{onSlide\(/g) ?? []
    expect(slides).toHaveLength(6)
  })
})
