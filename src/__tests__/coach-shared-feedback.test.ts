import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * K9's product half: the coach can write feedback for the child and publish it
 * deliberately.
 *
 * Without this, K9 is a net removal — the four children who can currently read
 * a coach note read nothing, and no coach can give them anything, because the
 * table has no writer. The pilot's fourth pillar is "the loop must close:
 * coach assesses -> athlete sees", so shipping the privacy fix alone breaks the
 * thing we demo.
 *
 * "No auto-copy" is a schema property in the migration. These assert it is also
 * a UI property, which is where it would actually be violated: one careless
 * `setShared(note)` and every private note becomes publishable in one tap.
 */

const PAGE = join(process.cwd(), 'src', 'pages', 'coach', 'CoachAssessPage.tsx')
const PLAYER_HOME = join(process.cwd(), 'src', 'pages', 'player', 'PlayerHome.tsx')

/** Source with comments stripped — prose must not satisfy or trip these. */
function code(path: string = PAGE): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

describe('K9 UI: the coach writes shared feedback separately', () => {
  it('writes it to coach_shared_feedback, not to the notes table', () => {
    const src = code()
    expect(src.includes('coach_shared_feedback'), 'the page never writes shared feedback').toBe(true)
  })

  it('never copies the private note into the shared box', () => {
    const src = code()
    // The violation to catch: seeding the shared field from `note`, in either
    // direction. Auto-copy is what Imad's decision ruled out, and the schema
    // cannot prevent it — only the UI can.
    expect(
      /setShared\s*\(\s*note\b/.test(src),
      'the page seeds shared feedback from the private note. That is the auto-copy Imad ruled ' +
        'out: the coach wrote those words for themselves, and one tap would publish them to the child.',
    ).toBe(false)
    expect(
      /setNote\s*\(\s*shared\b/.test(src),
      'the page seeds the private note from the shared text, which conflates the two records.',
    ).toBe(false)
  })

  it('publishes only when the coach asked and there is something to publish', () => {
    const src = code()
    // Anchor on the write, not the first mention — the read above it carries a
    // `published_at: string | null` type annotation that matches just as well.
    const upsertAt = src.indexOf('.upsert(', src.indexOf("coach_shared_feedback' as any"))
    expect(upsertAt, 'the page never upserts shared feedback').toBeGreaterThan(-1)
    const upsert = src.slice(upsertAt)
    const m = /published_at:\s*([^,\n]+)/.exec(upsert)
    expect(m, 'the upsert does not set published_at at all').toBeTruthy()
    const expr = m![1]
    expect(
      expr.includes('sharedPublished'),
      `published_at is set to "${expr}" without consulting the publish control, so saving an ` +
        `assessment would publish a draft the coach had not released.`,
    ).toBe(true)
    expect(
      /:\s*null/.test(expr),
      'published_at has no null branch, so feedback can never be retracted once published.',
    ).toBe(true)
  })

  it('reads back what the child can already see', () => {
    const src = code()
    expect(
      /\.from\('coach_shared_feedback'[\s\S]{0,120}\.select\(/.test(src),
      'the page never loads existing shared feedback, so a coach editing an assessment sees a ' +
        'blank box and cannot correct text the child is currently reading.',
    ).toBe(true)
  })

  it('a failed publication keeps the coach on the page with their text', () => {
    // Imad reproduced this on #44: the shared-write error was toasted and the
    // page navigated home anyway, losing the words the coach wrote for the
    // child and offering no retry. Exactly what K5 fixed in the match flow an
    // hour earlier, repeated in my own new code.
    const src = code()
    const sharedErr = src.indexOf('if (sharedError)')
    const navigate = src.indexOf("navigate('/coach/home')", sharedErr)
    expect(sharedErr, 'the shared-write error is no longer handled').toBeGreaterThan(-1)
    const block = src.slice(sharedErr, navigate)
    expect(
      /return\b/.test(block),
      'the shared-feedback failure path falls through to navigate(). The coach loses the text ' +
        'they wrote for the child and cannot retry it.',
    ).toBe(true)
  })

  it('requires an actually saved assessment row before writing anything to it', () => {
    // .maybeSingle() on an UPDATE that matched nothing returns data null with
    // error null. Everything downstream is keyed on saved.id, so without this
    // the note and the shared feedback both skip silently and the coach is
    // sent home believing it saved.
    const src = code()
    expect(
      /if \(!saved\?\.id\)/.test(src),
      'the save path continues when the assessment row is absent but no error was returned.',
    ).toBe(true)
  })

  it('the player actually reads published shared feedback', () => {
    // The gap Imad caught: I built the writer and no reader. coach_shared_feedback
    // was queried only by the coach page, while PlayerHome still read the private
    // note — which K9 makes invisible. So the child saw nothing and K9 stayed a
    // net removal from the only side that matters.
    const src = code(PLAYER_HOME)
    expect(
      src.includes('coach_shared_feedback'),
      'PlayerHome does not read coach_shared_feedback, so published feedback never reaches the ' +
        'child and K9 only removes what they could see.',
    ).toBe(true)
    expect(
      /\.not\('published_at', 'is', null\)/.test(src),
      'PlayerHome reads shared feedback without filtering on published_at. RLS enforces it, but ' +
        'the call site should say so too, so a future policy change cannot quietly widen it.',
    ).toBe(true)
    expect(
      /from\('coach_assessment_notes'\)/.test(src),
      'PlayerHome still queries the private coach note. That is the record K9 made private; ' +
        'the child reads coach_shared_feedback instead.',
    ).toBe(false)
  })

  it('no longer tells the coach their private note reaches the player', () => {
    // The label said "AI will expand these into personalised feedback for the
    // player". K9 makes that false — player-feedback runs as the player and can
    // no longer read the note. A label promising a coach their words reach the
    // child, when they do not, is worse than no label.
    const src = readFileSync(PAGE, 'utf8')
    expect(
      /AI will expand these into personalised feedback for the player/.test(src),
      'the improvement-areas label still claims the private note becomes player feedback. Under ' +
        'K9 the player cannot read it.',
    ).toBe(false)
  })
})
