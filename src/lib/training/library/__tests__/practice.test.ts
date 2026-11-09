import { describe, expect, it } from 'vitest'
import { CANVAS, CHARACTERISTICS, DETAILS, bounds, characteristic, counts, practiceKey, practiceLayout } from '..'

/* TRAK-394 (Drill Library 9/11): Change any practice. Steve's five things, in the drill page's order and words, each
   example drawn with the players it names, on the canvas. */

describe('Change any practice', () => {
  it('the five things are the drill page’s five details, in the same order and words', () => {
    expect(CHARACTERISTICS.map(c => c.name)).toEqual(DETAILS.map(d => d.name))
    expect(characteristic('targets')?.name).toBe('Targets')
    expect(characteristic('nonsense')).toBeUndefined()
  })

  it('each thing has examples with what changes, but Conditions, which has Steve’s three rules', () => {
    for (const c of CHARACTERISTICS) {
      if (c.key === 'conditions') {
        expect(c.examples).toBeUndefined()
        expect(c.rules?.map(r => r.title)).toEqual(['Justify it', 'Start points are not conditions', 'Apply it'])
      } else {
        expect(c.examples!.length).toBeGreaterThanOrEqual(2)
        for (const x of c.examples!) expect(x.answer.length).toBeGreaterThan(20)
      }
    }
  })

  it('every example draws the players its question names', () => {
    // Area: the same 16 players in four lines, both ways round.
    expect(counts(practiceLayout('area', 0))).toEqual({ main: 8, other: 8, extra: 0, spare: 0 })
    expect(counts(practiceLayout('area', 1))).toEqual({ main: 8, other: 8, extra: 0, spare: 0 })
    // Numbers: 15 players and 2 keepers. 3 spare and 3v3 at each end, or 1 spare, 3v3 in the middle and 2v2 at the ends.
    expect(counts(practiceLayout('numbers', 0))).toEqual({ main: 6, other: 6, extra: 2, spare: 3 })
    expect(counts(practiceLayout('numbers', 1))).toEqual({ main: 7, other: 7, extra: 2, spare: 1 })
    // Targets: 8 v 7 from the keeper, to a goal (two keepers) or to the whole far line.
    expect(counts(practiceLayout('targets', 0))).toEqual({ main: 8, other: 7, extra: 2, spare: 0 })
    expect(counts(practiceLayout('targets', 1))).toEqual({ main: 8, other: 7, extra: 1, spare: 0 })
    expect(practiceLayout('targets', 1).some(s => s.s === 'target')).toBe(true)
    // Direction: the same 12 v 2; an end line only once there's a way to go.
    for (const eg of [0, 1, 2]) expect(counts(practiceLayout('direction', eg))).toEqual({ main: 12, other: 2, extra: 0, spare: 0 })
    expect(practiceLayout('direction', 0).some(s => s.s === 'target')).toBe(false)
    expect(practiceLayout('direction', 2).some(s => s.s === 'target')).toBe(true)
    expect(practiceLayout('conditions', 0)).toEqual([])
  })

  it('the same picture every time, and on the canvas', () => {
    for (const c of CHARACTERISTICS) (c.examples ?? []).forEach((_, eg) => {
      const shapes = practiceLayout(c.key, eg)
      expect(practiceLayout(c.key, eg)).toEqual(shapes)
      const b = bounds(shapes)!
      expect(b.x).toBeGreaterThanOrEqual(0)
      expect(b.y).toBeGreaterThanOrEqual(0)
      expect(b.x + b.w).toBeLessThanOrEqual(CANVAS.w)
      expect(b.y + b.h).toBeLessThanOrEqual(CANVAS.h)
    })
  })

  it('the key names what each colour is; the end line only once it’s drawn', () => {
    expect(practiceKey('numbers', 0).map(([, l]) => l)).toEqual(['Team A', 'Team B', 'Keepers and spare players'])
    expect(practiceKey('targets', 1).map(([, l]) => l)).toEqual(['Team A', 'Team B', 'Keeper and target'])
    expect(practiceKey('direction', 0).map(([, l]) => l)).toEqual(['12 attackers', '2 defenders'])
    expect(practiceKey('direction', 1).map(([, l]) => l)).toEqual(['12 attackers', '2 defenders', 'End line'])
  })
})
