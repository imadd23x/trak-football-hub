import { describe, it, expect } from 'vitest'
import { teamGoalsViolation } from '../match-input-rules'

// TRAK-66 (use-case test, 25 Sep): a 1–0 win saved with two scorers.
describe('teamGoalsViolation: our players cannot outscore the team', () => {
  it.each([
    [[1, 1], 1, '2 goals entered, but the team scored 1'],
    [[2, 1], 2, '3 goals entered, but the team scored 2'],
  ])('refuses goals %j when the team scored %i', (goals, teamScore, message) => {
    expect(teamGoalsViolation(goals, teamScore)).toBe(message)
  })

  it.each([
    [[1, 1], 2],   // exactly the score
    [[1], 2],      // fewer: an own goal or an unrostered scorer
    [[], 0],       // nobody scored
    [[0, 0], 0],
  ])('allows goals %j when the team scored %i', (goals, teamScore) => {
    expect(teamGoalsViolation(goals, teamScore)).toBeNull()
  })

  it('does not judge before the score is entered', () => {
    expect(teamGoalsViolation([3], undefined)).toBeNull()
  })
})
