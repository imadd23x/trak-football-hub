import { describe, it, expect } from 'vitest'
import { dedupeMatches, type DedupableMatch } from '../match-dedupe'

function makeMatch(overrides: Partial<DedupableMatch> = {}): DedupableMatch {
  return {
    id: 'match-1',
    opponent: 'Olympiacos',
    team_score: 1,
    opponent_score: 0,
    competition: 'League',
    match_date: '2026-03-01',
    created_at: '2026-03-01T10:00:00Z',
    computed_rating: 7.0,
    ...overrides,
  }
}

describe('dedupeMatches', () => {
  it('keeps two real matches against the same opponent with the same scoreline', () => {
    const matches = [
      makeMatch({ id: 'a', match_date: '2026-03-01' }),
      makeMatch({ id: 'b', match_date: '2026-03-15' }),
    ]
    const result = dedupeMatches(matches)
    expect(result).toHaveLength(2)
    expect(result.map((m) => m.id).sort()).toEqual(['a', 'b'])
  })

  it('collapses the same match logged twice on the same date', () => {
    const matches = [
      makeMatch({ id: 'a', computed_rating: 6.0 }),
      makeMatch({ id: 'b', computed_rating: 7.5 }),
    ]
    const result = dedupeMatches(matches)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('b')
  })

  it('treats different competitions on the same date as different matches', () => {
    const result = dedupeMatches([
      makeMatch({ id: 'a', competition: 'League' }),
      makeMatch({ id: 'b', competition: 'Cup' }),
    ])
    expect(result).toHaveLength(2)
  })

  it('never drops rows that have no match_date, since they cannot be proven duplicates', () => {
    const result = dedupeMatches([
      makeMatch({ id: 'a', match_date: null }),
      makeMatch({ id: 'b', match_date: null }),
    ])
    expect(result).toHaveLength(2)
  })

  it('sorts newest match first by match_date', () => {
    const result = dedupeMatches([
      makeMatch({ id: 'old', match_date: '2026-01-05' }),
      makeMatch({ id: 'new', match_date: '2026-04-20' }),
      makeMatch({ id: 'mid', match_date: '2026-02-10' }),
    ])
    expect(result.map((m) => m.id)).toEqual(['new', 'mid', 'old'])
  })

  it('returns an empty array for no data', () => {
    expect(dedupeMatches([])).toEqual([])
    expect(dedupeMatches(null)).toEqual([])
  })
})
