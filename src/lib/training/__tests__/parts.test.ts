import { describe, expect, it } from 'vitest'
import {
  candidates, fitLine, fromShelf, isStandard, lastShape, minuteOptions, moveTo, partsFromSaved, partsFromShape, planProblem,
  shownFor, standardShape, tagFor, toSave, usageOf, usualFor, type MyDrill, type PastPlan, type SavedPart,
} from '../parts'
import { SHELF, shelfDrill } from '../shelf'

/* TRAK-340 (Training redo 2/5, spec TRAK-338): a plan of parts, the drills each part shows, and what's saved. */

const practice = (position: number, name: string, over: Partial<SavedPart> = {}): SavedPart => ({
  position, name, minutes: 15, how: '', tell: '', area: '', numbers: '', direction: '', targets: '', conditions: '',
  source: 'own', drill_id: null, library_session: null, ...over,
})
const trak = (position: number, id: string, part: string, type: string) =>
  practice(position, shelfDrill(id)!.name, { source: 'trak', trak_drill: id, part, part_type: type })
const mine = (id: string, name: string, part_type: string | null): MyDrill => ({
  id, name, minutes: 15, how: 'Ours.', tell: '', area: '', numbers: '', direction: '', targets: '', conditions: '',
  part_type, players_kind: 'pairs', group_size: null,
})

describe('the shelf', () => {
  it('has drills for every one of Trak’s parts, each with a name, what the players do and how many', () => {
    for (const part of ['warmup', 'passing', 'rondo', 'functional', 'game', 'setpieces', 'finishing', 'cooldown'])
      expect(SHELF.filter(d => d.part === part).length).toBeGreaterThanOrEqual(3)
    for (const d of SHELF) {
      expect(d.name.length).toBeLessThanOrEqual(80)
      expect(d.how.length).toBeGreaterThan(10)
    }
    expect(new Set(SHELF.map(d => d.id)).size).toBe(SHELF.length)
  })
})

describe('your usual and the three drills a part shows', () => {
  const past: PastPlan[] = [
    { day: 'Wed 28 Oct', practices: [trak(1, 'r1', 'Rondo', 'rondo')] },
    { day: 'Mon 26 Oct', practices: [trak(1, 'r3', 'Rondo', 'rondo')] },
    { day: 'Wed 21 Oct', practices: [trak(1, 'r1', 'Rondo', 'rondo')] },
  ]
  const usage = usageOf(past)
  const all = candidates('rondo', [])

  it('the usual is the drill used most lately; the tags say how often and when', () => {
    expect(usualFor('rondo', all, usage)?.trak_drill).toBe('r1')
    expect(tagFor(fromShelf(shelfDrill('r1')!), 'rondo', all, usage)).toBe('Your usual · 2 of your last 3')
    expect(tagFor(fromShelf(shelfDrill('r3')!), 'rondo', all, usage)).toBe('Last used Mon 26 Oct')
    expect(tagFor(fromShelf(shelfDrill('r2')!), 'rondo', all, usage)).toBe('Trak drill')
  })

  it('shows the usual, then those used lately, then the rest; the picked one always shows', () => {
    expect(shownFor('rondo', null, all, usage).map(d => d.trak_drill)).toEqual(['r1', 'r3', 'r2'])
    expect(shownFor('rondo', fromShelf(shelfDrill('r6')!), all, usage).map(d => d.trak_drill)).toEqual(['r1', 'r3', 'r6'])
  })

  it('with nothing used yet, Trak’s first; a part of the coach’s own has no usual', () => {
    expect(usualFor('rondo', all, usageOf([]))?.trak_drill).toBe('r1')
    expect(usualFor('own', candidates('own', []), usage)).toBeNull()
  })

  it('a drill written in a plan matches the same-named one in My drills, so it never shows twice', () => {
    const list = candidates('own', [mine('d-1', 'Pressing on the trigger', null)])
    const written = { ...list[0], source: 'own' as const, drill_id: null }
    const shown = shownFor('own', written, list, usageOf([]))
    expect(shown.filter(d => d.name === 'Pressing on the trigger')).toHaveLength(1)
  })

  it('the coach’s own drills sit on their part’s shelf, first', () => {
    const list = candidates('rondo', [mine('d-1', 'Our rondo', 'rondo'), mine('d-2', 'Our game', 'game')])
    expect(list[0]).toMatchObject({ source: 'drill', drill_id: 'd-1', name: 'Our rondo' })
    expect(list.some(d => d.name === 'Our game')).toBe(false)
    expect(tagFor(list[0], 'rondo', list, usageOf([]))).toBe('My drill')
  })
})

describe('a new plan’s shape', () => {
  it('is the parts of the coach’s last plan with parts, else Trak’s five', () => {
    expect(standardShape().map(p => `${p.name} ${p.minutes}`))
      .toEqual(['Dry warm-up 10', 'Passing & movement 15', 'Rondo 15', 'Functional drills 25', 'Game 25'])
    expect(lastShape([{ day: 'x', practices: [practice(1, 'Old')] }])).toBeNull()
    expect(lastShape([{ day: 'x', practices: [trak(1, 'w1', 'Warm-up', 'warmup'), practice(2, 'Ours', { part: 'Pressing game', part_type: 'own', minutes: 20 })] }]))
      .toEqual([{ type: 'warmup', name: 'Warm-up', minutes: 15 }, { type: 'own', name: 'Pressing game', minutes: 20 }])
  })

  it('each part starts with its usual drill picked; isStandard knows Trak’s five', () => {
    const parts = partsFromShape(standardShape(), [], usageOf([]))
    expect(parts.map(p => p.drill?.trak_drill)).toEqual(['w1', 'p1', 'r1', 'f1', 'g1'])
    expect(isStandard(parts)).toBe(true)
    expect(isStandard(parts.slice(1))).toBe(false)
  })
})

describe('saving', () => {
  it('needs a drill in every part', () => {
    const parts = partsFromShape([...standardShape(), { type: 'own', name: 'Pressing game', minutes: 20 }], [], usageOf([]))
    expect(planProblem(parts)).toBe('Pick a drill for Pressing game, or remove the part.')
    expect(planProblem([])).toBe('Add a part first.')
    expect(planProblem(parts.slice(0, 5))).toBeNull()
  })

  it('sends each part as a practice with its part, type, Trak drill and players', () => {
    const [warmup] = partsFromShape(standardShape(), [], usageOf([]))
    expect(toSave([{ ...warmup, name: ' Warm-up ' }])).toEqual([expect.objectContaining({
      name: 'Dynamic warm-up', minutes: 10, source: 'trak', trak_drill: 'w1', part: 'Warm-up', part_type: 'warmup',
      players_kind: 'any', group_size: null, save_to_drills: false,
    })])
  })

  it('reads a saved plan back as parts; one from before parts makes each practice a part', () => {
    const parts = partsFromSaved([practice(2, 'Game 8v8', { minutes: 30 }), trak(1, 'r1', 'Rondo', 'rondo')])
    expect(parts.map(p => `${p.type}/${p.name}/${p.drill?.name}/${p.minutes}`)).toEqual(['rondo/Rondo/Rondo 4 v 2/15', 'own/Game 8v8/Game 8v8/30'])
  })
})

describe('time and order', () => {
  it('is soft: fits, spare, or over and that’s fine', () => {
    expect(fitLine(90, 90)).toBe('Fits your 90 minutes.')
    expect(fitLine(80, 90)).toBe('10 min spare.')
    expect(fitLine(95, 90)).toBe('5 min over. That’s fine, it’s only a guide.')
    expect(fitLine(95, null)).toBeNull()
  })

  it('offers the part’s minutes, plus whatever it’s set to', () => {
    expect(minuteOptions('rondo', 15)).toEqual([10, 15, 20])
    expect(minuteOptions('rondo', 35)).toEqual([10, 15, 20, 35])
  })

  it('moves a part to a new place', () => {
    expect(moveTo(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a'])
    expect(moveTo(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b'])
    expect(moveTo(['a', 'b'], 0, 5)).toEqual(['a', 'b'])
  })
})
