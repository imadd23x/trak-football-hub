import { describe, expect, it } from 'vitest'
import { scorers } from '../scorers'

// TRAK-321: the season's scorers and assists from the coach's published evaluations, per squad in view.
const names = new Map([['saka', 'Bukayo Saka'], ['odegaard', 'Martin Odegaard'], ['rice', 'Declan Rice'], ['white', 'Ben White']])

describe('scorers (TRAK-321)', () => {
  it('counts goals, assists and matches played; sorts by goals, then assists, then fewer matches, then name', () => {
    const rows = scorers([
      { goals: [{ scorer: 'saka', assist: 'odegaard' }, { scorer: 'saka', assist: null }, { scorer: 'rice', assist: 'saka' }],
        played: ['saka', 'odegaard', 'rice', 'white'] },
      { goals: [{ scorer: 'odegaard', assist: 'saka' }], played: ['saka', 'odegaard'] },
      { goals: [], played: ['rice', 'white'] },
    ], names)
    expect(rows).toEqual([
      { id: 'saka', name: 'Bukayo Saka', goals: 2, assists: 2, played: 2 },
      { id: 'odegaard', name: 'Martin Odegaard', goals: 1, assists: 1, played: 2 },
      { id: 'rice', name: 'Declan Rice', goals: 1, assists: 0, played: 2 },
    ])
  })

  it('leaves out who never scored or assisted, and a scorer no longer on the roster', () => {
    expect(scorers([{ goals: [{ scorer: 'gone', assist: 'white' }], played: ['white'] }], names))
      .toEqual([{ id: 'white', name: 'Ben White', goals: 0, assists: 1, played: 1 }])
  })
})
