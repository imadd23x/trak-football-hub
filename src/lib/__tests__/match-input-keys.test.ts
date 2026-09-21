import { describe, it, expect } from 'vitest'
import { computeMatchScore } from '../rating-engine'
import { goalsKey, assistsKey } from '../match-input-keys'
import type { MatchInput, Position } from '../types'

const POSITIONS: Position[] = ['gk', 'def', 'mid', 'att']

function score(position: Position, inputs: Record<string, string>): number {
  return computeMatchScore({
    position,
    competition: 'League',
    venue: 'Home',
    opponent: 'Opponent FC',
    score_us: 1,
    score_them: 0,
    minutes_played: 90,
    card: null,
    body_condition: 'fresh',
    self_rating: 'good',
    position_inputs: { pressing: 'medium', tempo: 'yes', ...inputs },
    is_friendly: false,
  } as unknown as MatchInput)
}

describe('goal credit reaches the engine', () => {
  it('an attacker scoring twice is worth more than one scoring once', () => {
    // The defect: goalsKey returned '2+' for everyone, the attacker branch has
    // no '2+' case, so a brace fell through to zero credit — 7.20, identical
    // to not scoring, while a single goal scored 7.55.
    const one = score('att', { goals: goalsKey('att', 1) })
    const two = score('att', { goals: goalsKey('att', 2) })
    expect(two).toBeGreaterThan(one)
  })

  it('a hat-trick is worth more than a brace', () => {
    expect(score('att', { goals: goalsKey('att', 3) }))
      .toBeGreaterThan(score('att', { goals: goalsKey('att', 2) }))
  })

  it('a midfielder scoring twice is worth more than one scoring once', () => {
    expect(score('mid', { goals: goalsKey('mid', 2) }))
      .toBeGreaterThan(score('mid', { goals: goalsKey('mid', 1) }))
  })
})

/**
 * The contract, and the reason this file exists.
 *
 * Asserting the corrected values would only prove today's numbers. What has to
 * hold is the property: scoring more never scores less, whatever the engine's
 * scales are renamed to. If someone adds a position, changes a key, or widens
 * the form again, this fails rather than silently paying zero for a brace —
 * which is exactly how the original bug survived.
 */
describe('CONTRACT: more is never worth less, for every position', () => {
  const RECORDABLE = [0, 1, 2, 3, 4, 5, 6]

  for (const position of POSITIONS) {
    it(`${position}: goal credit never decreases as goals rise`, () => {
      const scores = RECORDABLE.map(n => score(position, { goals: goalsKey(position, n) }))
      for (let i = 1; i < scores.length; i++) {
        expect(
          scores[i],
          `${position}: ${RECORDABLE[i]} goals (key ${goalsKey(position, RECORDABLE[i])}) ` +
          `scored ${scores[i]}, below ${RECORDABLE[i - 1]} goals at ${scores[i - 1]}`,
        ).toBeGreaterThanOrEqual(scores[i - 1])
      }
    })

    it(`${position}: assist credit never decreases as assists rise`, () => {
      const scores = RECORDABLE.map(n => score(position, { assists: assistsKey(n) }))
      for (let i = 1; i < scores.length; i++) {
        expect(scores[i]).toBeGreaterThanOrEqual(scores[i - 1])
      }
    })
  }

  it('every key the mapping can emit is one the engine actually pays for', () => {
    // A key the engine does not recognise scores identically to zero. That is
    // the failure mode by definition, so it is asserted directly rather than
    // inferred from a total.
    for (const position of POSITIONS) {
      const zero = score(position, { goals: goalsKey(position, 0) })
      for (const n of [1, 2, 3, 6]) {
        const key = goalsKey(position, n)
        const paid = score(position, { goals: key })
        if (position === 'gk' || position === 'def') continue // these do not read goals
        expect(paid, `${position} key ${key} pays nothing`).toBeGreaterThan(zero)
      }
    }
  })
})
