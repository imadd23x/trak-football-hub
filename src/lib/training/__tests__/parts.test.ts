import { describe, expect, it } from 'vitest'
import {
  candidates, fitLine, fromLibrary, fromShelf, hasOwnDrills, isStandard, libraryFor, libraryOf, libraryPart, lastShape, minuteOptions, moveTo,
  partsFromSaved, partsFromShape, planProblem, shownFor, standardShape, tagFor, toSave, usageOf, usualFor, type PastPlan, type SavedPart,
} from '../parts'
import { SHELF, shelfDrill } from '../shelf'
import { DRILL_LIMITS } from '../sessions'
import { LEVELS, LIBRARY, START_LEVEL, fit, partFor } from '../library'

/* TRAK-340 (Training redo 2/5, spec TRAK-338): a plan of parts, the drills each part shows, and what's saved. */

const practice = (position: number, name: string, over: Partial<SavedPart> = {}): SavedPart => ({
  position, name, minutes: 15, how: '', tell: '', area: '', numbers: '', direction: '', targets: '', conditions: '',
  source: 'own', drill_id: null, library_session: null, ...over,
})
const trak = (position: number, id: string, part: string, type: string) =>
  practice(position, shelfDrill(id)!.name, { source: 'trak', trak_drill: id, part, part_type: type })
const lib = (position: number, id: string, part: string, type: string) =>
  practice(position, LIBRARY.find(d => d.id === id)!.name, { source: 'trak', trak_drill: id, part, part_type: type })
const PLAYERS = 14

describe('the shelf', () => {
  it('still names Trak’s old drills, so plans saved before keep showing theirs', () => {
    for (const d of SHELF) {
      expect(d.name.length).toBeLessThanOrEqual(80)
      expect(d.how.length).toBeGreaterThan(10)
    }
    expect(new Set(SHELF.map(d => d.id)).size).toBe(SHELF.length)
  })
})

/* TRAK-392 (Drill Library 7/11): each part's drills are the Library's. */
describe('the drills a part offers', () => {
  it('Trak’s five parts each have Library drills of their own, team drills first; the rest pick from every drill', () => {
    for (const type of ['warmup', 'passing', 'rondo', 'functional', 'game'] as const) {
      expect(hasOwnDrills(type)).toBe(true)
      const drills = libraryFor(type)
      expect(drills.length).toBeGreaterThanOrEqual(3)
      expect(drills.every(d => partFor(d) === type)).toBe(true)
      expect(drills[0].focus).toBe('team')
    }
    // TRAK-388: Cool-down has its own two drills.
    expect(libraryFor('cooldown').map(d => d.name)).toEqual(['Easy jog and stretch', 'Walk, pass and talk'])
    for (const type of ['setpieces', 'finishing', 'own'] as const) {
      expect(hasOwnDrills(type)).toBe(false)
      expect(libraryFor(type)).toHaveLength(LIBRARY.length)
    }
  })

  it('are fitted to the squad at the standard level', () => {
    const [first] = candidates('rondo', PLAYERS)
    const d = LIBRARY.find(x => x.id === first.trak_drill)!
    expect(first).toMatchObject({ source: 'trak', trak_level: START_LEVEL, area: fit(d, PLAYERS, START_LEVEL).details.area })
  })
})

describe('your usual and the three drills a part shows', () => {
  const all = candidates('rondo', PLAYERS)
  const [a, b, c, d] = all.map(x => x.trak_drill!)
  const past: PastPlan[] = [
    { day: 'Wed 28 Oct', practices: [lib(1, c, 'Rondo', 'rondo')] },
    { day: 'Mon 26 Oct', practices: [lib(1, d, 'Rondo', 'rondo')] },
    { day: 'Wed 21 Oct', practices: [lib(1, c, 'Rondo', 'rondo')] },
  ]
  const usage = usageOf(past)
  const of = (id: string) => all.find(x => x.trak_drill === id)!

  it('the usual is the drill used most lately; the tags say how often and when', () => {
    expect(usualFor('rondo', all, usage)?.trak_drill).toBe(c)
    expect(tagFor(of(c), 'rondo', all, usage)).toBe('Your usual · 2 of your last 3')
    expect(tagFor(of(d), 'rondo', all, usage)).toBe('Last used Mon 26 Oct')
    expect(tagFor(of(a), 'rondo', all, usage)).toBe('')
    expect(tagFor(of(a), 'rondo', all, usage, [a])).toBe('In My drills')
  })

  it('shows the usual, then those used lately, then the rest; the picked one always shows', () => {
    expect(shownFor('rondo', null, all, usage).map(x => x.trak_drill)).toEqual([c, d, a])
    const picked = all.at(-2)!
    expect(shownFor('rondo', picked, all, usage).map(x => x.trak_drill)).toEqual([c, d, picked.trak_drill])
  })

  it('with nothing used yet, the starter drill first; a part that picks from every drill has no usual', () => {
    expect(usualFor('rondo', all, usageOf([]))?.trak_drill).toBe(a)
    expect(tagFor(of(a), 'rondo', all, usageOf([]))).toBe('Starter drill')
    expect(shownFor('rondo', null, all, usageOf([])).map(x => x.trak_drill)).toEqual([a, b, c])
    expect(usualFor('own', candidates('own', PLAYERS), usage)).toBeNull()
    expect(usualFor('finishing', candidates('finishing', PLAYERS), usage)).toBeNull()
  })

  it('only team drills make the three, unless the coach has used one', () => {
    const shown = shownFor('passing', null, candidates('passing', PLAYERS), usageOf([]))
    expect(shown.every(x => LIBRARY.find(y => y.id === x.trak_drill)!.focus === 'team')).toBe(true)
  })

  it('a drill from an older plan keeps showing as it was saved, with what it was', () => {
    const old = partsFromSaved([trak(1, 'r1', 'Rondo', 'rondo')])[0].drill!
    expect(shownFor('rondo', old, all, usage).at(-1)?.name).toBe('Rondo 4 v 2')
    expect(tagFor(old, 'rondo', all, usage)).toBe('Trak drill')
    expect(libraryOf(old)).toBeUndefined()
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

  it('each part starts with its starter drill from the Library picked; isStandard knows Trak’s five', () => {
    const parts = partsFromShape(standardShape(), PLAYERS, usageOf([]))
    expect(parts.map(p => p.drill?.trak_drill)).toEqual(standardShape().map(p => libraryFor(p.type).find(d => d.focus === 'team')!.id))
    expect(parts.every(p => p.drill?.trak_level === START_LEVEL)).toBe(true)
    expect(isStandard(parts)).toBe(true)
    expect(isStandard(parts.slice(1))).toBe(false)
  })
})

describe('saving', () => {
  it('needs a drill in every part', () => {
    const parts = partsFromShape([...standardShape(), { type: 'own', name: 'Pressing game', minutes: 20 }], PLAYERS, usageOf([]))
    expect(planProblem(parts)).toBe('Pick a drill for Pressing game, or remove the part.')
    expect(planProblem([])).toBe('Add a part first.')
    expect(planProblem(parts.slice(0, 5))).toBeNull()
  })

  it('sends each part as a practice with its part, type, Library drill, level and players', () => {
    const [warmup] = partsFromShape(standardShape(), PLAYERS, usageOf([]))
    const first = libraryFor('warmup')[0]
    expect(toSave([{ ...warmup, name: ' Warm-up ' }])).toEqual([expect.objectContaining({
      name: first.name, minutes: 10, source: 'trak', trak_drill: first.id, trak_level: START_LEVEL, part: 'Warm-up', part_type: 'warmup',
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

/* TRAK-391 (Drill Library 6/11): a Library drill joins a plan as a part. */
describe('a Library drill in a plan', () => {
  const keep = LIBRARY.find(d => d.name === 'Keep the ball')!
  it('joins as its kind’s part, fitted to the players and level set, and saves its level', () => {
    const part = libraryPart(keep, 12, 5)
    expect(part).toMatchObject({ type: 'rondo', name: 'Rondo', minutes: 15 })
    const { details } = fit(keep, 12, 5)
    expect(part.drill).toMatchObject({ name: 'Keep the ball', source: 'trak', trak_drill: keep.id, trak_level: 5, drill_id: null,
      area: details.area, numbers: details.numbers, direction: details.direction, targets: details.targets, conditions: details.conditions })
    expect(part.drill!.how.split('\n')).toEqual([...keep.how])
    expect(part.drill!.tell.split('\n')).toEqual([...keep.watch])
    const [saved] = toSave([part]) as Record<string, unknown>[]
    expect(saved).toMatchObject({ source: 'trak', trak_drill: keep.id, trak_level: 5, part_type: 'rondo' })
  })
  it('keeps the level to the eight there are, and every text to its limit', () => {
    expect(fromLibrary(keep, 12, 99).trak_level).toBe(LEVELS - 1)
    expect(fromLibrary(keep, 12, -3).trak_level).toBe(0)
    for (const d of LIBRARY) {
      const drill = fromLibrary(d, 20, 7)
      expect(drill.how.length).toBeLessThanOrEqual(DRILL_LIMITS.how)
      expect(drill.tell.length).toBeLessThanOrEqual(DRILL_LIMITS.tell)
      for (const key of ['area', 'numbers', 'direction', 'targets', 'conditions'] as const) expect(drill[key].length).toBeLessThanOrEqual(DRILL_LIMITS.detail)
    }
  })
  it('a saved plan reads the level back; other drills and older plans have none', () => {
    const [part] = partsFromSaved([{ position: 1, name: 'Keep the ball', minutes: 15, how: '', tell: '', area: '', numbers: '', direction: '',
      targets: '', conditions: '', source: 'trak', drill_id: null, library_session: null, trak_drill: keep.id, trak_level: 3 }])
    expect(part.drill!.trak_level).toBe(3)
    expect(fromShelf(SHELF[0]).trak_level).toBeNull()
    const [old] = partsFromSaved([{ position: 1, name: 'Rondo', minutes: 15, how: '', tell: '', area: '', numbers: '', direction: '',
      targets: '', conditions: '', source: 'own', drill_id: null, library_session: null }])
    expect(old.drill!.trak_level).toBeNull()
  })
})
