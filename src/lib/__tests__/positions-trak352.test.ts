/**
 * TRAK-352 (Season plan 4/18): who the Positions step lists and how they group, and what Home's Needs you counts.
 * Children waiting for consent are counted, never listed. Anything but the four positions is "no position yet":
 * nobody gets a midfielder default. Synthetic names.
 */
import { describe, expect, it } from 'vitest'
import { isPosition, positionsBoard, unplacedBySquad } from '@/lib/positions'

const player = (id: string, name: string, position: string | null, age_group = 'U16') => ({ id, player_name: name, position, age_group })

describe('TRAK-352 positions', () => {
  it('lists every consented player once: unplaced first, the rest by line, in name order', () => {
    const board = positionsBoard([
      player('a', 'Synthetic Zed', 'Defender'), player('b', 'Synthetic Amy', null), player('c', 'Synthetic Bo', 'Goalkeeper'),
      player('d', 'Synthetic Cy', 'Defender'), player('e', 'Synthetic Di', 'Attacker'),
    ], new Set())
    expect(board.unplaced.map(p => p.player_name)).toEqual(['Synthetic Amy'])
    expect(board.lines.map(l => [l.short, l.players.map(p => p.player_name)])).toEqual([
      ['GK', ['Synthetic Bo']], ['DEF', ['Synthetic Cy', 'Synthetic Zed']], ['MID', []], ['ATT', ['Synthetic Di']],
    ])
    expect([board.placed, board.total]).toEqual([4, 5])
  })

  it('counts children waiting for consent without listing them', () => {
    const board = positionsBoard([player('a', 'Synthetic Amy', null), player('b', 'Synthetic Bo', 'Defender'), player('c', 'Synthetic Cy', null)], new Set(['a', 'b']))
    expect(board.waiting).toBe(2)
    expect(board.total).toBe(1)
    expect(board.unplaced.map(p => p.id)).toEqual(['c'])
    expect(board.lines.flatMap(l => l.players)).toEqual([])
  })

  it('gives nobody a midfielder default: a blank or unknown position is unplaced', () => {
    const board = positionsBoard([player('a', 'Synthetic Amy', ''), player('b', 'Synthetic Bo', 'CM'), player('c', 'Synthetic Cy', 'midfielder')], new Set())
    expect(board.unplaced).toHaveLength(3)
    expect(board.lines.find(l => l.value === 'Midfielder')!.players).toEqual([])
    expect(['Goalkeeper', 'Defender', 'Midfielder', 'Attacker'].every(isPosition)).toBe(true)
    expect([null, undefined, '', 'CM', 'midfielder'].some(isPosition)).toBe(false)
  })

  it('tells Needs you how many consented players each squad still has to place', () => {
    expect(unplacedBySquad([
      player('a', 'Synthetic Amy', null, 'U16'), player('b', 'Synthetic Bo', null, 'U16'), player('c', 'Synthetic Cy', null, 'U14'),
      player('d', 'Synthetic Di', 'Defender', 'U14'), player('e', 'Synthetic Ed', null, 'U16'),
    ], new Set(['e']))).toEqual([{ squad: 'U14', count: 1 }, { squad: 'U16', count: 2 }])
    expect(unplacedBySquad([player('a', 'Synthetic Amy', 'Attacker')], new Set())).toEqual([])
  })
})
