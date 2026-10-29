import { describe, it, expect } from 'vitest'
import { calculateRecords } from '../records'

function makeMatch(overrides: Record<string, unknown> = {}) {
  return {
    id: overrides.id as string ?? 'match-1',
    computed_rating: (overrides.computed_rating as number) ?? 7.0,
    created_at: (overrides.created_at as string) ?? '2025-03-01T10:00:00Z',
    goals: (overrides.goals as number) ?? 0,
    assists: (overrides.assists as number) ?? 0,
    opponent: (overrides.opponent as string) ?? 'Test FC',
  }
}

describe('calculateRecords', () => {
  it('returns all null/zero for empty matches array', () => {
    const result = calculateRecords([])
    expect(result.highestRating).toBeNull()
    expect(result.mostGoalsInMatch).toBeNull()
    expect(result.longestGoodStreak).toBe(0)
    expect(result.totalMatches).toBe(0)
    expect(result.totalGoals).toBe(0)
    expect(result.totalAssists).toBe(0)
    expect(result.firstMatchDate).toBeNull()
  })

  it('handles a single match correctly', () => {
    const matches = [makeMatch({ id: 'm1', computed_rating: 8.0, goals: 2, assists: 1 })]
    const result = calculateRecords(matches)

    expect(result.highestRating).toEqual({ value: 8.0, matchId: 'm1', date: '2025-03-01T10:00:00Z' })
    expect(result.mostGoalsInMatch).toEqual({ value: 2, matchId: 'm1', date: '2025-03-01T10:00:00Z' })
    expect(result.longestGoodStreak).toBe(1) // 8.0 >= 7.2
    expect(result.totalMatches).toBe(1)
    expect(result.totalGoals).toBe(2)
    expect(result.totalAssists).toBe(1)
    expect(result.firstMatchDate).toBe('2025-03-01T10:00:00Z')
  })

  it('finds highest rating across multiple matches', () => {
    const matches = [
      makeMatch({ id: 'm1', computed_rating: 6.5, created_at: '2025-03-01T10:00:00Z' }),
      makeMatch({ id: 'm2', computed_rating: 9.1, created_at: '2025-03-02T10:00:00Z' }),
      makeMatch({ id: 'm3', computed_rating: 7.8, created_at: '2025-03-03T10:00:00Z' }),
    ]
    const result = calculateRecords(matches)
    expect(result.highestRating).toEqual({ value: 9.1, matchId: 'm2', date: '2025-03-02T10:00:00Z' })
  })

  it('finds most goals in a match', () => {
    const matches = [
      makeMatch({ id: 'm1', goals: 1, created_at: '2025-03-01T10:00:00Z' }),
      makeMatch({ id: 'm2', goals: 3, created_at: '2025-03-02T10:00:00Z' }),
      makeMatch({ id: 'm3', goals: 2, created_at: '2025-03-03T10:00:00Z' }),
    ]
    const result = calculateRecords(matches)
    expect(result.mostGoalsInMatch).toEqual({ value: 3, matchId: 'm2', date: '2025-03-02T10:00:00Z' })
  })

  it('calculates longest good streak correctly', () => {
    const matches = [
      makeMatch({ id: 'm1', computed_rating: 7.5, created_at: '2025-03-01T10:00:00Z' }),
      makeMatch({ id: 'm2', computed_rating: 8.0, created_at: '2025-03-02T10:00:00Z' }),
      makeMatch({ id: 'm3', computed_rating: 6.0, created_at: '2025-03-03T10:00:00Z' }), // breaks streak
      makeMatch({ id: 'm4', computed_rating: 7.2, created_at: '2025-03-04T10:00:00Z' }),
      makeMatch({ id: 'm5', computed_rating: 7.9, created_at: '2025-03-05T10:00:00Z' }),
      makeMatch({ id: 'm6', computed_rating: 9.0, created_at: '2025-03-06T10:00:00Z' }),
    ]
    const result = calculateRecords(matches)
    expect(result.longestGoodStreak).toBe(3) // m4, m5, m6
  })

  it('returns 0 streak when no match is in Good+ band', () => {
    const matches = [
      makeMatch({ id: 'm1', computed_rating: 5.0, created_at: '2025-03-01T10:00:00Z' }),
      makeMatch({ id: 'm2', computed_rating: 6.0, created_at: '2025-03-02T10:00:00Z' }),
    ]
    const result = calculateRecords(matches)
    expect(result.longestGoodStreak).toBe(0)
  })

  it('accumulates total goals and assists', () => {
    const matches = [
      makeMatch({ goals: 2, assists: 1, created_at: '2025-03-01T10:00:00Z' }),
      makeMatch({ goals: 0, assists: 0, created_at: '2025-03-02T10:00:00Z' }),
      makeMatch({ goals: 1, assists: 3, created_at: '2025-03-03T10:00:00Z' }),
    ]
    const result = calculateRecords(matches)
    expect(result.totalGoals).toBe(3)
    expect(result.totalAssists).toBe(4)
  })

  it('finds earliest match as firstMatchDate', () => {
    const matches = [
      makeMatch({ created_at: '2025-06-15T10:00:00Z' }),
      makeMatch({ created_at: '2025-01-10T10:00:00Z' }),
      makeMatch({ created_at: '2025-04-20T10:00:00Z' }),
    ]
    const result = calculateRecords(matches)
    expect(result.firstMatchDate).toBe('2025-01-10T10:00:00Z')
  })

  it('handles null computed_rating gracefully', () => {
    const matches = [
      makeMatch({ id: 'm1', computed_rating: null, goals: 1, created_at: '2025-03-01T10:00:00Z' }),
      makeMatch({ id: 'm2', computed_rating: 7.5, goals: 0, created_at: '2025-03-02T10:00:00Z' }),
    ]
    const result = calculateRecords(matches)
    expect(result.highestRating).toEqual({ value: 7.5, matchId: 'm2', date: '2025-03-02T10:00:00Z' })
    expect(result.mostGoalsInMatch).toEqual({ value: 1, matchId: 'm1', date: '2025-03-01T10:00:00Z' })
  })

  it('handles null goals and assists gracefully', () => {
    const matches = [
      makeMatch({ goals: null, assists: null, created_at: '2025-03-01T10:00:00Z' }),
    ]
    const result = calculateRecords(matches)
    expect(result.totalGoals).toBe(0)
    expect(result.totalAssists).toBe(0)
    expect(result.mostGoalsInMatch).toBeNull()
  })

  it('returns mostGoalsInMatch as null when all matches have 0 goals', () => {
    const matches = [
      makeMatch({ goals: 0, created_at: '2025-03-01T10:00:00Z' }),
      makeMatch({ goals: 0, created_at: '2025-03-02T10:00:00Z' }),
    ]
    const result = calculateRecords(matches)
    expect(result.mostGoalsInMatch).toBeNull()
  })

  it('correctly counts streak at boundary (exactly 7.2)', () => {
    const matches = [
      makeMatch({ computed_rating: 7.2, created_at: '2025-03-01T10:00:00Z' }),
      makeMatch({ computed_rating: 7.2, created_at: '2025-03-02T10:00:00Z' }),
      makeMatch({ computed_rating: 7.19, created_at: '2025-03-03T10:00:00Z' }),
    ]
    const result = calculateRecords(matches)
    expect(result.longestGoodStreak).toBe(2)
  })

  // TRAK-289: a Games match has no rating (Imad, 28 Oct).
  it('a match with no rating counts its goals and neither extends nor breaks a streak', () => {
    const matches = [
      makeMatch({ id: 'm1', computed_rating: 7.5, created_at: '2025-03-01T10:00:00Z' }),
      { ...makeMatch({ id: 'games', goals: 1, created_at: '2025-03-08T10:00:00Z' }), computed_rating: null },
      makeMatch({ id: 'm3', computed_rating: 7.8, created_at: '2025-03-15T10:00:00Z' }),
    ]
    const result = calculateRecords(matches)
    expect(result.longestGoodStreak).toBe(2)
    expect(result.highestRating?.matchId).toBe('m3')
    expect(result.totalGoals).toBe(1)
    expect(result.totalMatches).toBe(3)
  })
})
