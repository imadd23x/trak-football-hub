import { describe, expect, it } from 'vitest'
import { SHELF, PART_TYPES } from '../../shelf'
import { setupFor } from '../../turnout'
import {
  KINDS, LEVELS, LIBRARY, anotherDrill, PLAYERS_TODAY, START_LEVEL, WARM_UP, alsoCalled, fit, foundAs, libraryDrill, nextLevel,
  norm, partFor, playersFor, refit, ruleAt, searchDrills, slips, step,
} from '..'

/* TRAK-385 (Drill Library 1/11): the Library's engine. Fitting, Easier / Harder, Players today and smart search. */

const drill = (name: string) => {
  const d = LIBRARY.find(x => x.name === name)
  if (!d) throw new Error(`no drill called ${name}`)
  return d
}
const squad = { players: 15, level: START_LEVEL }
const names = (q: string, s = squad) => searchDrills(q, s).map(d => d.name)

describe('the drills', () => {
  it('every id is new: starts with lib-, is unique, and never matches an old shelf id', () => {
    const ids = LIBRARY.map(d => d.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.every(id => /^lib-[a-z0-9-]+$/.test(id))).toBe(true)
    for (const old of SHELF) expect(libraryDrill(old.id)).toBeUndefined()
    expect(libraryDrill(null)).toBeUndefined()
    expect(libraryDrill('lib-keep-the-ball')?.name).toBe('Keep the ball')
  })

  it('every drill has a kind, one of its kind’s drill types, and something to say', () => {
    for (const d of LIBRARY) {
      const types: readonly string[] = d.kind === 'warmup' ? WARM_UP.types : KINDS.find(k => k.key === d.kind)!.types
      expect(types, d.name).toContain(d.type)
      expect(d.why.length, d.name).toBeGreaterThan(0)
      expect(d.how.length, d.name).toBeGreaterThan(0)
      expect(d.watch.length, d.name).toBeGreaterThan(0)
      if (Array.isArray(d.rule)) expect(d.rule, d.name).toHaveLength(LEVELS)
    }
  })

  it('every drill fits one of the session’s parts', () => {
    const parts = PART_TYPES.map(p => p.key) as string[]
    for (const d of LIBRARY) expect(parts).toContain(partFor(d))
    expect(partFor(drill('Moving warm-up'))).toBe('warmup')
    expect(partFor(drill('Pass and follow'))).toBe('passing')
    expect(partFor(drill('Keep the ball'))).toBe('rondo')
    expect(partFor(drill('Pass then score'))).toBe('game')
    expect(partFor(drill('Attack down the side'))).toBe('functional')
    expect(partFor(drill('Press from the front'))).toBe('functional')
  })

  it('Who’s here can still set every drill up for a normal squad', () => {
    for (const d of LIBRARY) {
      for (let n = PLAYERS_TODAY.min; n <= PLAYERS_TODAY.max; n++) expect(setupFor(playersFor(d), n).ok, `${d.name} ${n}`).toBe(true)
    }
  })
})

describe('fitting a drill to the squad', () => {
  it('starts at the standard level, 4 of 8', () => {
    expect(LEVELS).toBe(8)
    expect(START_LEVEL).toBe(3)
  })

  it('a rondo: one square for a small squad, two grids from 14', () => {
    expect(fit(drill('Keep the ball'), 12, START_LEVEL).details).toEqual({
      area: '13x13 m', numbers: '12 players, 9v3', targets: 'Keep the ball', direction: 'Non-directional', conditions: '2 touches',
    })
    expect(fit(drill('Keep the ball'), 15, START_LEVEL).details.numbers).toBe('15 players, 6v2 and 5v2')
    expect(fit(drill('Keep the ball'), 16, START_LEVEL).details).toMatchObject({ area: '11x11 m each', numbers: '16 players, 6v2 in each grid' })
  })

  it('a game: even teams, the odd player spare, a rule from the drill', () => {
    expect(fit(drill('Go wide first'), 15, START_LEVEL).details).toEqual({
      area: '45x30 m', numbers: '15 players, 7v7 + 1 spare', targets: 'Two goals', direction: 'Directional. Attack one end',
      conditions: 'Any touches. One pass into a wide lane before a shot',
    })
  })

  it('a rule can change by level', () => {
    expect(ruleAt(drill('Pass then score'), 0)).toBe('3 passes before a shot')
    expect(ruleAt(drill('Pass then score'), 7)).toBe('6 passes before a shot')
    expect(ruleAt(drill('Moving warm-up'), 7)).toBe('Running, change direction')
    expect(ruleAt(drill('Keep the ball'), 3)).toBe('')
  })

  it('pairs with an odd player out make a group of 3', () => {
    expect(fit(drill('First touch and turn'), 15, START_LEVEL).details).toMatchObject({ area: '10 m between partners', numbers: '6 pairs and a group of 3', conditions: '2 touches, either foot' })
  })

  it('keepers get serves, not shots', () => {
    expect(fit(drill('Get set and catch'), 12, START_LEVEL).details).toMatchObject({ area: '12 m from goal', numbers: '12 players, two goals', conditions: 'Served low' })
    expect(fit(drill('Get set and catch'), 12, START_LEVEL).legend[0]).toEqual(['main', 'Servers'])
  })

  it('a level outside 0–7 is held at the ends', () => {
    expect(fit(drill('Keep the ball'), 12, -3).details).toEqual(fit(drill('Keep the ball'), 12, 0).details)
    expect(fit(drill('Keep the ball'), 12, 99).details).toEqual(fit(drill('Keep the ball'), 12, 7).details)
  })
})

describe('Easier and Harder', () => {
  it('goes to the next level that changes something, and says what and why', () => {
    expect(step(drill('Keep the ball'), 12, START_LEVEL, 1)).toEqual({
      level: 4,
      changes: [
        { key: 'area', name: 'Area shape and size', from: '13x13 m', to: '12x12 m', why: 'Less room means less time on the ball.' },
        { key: 'numbers', name: 'Numbers', from: '12 players, 9v3', to: '12 players, 8v4', why: 'Fewer spare players means passes are harder to find.' },
      ],
    })
    expect(step(drill('Keep the ball'), 12, START_LEVEL, -1)).toEqual({
      level: 2,
      changes: [{ key: 'conditions', name: 'Conditions', from: '2 touches', to: '3 touches', why: 'A looser rule gives players more time.' }],
    })
  })

  it('skips levels that look the same: a warm-up only changes pace', () => {
    // Levels 2, 3 and 4 are all "Jogging", so Easier from 3 goes to 1 (walking) and Harder to 5 (running).
    expect(nextLevel(drill('Moving warm-up'), 15, 3, -1)).toBe(1)
    expect(nextLevel(drill('Moving warm-up'), 15, 3, 1)).toBe(5)
    expect(step(drill('Moving warm-up'), 15, 3, 1)!.changes).toEqual([
      { key: 'conditions', name: 'Conditions', from: 'Jogging', to: 'Running', why: 'A faster pace asks for more control.' },
    ])
  })

  it('stops at the ends', () => {
    expect(step(drill('Keep the ball'), 12, 0, -1)).toBeNull()
    expect(step(drill('Keep the ball'), 12, 7, 1)).toBeNull()
  })

  it('every drill can go easier or harder from the standard level', () => {
    for (const d of LIBRARY) {
      const easier = nextLevel(d, 15, START_LEVEL, -1), harder = nextLevel(d, 15, START_LEVEL, 1)
      expect(easier !== null || harder !== null, d.name).toBe(true)
    }
  })
})

describe('Players today', () => {
  it('refits the set-up without saying easier or harder', () => {
    expect(refit(drill('Keep the ball'), 15, 12, START_LEVEL)).toEqual([
      { key: 'area', name: 'Area shape and size', from: '11x11 m each', to: '13x13 m', why: '' },
      { key: 'numbers', name: 'Numbers', from: '15 players, 6v2 and 5v2', to: '12 players, 9v3', why: '' },
    ])
  })

  it('nothing changes when the drill doesn’t depend on numbers', () => {
    expect(refit(drill('Pass and follow'), 15, 15, START_LEVEL)).toEqual([])
    expect(refit(drill('Moving warm-up'), 15, 12, START_LEVEL).map(c => c.key)).toEqual(['numbers'])
  })
})

describe('smart search', () => {
  it('finds drills by name, drill type and kind', () => {
    expect(names('keep the ball')[0]).toBe('Keep the ball')
    // Every rondo first (its drill type), then Win it and get out's drills (a "double rondo", another name for its type).
    expect(names('rondos')).toEqual(['Rondos', 'Win it and get out'].flatMap(t => LIBRARY.filter(d => d.type === t).map(d => d.name)))
    expect(searchDrills('technical', squad).every(d => d.kind === 'technical')).toBe(true)
  })

  it('finds a drill type by the other names coaches use, and says which', () => {
    const found = searchDrills('piggy in the middle', squad)
    expect(found.length).toBeGreaterThan(0)
    expect(found.every(d => d.type === 'Rondos')).toBe(true)
    expect(foundAs(found[0], 'piggy in the middle', squad)).toBe('Also called piggy in the middle')
    expect(names('phase of play')).toEqual(['Play out from the keeper', 'Press from the front'])
    expect(foundAs(drill('Keep the ball'), 'keep the ball', squad)).toBe('')
    expect(alsoCalled(drill('Keep the ball'))).toEqual(['piggy in the middle', 'keep ball', 'toro'])
  })

  it('a name beats another name, which beats a topic, which beats the rest', () => {
    // "Pressing movement" is a drill type (name), "pressing cones" another name; topic hits come after.
    const found = names('pressing')
    expect(found.slice(0, 2)).toEqual(['Shift with the ball', 'Step up together'])
    expect(found).toContain('Press as a group')
  })

  it('"4 v 4", "4vs4" and "4 on 4" are the same search', () => {
    expect(norm('4 v 4')).toBe('4v4')
    expect(norm('4vs4')).toBe('4v4')
    expect(norm('4 on 4')).toBe('4v4')
    expect(names('4 v 4')).toEqual(names('4v4'))
    expect(names('4 v 4').length).toBeGreaterThan(0)
  })

  it('finds the numbers the coach would see for their squad', () => {
    expect(names('9v3', { players: 12, level: START_LEVEL })).toContain('Keep the ball')
    expect(names('9v3', { players: 16, level: START_LEVEL })).not.toContain('Keep the ball')
  })

  it('allows one spelling slip in a word of 5 or more letters, two in 10 or more; the first letter must match', () => {
    expect(slips('posession', 'possession')).toBe(1)
    expect(names('posession')).toEqual(names('possession'))
    expect(names('scrimage')).toContain('Go wide first')
    expect(names('pasing')).toEqual(names('passing'))
    expect(names('rondp')).toEqual(names('rondo'))
    expect(names('posesion')).toEqual([]) // two slips in a short word
    expect(names('intersepton')).toEqual(names('intercept')) // two slips in a long word
    expect(names('interseptonn')).toEqual([]) // three
    expect(names('pondos')).toEqual([]) // first letter wrong
  })

  it('an empty search lists every drill in Library order; nonsense finds nothing', () => {
    const all = names('')
    expect(all).toHaveLength(LIBRARY.length)
    expect(all.slice(0, 3)).toEqual(['Moving warm-up', 'Tag games', 'Speed circuit'])
    expect(names('zzzz')).toEqual([])
  })

  it('can be narrowed to part of the Library', () => {
    expect(searchDrills('', squad, d => d.kind === 'skill').every(d => d.kind === 'skill')).toBe(true)
    expect(searchDrills('pressing', squad, d => d.kind === 'game').map(d => d.name)).toEqual(['Push them wide', 'Press from the front'])
  })
})

describe('Another drill', () => {
  it('the next of the same type, round to the first; the same kind when the type has only one', () => {
    const rondos = LIBRARY.filter(d => d.type === 'Rondos')
    expect(anotherDrill(rondos[0])?.id).toBe(rondos[1].id)
    expect(anotherDrill(rondos.at(-1)!)?.id).toBe(rondos[0].id)
    const alone = drill('Win it, pass it out') // the only "Win it and get out"
    const next = anotherDrill(alone)!
    expect(next.kind).toBe('skill')
    expect(next.id).not.toBe(alone.id)
  })
})

/* TRAK-388 (Drill Library 10/11): the real library, from the pick list Kostas marked on 9 Nov. */
describe('the real library', () => {
  const byName = (name: string) => LIBRARY.find(d => d.name === name)!

  it('keeps every sample’s id but the two Kostas dropped, which stay findable for saved plans and are never listed', () => {
    // 10 Nov read-through: three more merged into another drill.
    for (const id of ['lib-copy-your-partner', 'lib-follow-and-copy', 'lib-steal-the-ball', 'lib-win-it-back-in-five', 'lib-cross-and-attack-the-box']) {
      expect(libraryDrill(id)?.id).toBe(id)
      expect(LIBRARY.some(d => d.id === id)).toBe(false)
      expect(searchDrills('', { players: 12, level: START_LEVEL }).some(d => d.id === id)).toBe(false)
    }
    expect(LIBRARY).toHaveLength(54)
    expect(LIBRARY.every(d => d.id.startsWith('lib-'))).toBe(true)
  })

  it('Cool-down sits in Get ready and fills Plan session’s Cool-down part', () => {
    const cool = LIBRARY.filter(d => d.type === 'Cool-down')
    expect(cool.map(d => d.name)).toEqual(['Easy jog and stretch', 'Walk, pass and talk'])
    expect(cool.every(d => d.kind === 'warmup' && partFor(d) === 'cooldown')).toBe(true)
  })

  it('long passes and a keeper’s distribution are 20 to 40 m apart', () => {
    expect(fit(byName('Long pass and control'), 12, 0).details.area).toBe('20 m between partners')
    expect(fit(byName('Throw and roll out'), 12, 7).details.area).toBe('40 m between partners')
    expect(fit(byName('Throw and roll out'), 12, 7).details.conditions).toBe('Pass to whoever the coach calls')
  })

  it('a ball each with no partner; 1 v 1 at every level; a keeper drill with its own rule', () => {
    const gates = fit(byName('Dribble through the gates'), 13, START_LEVEL).details
    expect(gates.numbers).toBe('13 players, a ball each')
    expect(gates.targets).toBe('Cone gates around the area')
    for (const lvl of [0, 7]) expect(fit(byName('1 v 1 to goal'), 14, lvl).details.numbers).toBe('14 players, groups of 1v1 and a keeper')
    expect(fit(byName('Sweep behind the line'), 8, 0).details.conditions).toBe('Ball rolled through, no attacker')
  })
})

/* 10 Nov read-through (Kostas: "make sure they make football sense"). */
describe('the numbers make football sense', () => {
  const byName = (name: string) => LIBRARY.find(d => d.name === name)!

  it('1 v 1 plays on a 1 v 1 sized pitch, smaller as it gets harder', () => {
    expect(fit(byName('1 v 1 to goal'), 14, START_LEVEL).details.area).toBe('20x15 m')
    expect(fit(byName('1 v 1 to goal'), 14, 0).details.area).toBe('30x20 m')
    expect(fit(byName('1 v 1 to goal'), 14, 7).details.area).toBe('15x15 m')
    // Drills with the usual numbers keep their area.
    expect(fit(byName('Overlap and finish'), 14, START_LEVEL).details.area).toBe('35x30 m')
  })

  it('a three-team game has room to play inside the area', () => {
    expect(fit(byName('Three-team keep ball'), 14, START_LEVEL).details.area).toBe('23x23 m')
    expect(fit(byName('Keep the ball'), 14, START_LEVEL).details.area).toBe('10x10 m each')
  })

  it('a position practice never leaves more than three waiting', () => {
    for (const n of [8, 12, 14, 17, 20]) for (let lvl = 0; lvl < 8; lvl++) {
      const numbers = fit(byName('Attack down the side'), n, lvl).details.numbers
      const waiting = Number(/(\d+) rotate in/.exec(numbers)?.[1] ?? 0)
      expect(waiting, `${n} players, level ${lvl}: ${numbers}`).toBeLessThanOrEqual(3)
    }
  })

  it('merged drills carry both ideas', () => {
    expect(ruleAt(byName('Protect your ball'), 0)).toBe('Defenders knock balls out')
    expect(ruleAt(byName('Protect your ball'), 7)).toBe('Defenders win a ball and keep it')
    expect(ruleAt(byName('Win it, pass it out'), 3)).toMatch(/five seconds to win it back/)
    expect(byName('Overlap and finish').how.join(' ')).toMatch(/near post, the far post/)
    expect(byName('Shoot early').focus).toBe('team')
  })
})
