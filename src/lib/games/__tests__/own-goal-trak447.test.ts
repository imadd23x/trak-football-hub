import { describe, expect, it } from 'vitest'
import { formToSave, evaluationToForm, summary, type EvaluationForm } from '@/lib/games/evaluation'
import { reviewOf, words } from '@/lib/games/reviews'

/**
 * TRAK-447: a goal in the match evaluation can be an own goal. It credits nobody (no scorer, no assist), the score still
 * adds up, and it comes back from a saved draft as an own goal, not as a goal whose scorer was not recorded. A player the
 * plan gave no job has no "Did the job" in the summary.
 */
const listed = [{ id: 'pat', starter: true }, { id: 'sam', starter: true }]
const form = (goals: EvaluationForm['goals']): EvaluationForm =>
  ({ ourScore: goals.length, theirScore: 0, goals, howTheyScored: '', planWorked: [], played: {}, answers: {} })

describe('TRAK-447: own goals', () => {
  it('saves an own goal with nobody credited, beside a goal with a scorer', () => {
    const saved = formToSave('g1', form([{ scorer: null, assist: null, own: true }, { scorer: 'pat', assist: 'sam' }]), listed)
    expect(saved.p_goals).toEqual([{ scorer: null, assist: null, own: true }, { scorer: 'pat', assist: 'sam' }])
  })

  it('credits nobody even if a scorer or assist was picked before it was made an own goal', () => {
    const saved = formToSave('g1', form([{ scorer: 'pat', assist: 'sam', own: true }]), listed)
    expect(saved.p_goals).toEqual([{ scorer: null, assist: null, own: true }])
  })

  it('a goal that is not an own goal carries no flag', () => {
    const saved = formToSave('g1', form([{ scorer: 'pat', assist: null, own: false }]), listed)
    expect(saved.p_goals).toEqual([{ scorer: 'pat', assist: null }])
  })

  it('comes back from a saved draft as an own goal', () => {
    const back = evaluationToForm({ evaluation: { our_score: 2, their_score: 0, goals: [{ scorer: null, assist: null, own: true }, { scorer: null, assist: null }],
      how_they_scored: '', plan_worked: [] }, players: [], notes: [] })
    expect(back.goals.map(goal => !!goal.own)).toEqual([true, false])
  })

  it('a player with no job reads only how they did against what was asked', () => {
    const answer = { didJob: 'yes' as const, against: 'met' as const, note: '' }
    expect(summary(answer, true)).toBe('Did the job · Met')
    expect(summary(answer, false)).toBe('Met')
  })

  it('a published review for a player with no job has no "did the job" line', () => {
    const family = { event_id: 'g1', session_id: null, our_score: 2, their_score: 1, expectation: 'usual', context: [], against_expectation: 'met', coach_name: 'Otto' }
    const jobless = reviewOf(family, { job: '  ', did_job: 'yes', note: '' })
    expect(jobless.didJob).toBeNull()
    expect(words(jobless).didJob).toBeNull()
    expect(words(reviewOf(family, { job: 'Stay tight.', did_job: 'yes', note: '' })).didJob).toBe('You did your job')
  })
})
