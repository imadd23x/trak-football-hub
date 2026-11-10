import { describe, expect, it } from 'vitest'
import { CANVAS, LIBRARY, START_LEVEL, bounds, cardView, counts, describePitch, fit, layout, type LibraryDrill } from '..'

/* TRAK-386 (Drill Library 2/11): the pitch picture's layout. Every player the numbers name is drawn, the picture
   follows the players and the level, and a card zooms onto the drill. */

const drill = (name: string) => LIBRARY.find(d => d.name === name) as LibraryDrill
const draw = (name: string, n: number, level = START_LEVEL) => layout(drill(name), fit(drill(name), n, level))
const sizeLine = (name: string, n: number, level = START_LEVEL) => draw(name, n, level).find(s => s.s === 'size')

describe('the picture draws the drill as fitted', () => {
  it('a rondo: the attackers round the edge and the defenders inside, in each grid', () => {
    expect(fit(drill('Keep the ball'), 12, START_LEVEL).details.numbers).toBe('12 players, 9v3')
    expect(counts(draw('Keep the ball', 12))).toEqual({ main: 9, other: 3, extra: 0, spare: 0 })
    // 15 players: two grids, 6v2 and 5v2
    expect(counts(draw('Keep the ball', 15))).toEqual({ main: 11, other: 4, extra: 0, spare: 0 })
    expect(draw('Keep the ball', 15).filter(s => s.s === 'area')).toHaveLength(2)
  })

  it('a game: two even teams, a spare player as a diamond, a keeper in yellow', () => {
    expect(counts(draw('Go wide first', 15))).toEqual({ main: 7, other: 7, extra: 0, spare: 1 })
    expect(counts(draw('Play out from the keeper', 15))).toEqual({ main: 7, other: 7, extra: 1, spare: 0 })
    expect(counts(draw('Press from the front', 16))).toEqual({ main: 7, other: 7, extra: 1, spare: 1 })
    expect(draw('Play out from the keeper', 15).some(s => s.s === 'target')).toBe(true)
  })

  it('attack in turns: the group that’s on, attackers against defenders', () => {
    expect(fit(drill('Overlap and finish'), 15, START_LEVEL).details.numbers).toBe('15 players, groups of 4v2 and a keeper')
    expect(counts(draw('Overlap and finish', 15))).toEqual({ main: 4, other: 2, extra: 0, spare: 0 })
    // A position practice: the even teams and the keeper; the rest rotate in.
    expect(fit(drill('Attack down the side'), 8, START_LEVEL).details.numbers).toBe('8 players, 3v3 and a keeper, 1 rotate in')
    expect(counts(draw('Attack down the side', 8))).toEqual({ main: 3, other: 3, extra: 1, spare: 0 })
  })

  it('pairs: every player, the odd one out with the last pair', () => {
    expect(counts(draw('First touch and turn', 14))).toEqual({ main: 14, other: 0, extra: 0, spare: 0 })
    expect(counts(draw('First touch and turn', 15))).toEqual({ main: 15, other: 0, extra: 0, spare: 0 })
  })

  it('shooting: a keeper at each goal, everyone else queuing', () => {
    expect(counts(draw('Shoot from the line', 12))).toEqual({ main: 12, other: 0, extra: 2, spare: 0 })
    expect(counts(draw('Shoot from the line', 8))).toEqual({ main: 8, other: 0, extra: 1, spare: 0 })
  })

  it('every drill draws every player, for any normal squad (drills in turns show the players who are on)', () => {
    for (const d of LIBRARY.filter(x => x.template !== 'func' && x.template !== 'funcm')) {
      for (const n of [8, 12, 15, 20]) {
        const c = counts(layout(d, fit(d, n, START_LEVEL)))
        const keepers = d.template === 'shoot' ? c.extra : 0
        expect(c.main + c.other + c.spare + (c.extra - keepers), `${d.name} ${n}`).toBe(n)
      }
    }
  })

  it('changes with the players and the level', () => {
    expect(draw('Keep the ball', 12)).not.toEqual(draw('Keep the ball', 13))
    expect(sizeLine('Keep the ball', 12, 3)).toMatchObject({ text: '13 m' })
    expect(sizeLine('Keep the ball', 12, 4)).toMatchObject({ text: '12 m' })
    expect(sizeLine('Go wide first', 15)).toMatchObject({ text: '45 x 30 m' })
    expect(sizeLine('First touch and turn', 14)).toMatchObject({ text: '10 m between partners' })
  })

  it('is the same every time for the same drill', () => {
    expect(draw('Go wide first', 15)).toEqual(draw('Go wide first', 15))
  })

  it('stays on the canvas', () => {
    for (const d of LIBRARY) {
      for (const n of [8, 20]) for (const level of [0, 7]) {
        const b = bounds(layout(d, fit(d, n, level)))!
        expect(b.x, d.name).toBeGreaterThanOrEqual(-12)
        expect(b.y, d.name).toBeGreaterThanOrEqual(-12)
        expect(b.x + b.w, d.name).toBeLessThanOrEqual(CANVAS.w + 12)
        expect(b.y + b.h, d.name).toBeLessThanOrEqual(CANVAS.h + 12)
      }
    }
  })
})

describe('a card zooms onto the drill', () => {
  it('keeps the canvas’s shape, at least 340 wide, around the drawing', () => {
    const shapes = draw('Pass and follow', 15)
    const v = cardView(shapes), b = bounds(shapes)!
    expect(v.w / v.h).toBeCloseTo(CANVAS.w / CANVAS.h)
    expect(v.w).toBeGreaterThanOrEqual(340)
    expect(v.x).toBeLessThanOrEqual(b.x)
    expect(v.x + v.w).toBeGreaterThanOrEqual(b.x + b.w)
    expect(v.y).toBeLessThanOrEqual(b.y)
    expect(v.y + v.h).toBeGreaterThanOrEqual(b.y + b.h)
  })

  it('a small square fills more of the card than the full picture', () => {
    expect(cardView(draw('Tag games', 8)).w).toBeLessThan(CANVAS.w)
  })

  it('an empty drawing keeps the whole canvas', () => {
    expect(cardView([])).toEqual({ x: 0, y: 0, ...CANVAS })
  })
})

it('a screen reader hears the set-up in one line', () => {
  expect(describePitch(drill('Keep the ball'), fit(drill('Keep the ball'), 12, START_LEVEL))).toBe(
    'Keep the ball set-up. Area shape and size: 13x13 m. Numbers: 12 players, 9v3. Targets: Keep the ball. Direction: Non-directional. Conditions: 2 touches.',
  )
})
