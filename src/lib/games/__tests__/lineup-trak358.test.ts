import { describe, expect, it } from 'vitest'
import { followPosition, markerWords, markersOf, moveTo, place, playerPlan, setContext, setRole, type PlayerPlan, type PlayerPlans } from '../lineup'

/* TRAK-358 (Season plan 10/18, spec TRAK-348): the match line-up on Formations' pitch. A drag ends on a place, a face
   or a list; Out of position follows the pitch unless the coach set it; each face's markers follow the plan, in words
   too. Synthetic players. */

const plan = (over: Partial<PlayerPlan> = {}): PlayerPlan =>
  ({ role: 'bench', slot: null, job: '', note: '', context: [], expectation: 'usual', ...over })

describe('a drag on the line-up (TRAK-358)', () => {
  const lineUp: PlayerPlans = {
    keeper: plan({ role: 'starter', slot: 1, job: 'Talk to the back four.' }),
    back: plan({ role: 'starter', slot: 2 }),
    sub: plan({ job: 'Ready at half-time.' }),
    out: plan({ role: 'not_selected', note: 'Your chance comes Tuesday.' }),
  }

  it('onto an empty place, the player starts there; onto a starter, the two swap places', () => {
    expect(moveTo(lineUp, 'back', { kind: 'slot', slot: 3 })).toMatchObject({ back: { role: 'starter', slot: 3 }, keeper: { slot: 1 } })
    const swapped = moveTo(lineUp, 'back', { kind: 'player', id: 'keeper' })
    expect(swapped).toMatchObject({ back: { role: 'starter', slot: 1 }, keeper: { role: 'starter', slot: 2, job: 'Talk to the back four.' } })
    expect(moveTo(lineUp, 'back', { kind: 'slot', slot: 1 })).toEqual(swapped)
  })

  it('from the bench onto a starter, the starter goes to the bench; a starter onto a bench face swaps with it', () => {
    expect(moveTo(lineUp, 'sub', { kind: 'player', id: 'keeper' })).toMatchObject({ sub: { role: 'starter', slot: 1 }, keeper: { role: 'bench', slot: null } })
    expect(moveTo(lineUp, 'keeper', { kind: 'player', id: 'sub' })).toMatchObject({ sub: { role: 'starter', slot: 1 }, keeper: { role: 'bench', slot: null } })
  })

  it('onto a list or a Not selected face, the player goes to that list; left out, they keep only their note', () => {
    expect(moveTo(lineUp, 'keeper', { kind: 'list', role: 'bench' }).keeper).toEqual(plan({ job: 'Talk to the back four.' }))
    expect(moveTo(lineUp, 'keeper', { kind: 'list', role: 'not_selected' }).keeper).toEqual(plan({ role: 'not_selected' }))
    expect(moveTo(lineUp, 'sub', { kind: 'player', id: 'out' }).sub).toEqual(plan({ role: 'not_selected' }))
    expect(moveTo(lineUp, 'out', { kind: 'list', role: 'bench' }).out).toEqual(plan({ note: 'Your chance comes Tuesday.' }))
    // From Not selected onto a bench face is onto the bench.
    expect(moveTo(lineUp, 'out', { kind: 'player', id: 'sub' }).out).toMatchObject({ role: 'bench' })
  })

  it('a drag that changes nothing returns the same line-up, so the plan is not marked changed', () => {
    expect(moveTo(lineUp, 'keeper', { kind: 'slot', slot: 1 })).toBe(lineUp)
    expect(moveTo(lineUp, 'sub', { kind: 'list', role: 'bench' })).toBe(lineUp)
    expect(moveTo(lineUp, 'out', { kind: 'list', role: 'not_selected' })).toBe(lineUp)
    expect(moveTo(lineUp, 'sub', { kind: 'player', id: 'sub' })).toBe(lineUp)
    expect(moveTo({ ...lineUp, other: plan() }, 'sub', { kind: 'player', id: 'other' })).toEqual({ ...lineUp, other: plan() })
  })
})

describe('Out of position follows the pitch (TRAK-358)', () => {
  // Out of position here: a starter in slot 2 or 3 (the back line); slot 6 is where they play.
  const out = (_id: string, at: PlayerPlan) => at.role === 'starter' && (at.slot === 2 || at.slot === 3)
  const follow = (before: PlayerPlans, after: PlayerPlans) => followPosition(before, after, out, out)

  it('placed out of position it ticks, by Trak; moved back, or off the pitch, Trak\'s tick goes', () => {
    const start: PlayerPlans = { mid: plan({ role: 'starter', slot: 6, context: ['first_start'] }) }
    const moved = follow(start, place(start, 'mid', 2))
    expect(moved.mid).toMatchObject({ slot: 2, context: ['first_start', 'out_of_position'], outOfPositionByTrak: true })
    // Out to out: nothing changes.
    expect(follow(moved, place(moved, 'mid', 3)).mid.context).toEqual(['first_start', 'out_of_position'])
    expect(follow(moved, place(moved, 'mid', 6)).mid).toMatchObject({ context: ['first_start'], outOfPositionByTrak: undefined })
    expect(follow(moved, setRole(moved, 'mid', 'bench')).mid.context).toEqual(['first_start'])
  })

  it('the coach\'s own tick stays, whether ticked before the move or after it', () => {
    const start: PlayerPlans = { mid: setContext(plan({ role: 'starter', slot: 6 }), ['out_of_position']) }
    const there = follow(start, place(start, 'mid', 2))
    expect(follow(there, place(there, 'mid', 6)).mid.context).toEqual(['out_of_position'])
    // Trak ticks it; the coach unticks and ticks it again: now it's the coach's.
    const ticked = follow({ mid: plan({ role: 'starter', slot: 6 }) }, { mid: plan({ role: 'starter', slot: 2 }) })
    const again = { mid: setContext(setContext(ticked.mid, []), ['out_of_position']) }
    expect(follow(again, place(again, 'mid', 6)).mid.context).toEqual(['out_of_position'])
  })

  it('unticked by the coach, it stays off while the player stays out of position', () => {
    const ticked = follow({ mid: plan({ role: 'starter', slot: 6 }) }, { mid: plan({ role: 'starter', slot: 2 }) })
    const unticked = { mid: setContext(ticked.mid, []) }
    expect(follow(unticked, place(unticked, 'mid', 3)).mid.context).toEqual([])
  })

  it('a tick saved on a player standing out of position reads as Trak\'s; one saved before they went out is the coach\'s', () => {
    // As planToForm reads them: no outOfPositionByTrak.
    const saved: PlayerPlans = { mid: plan({ role: 'starter', slot: 2, context: ['out_of_position'] }) }
    expect(follow(saved, place(saved, 'mid', 6)).mid.context).toEqual([])
    const benched: PlayerPlans = { mid: plan({ context: ['out_of_position'] }) }
    const placed = follow(benched, place(benched, 'mid', 2))
    expect(placed.mid.outOfPositionByTrak).toBe(false)
    expect(follow(placed, place(placed, 'mid', 6)).mid.context).toEqual(['out_of_position'])
  })

  it('a context change other than Out of position leaves Trak\'s tick Trak\'s', () => {
    const ticked = follow({ mid: plan({ role: 'starter', slot: 6 }) }, { mid: plan({ role: 'starter', slot: 2 }) })
    expect(setContext(ticked.mid, ['out_of_position', 'first_start']).outOfPositionByTrak).toBe(true)
  })
})

describe('a face\'s markers (TRAK-358)', () => {
  it('✓ for a job, or a note when not selected; i for any context; a ring for Stretch and Lead, none for Usual', () => {
    expect(markersOf(plan())).toEqual({ done: false, context: false, ring: null })
    expect(markersOf(plan({ job: '  ' }))).toMatchObject({ done: false })
    expect(markersOf(plan({ job: 'Win the first header.', expectation: 'lead' }))).toEqual({ done: true, context: false, ring: 'lead' })
    expect(markersOf(plan({ context: ['back_from_injury'], expectation: 'stretch' }))).toEqual({ done: false, context: true, ring: 'stretch' })
    expect(markersOf(plan({ role: 'not_selected', note: 'Next week.' }))).toMatchObject({ done: true })
    // A job left over on a Not selected player isn't their ✓; only the note is.
    expect(markersOf(plan({ role: 'not_selected', job: 'Old job.' }))).toMatchObject({ done: false })
  })

  it('are said in words, so colour is never the only signal', () => {
    expect(markerWords(plan())).toEqual([])
    expect(markerWords(plan({ job: 'Win it.', context: ['out_of_position', 'first_start'], expectation: 'stretch' })))
      .toEqual(['stretch', 'has a job', 'context: out of position and first start'])
    expect(markerWords(plan({ role: 'not_selected', note: 'Next week.' }))).toEqual(['has a note'])
    expect(markerWords(plan({ expectation: 'lead' }))).toEqual(['lead'])
  })

  it('the default plan carries no marker', () => {
    expect(markersOf(playerPlan({}, 'anyone'))).toEqual({ done: false, context: false, ring: null })
  })
})
