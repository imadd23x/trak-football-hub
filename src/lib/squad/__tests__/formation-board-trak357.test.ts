/**
 * TRAK-357 (Season plan 9/18): the rules behind Formations' pitch and bench. A first eleven picked by position; a new
 * shape keeps players in their line; a swap by drag, tap or keyboard never puts a player in twice; the ring says
 * whether a player is in their position, one they can also play, out of position, or has none recorded.
 */
import { describe, expect, it } from 'vitest'
import { FORMATION_SEEDS, firstXI, fitOf, reshapeXI, slotPosition, swapXI, type Spot } from '@/lib/squad/formation-board'

const p = (id: string, position: string | null, also: string[] = []) => ({ id, position, also })
const squad = [
  p('gk1', 'Goalkeeper'), p('gk2', 'Goalkeeper'),
  p('d1', 'Defender'), p('d2', 'Defender'), p('d3', 'Defender'), p('d4', 'Defender'), p('d5', 'Defender'),
  p('m1', 'Midfielder'), p('m2', 'Midfielder'), p('m3', 'Midfielder'),
  p('a1', 'Attacker'), p('a2', 'Attacker'), p('a3', 'Attacker'),
]
const slot = (n: number): Spot => `slot:${n}`
const bench = (id: string): Spot => `bench:${id}`
const unique = (xi: Record<number, string>) => new Set(Object.values(xi)).size === Object.values(xi).length

describe('TRAK-357 formation board', () => {
  it("names each place's line, with Matches' front line as an attacker", () => {
    expect([1, 2, 5, 6, 8, 9, 11].map(n => slotPosition('4-3-3', n))).toEqual(['Goalkeeper', 'Defender', 'Defender', 'Midfielder', 'Midfielder', 'Attacker', 'Attacker'])
    expect(slotPosition('4-2-3-1', 9)).toBe('Midfielder')
  })

  it('picks a first eleven by position, then fills any gap, never anyone twice', () => {
    const xi = firstXI(squad, '4-3-3')
    expect(Object.keys(xi)).toHaveLength(11)
    expect(xi[1]).toBe('gk1')
    expect([2, 3, 4, 5].map(n => xi[n])).toEqual(['d1', 'd2', 'd3', 'd4'])
    expect([9, 10, 11].map(n => xi[n])).toEqual(['a1', 'a2', 'a3'])
    expect(unique(xi)).toBe(true)
    // 5-4-1 wants five defenders and four midfielders; the fourth midfielder comes from whoever is left.
    const bus = firstXI(squad, '5-4-1')
    expect([2, 3, 4, 5, 6].map(n => bus[n])).toEqual(['d1', 'd2', 'd3', 'd4', 'd5'])
    expect(unique(bus) && Object.keys(bus).length === 11).toBe(true)
    // A small squad leaves places empty rather than inventing anyone.
    expect(Object.keys(firstXI(squad.slice(0, 6), '4-4-2'))).toHaveLength(6)
  })

  it('a new shape keeps players in their line, and sends the rest of a smaller format to the bench', () => {
    const xi = firstXI(squad, '4-4-2')
    const back3 = reshapeXI(xi, '4-4-2', '3-5-2')
    expect(back3[1]).toBe('gk1')
    expect(Object.keys(back3)).toHaveLength(11)
    expect(unique(back3)).toBe(true)
    const seven = reshapeXI(xi, '4-4-2', '2-3-1', 7)
    expect(Object.keys(seven)).toHaveLength(7)
    expect(seven[1]).toBe('gk1')
    expect(unique(seven)).toBe(true)
  })

  it('swaps by drag, tap or keyboard keep everyone once', () => {
    const xi = { 1: 'gk1', 2: 'd1', 3: 'd2' }
    expect(swapXI(xi, slot(2), slot(3))).toEqual({ 1: 'gk1', 2: 'd2', 3: 'd1' })
    expect(swapXI(xi, bench('m1'), slot(2))).toEqual({ 1: 'gk1', 2: 'm1', 3: 'd2' })
    expect(swapXI(xi, slot(3), bench('m1'))).toEqual({ 1: 'gk1', 2: 'd1', 3: 'm1' })
    expect(swapXI(xi, slot(2), slot(4))).toEqual({ 1: 'gk1', 3: 'd2', 4: 'd1' })
    expect(swapXI(xi, bench('m1'), bench('m2'))).toEqual(xi)
    // A bench player already starting elsewhere moves, never doubles.
    expect(swapXI(xi, bench('d2'), slot(2))).toEqual({ 1: 'gk1', 2: 'd2', 3: 'd1' })
  })

  it('rings: in position, can also play, out of position, or none recorded', () => {
    expect(fitOf(p('x', 'Defender', ['Midfielder']), 'Defender')).toBe('listed')
    expect(fitOf(p('x', 'Defender', ['Midfielder']), 'Midfielder')).toBe('also')
    expect(fitOf(p('x', 'Defender', ['Midfielder']), 'Attacker')).toBe('out')
    expect(fitOf(p('x', null), 'Attacker')).toBe('unknown')
  })

  it("seeds the mockup's three, eleven a side", () => {
    expect(FORMATION_SEEDS).toEqual([
      { name: 'Attacking tactic', format: 11, shape: '3-4-3' },
      { name: 'Park the bus', format: 11, shape: '5-4-1' },
      { name: 'Balanced', format: 11, shape: '4-3-3' },
    ])
  })
})
