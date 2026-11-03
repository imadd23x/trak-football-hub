import { describe, expect, it } from 'vitest'
import { fromShelf, type PlanDrill } from '../parts'
import { shelfDrill } from '../shelf'
import { adapt, playersOf, setupFor, applySuggestion } from '../turnout'

/* TRAK-342 (Training redo 4/5, spec TRAK-338): how a drill sets up for the players who came, and what Trak suggests. */

const trak = (id: string) => fromShelf(shelfDrill(id)!)
const own = (players_kind: PlanDrill['players_kind'], group_size: number | null = null): PlanDrill =>
  ({ ...trak('w1'), source: 'own', trak_drill: null, name: 'Our drill', players_kind, group_size })

describe('a drill’s set-up for n players', () => {
  it('any number, pairs and two teams', () => {
    expect(setupFor({ kind: 'any', min: 1 }, 15)).toEqual({ ok: true, text: 'everyone together' })
    expect(setupFor({ kind: 'pairs' }, 18)).toEqual({ ok: true, text: '9 pairs' })
    expect(setupFor({ kind: 'pairs' }, 15)).toEqual({ ok: true, text: '6 pairs and 1 group of 3' })
    expect(setupFor({ kind: 'pairs' }, 2)).toEqual({ ok: true, text: '1 pair' })
    expect(setupFor({ kind: 'pairs' }, 5)).toEqual({ ok: true, text: '1 pair and 1 group of 3' })
    expect(setupFor({ kind: 'teams', min: 8 }, 15)).toEqual({ ok: true, text: '7 v 7 + 1 floater' })
    expect(setupFor({ kind: 'teams', min: 8 }, 7)).toEqual({ ok: false })
  })

  it('groups split as evenly as they can, with the set-up named', () => {
    const rondo = shelfDrill('r1')!.players // groups of 6, 4–7, "4 v 2"
    expect(setupFor(rondo, 18)).toEqual({ ok: true, text: '3 grids of 6 (4 v 2)' })
    expect(setupFor(rondo, 15)).toEqual({ ok: true, text: '3 grids of 5 (4 v 1)' })
    expect(setupFor(rondo, 3)).toEqual({ ok: false })
  })
})

describe('what Trak suggests', () => {
  it('everyone here: no change', () => {
    expect(adapt(trak('r1'), 18, 18)).toMatchObject({ status: 'same', message: 'Everyone’s here. No change.' })
  })

  it('fewer here: adjust the set-up; a game also says to shrink the pitch', () => {
    expect(adapt(trak('r1'), 15, 18)).toMatchObject({ status: 'adjust', message: 'Change to 3 grids of 5 (4 v 1).' })
    expect(adapt(trak('g1'), 15, 18)).toMatchObject({ status: 'adjust', message: 'Change to 7 v 7 + 1 floater. Make the pitch a little smaller.' })
  })

  it('the same set-up still working says so; any number never changes', () => {
    expect(adapt(trak('w1'), 12, 18)).toMatchObject({ status: 'same', message: 'Works with any number. No change.' })
  })

  it('too few for the drill: swap to the one Trak pairs it with, or say to pick another', () => {
    const swap = adapt(trak('r3'), 5, 18) // Rondo 6 v 3 needs 8–10 a box; swaps to Rondo 4 v 2
    expect(swap).toMatchObject({ status: 'swap', message: 'Rondo 6 v 3, two boxes doesn’t work well with 5. Swap to Rondo 4 v 2: 1 grid of 5 (4 v 1).' })
    expect(adapt(trak('g4'), 3, 18)).toMatchObject({ status: 'swap', alt: null, message: 'Small-sided games to mini goals doesn’t work well with 3. Pick another drill.' })
  })

  it('a drill nobody said the numbers of: Trak says so', () => {
    expect(adapt(own(null), 15, 18)).toMatchObject({ status: 'unknown' })
  })

  it('reads the coach’s own drills from Write your own', () => {
    expect(playersOf(own('groups', 4))).toEqual({ kind: 'groups', g: 4, lo: 3, hi: 5, unit: 'group' })
    expect(adapt(own('groups', 4), 15, 16)).toMatchObject({ status: 'adjust', message: 'Change to 3 groups of 4 and 1 group of 3.' })
  })
})

describe('using a suggestion', () => {
  const part = { key: 'k', type: 'rondo' as const, name: 'Rondo', minutes: 15, drill: trak('r3') }

  it('an adjustment goes in the drill’s Numbers; a swap takes the other drill, same minutes', () => {
    expect(applySuggestion({ ...part, drill: trak('r1') }, adapt(trak('r1'), 15, 18)).drill).toMatchObject({ trak_drill: 'r1', numbers: '3 grids of 5 (4 v 1)' })
    const swapped = applySuggestion(part, adapt(trak('r3'), 5, 18))
    expect(swapped).toMatchObject({ minutes: 15, name: 'Rondo', drill: { trak_drill: 'r1', name: 'Rondo 4 v 2', numbers: '1 grid of 5 (4 v 1)' } })
  })

  it('no change, or nothing to swap to: the part stays as it was', () => {
    expect(applySuggestion(part, adapt(trak('g4'), 3, 18))).toBe(part)
  })
})
