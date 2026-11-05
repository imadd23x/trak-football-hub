/**
 * TRAK-354 (Season plan 6/18): the rules behind player objectives. Six for each position, those supporting the
 * squad's season objectives first; up to two at once, a third refused; the coach's own, never a library one twice.
 */
import { describe, expect, it } from 'vitest'
import { PLAYER_OBJECTIVE_LIBRARY, addOwnObjective, libraryFor, togglePlayerObjective, type ObjectivePick } from '@/lib/player-objectives'

const plan = [{ id: 'so-press', title: 'Win it back within 5 seconds' }, { id: 'so-compact', title: 'Stay compact' }]
const lib = (title: string, seasonObjectiveId: string | null = null): ObjectivePick => ({ title, source: 'library', seasonObjectiveId })

describe('TRAK-354 player objectives', () => {
  it("keeps the mockup's six for each position, each tied to the season objective it supports", () => {
    expect(PLAYER_OBJECTIVE_LIBRARY.Defender.map(o => o.title)).toEqual(['Steps in to win it the moment we lose it', 'Breaks a line with a pass into midfield',
      'Overlaps when the winger comes inside', 'Holds the line together', 'Wins their headers', 'Defends 1v1 on the outside'])
    expect(Object.values(PLAYER_OBJECTIVE_LIBRARY).every(list => list.length === 6)).toBe(true)
  })

  it("lists those supporting the squad's season objectives first, and says which", () => {
    const list = libraryFor('Defender', plan)
    expect(list.slice(0, 2)).toEqual([
      { title: 'Steps in to win it the moment we lose it', seasonObjectiveId: 'so-press', supports: 'Win it back within 5 seconds' },
      { title: 'Holds the line together', seasonObjectiveId: 'so-compact', supports: 'Stay compact' },
    ])
    expect(list.slice(2).every(o => o.supports === null && o.seasonObjectiveId === null)).toBe(true)
    expect(list).toHaveLength(6)
    // With no season objectives, nothing supports anything and the mockup's order stands.
    expect(libraryFor('Defender', []).map(o => o.title)).toEqual(PLAYER_OBJECTIVE_LIBRARY.Defender.map(o => o.title))
  })

  it('takes up to two and refuses a third; ticking one again unticks it', () => {
    const one = togglePlayerObjective([], lib('Holds the line together'))
    const two = togglePlayerObjective(one.picked, lib('Wins their headers'))
    expect(two).toEqual({ picked: [lib('Holds the line together'), lib('Wins their headers')], refused: false })
    expect(togglePlayerObjective(two.picked, lib('Defends 1v1 on the outside'))).toEqual({ picked: two.picked, refused: true })
    expect(togglePlayerObjective(two.picked, lib('Wins their headers'))).toEqual({ picked: [lib('Holds the line together')], refused: false })
  })

  it("adds the coach's own, or the library one when it's written the same way", () => {
    const library = libraryFor('Defender', plan)
    expect(addOwnObjective([], '  Talks to the keeper   at corners ', library)).toEqual({
      picked: [{ title: 'Talks to the keeper at corners', source: 'own', seasonObjectiveId: null }], refused: false })
    expect(addOwnObjective([], 'holds the line together', library)).toEqual({ picked: [lib('Holds the line together', 'so-compact')], refused: false })
    expect(addOwnObjective([lib('A'), lib('B')], 'Wins their headers', library).refused).toBe(true)
    expect(addOwnObjective([], '   ', library)).toEqual({ picked: [], refused: false })
  })
})
