import { describe, expect, it } from 'vitest'
import type { PlayerPlans } from '../lineup'
import { answerOf, evaluationToForm, formToSave, hasPlayed, lineUpAtKickOff, planAnswered, previewReview, publishSummary, setPlayed, summary, withScore } from '../evaluation'

// TRAK-288: the evaluation as the coach fills it, read against the plan as it locked at kick-off.
const plans: PlayerPlans = {
  zagorakis: { role: 'starter', slot: 4, job: 'Stay tight.', note: '', context: ['out_of_position'], expectation: 'stretch' },
  dellas: { role: 'starter', slot: 2, job: '', note: '', context: [], expectation: 'usual' },
  karagounis: { role: 'not_selected', slot: null, job: '', note: 'Next week.', context: [], expectation: 'usual' },
}
const eligible = ['zagorakis', 'dellas', 'karagounis', 'charisteas'].map(id => ({ id, name: id }))
const empty = { evaluation: null, players: [], notes: [] }

describe('lineUpAtKickOff', () => {
  it('lists the starters by slot, then everyone else who can be recorded and wasn\'t left out, as the bench', () => {
    const { starters, bench } = lineUpAtKickOff(plans, eligible)
    expect(starters.map(p => p.id)).toEqual(['dellas', 'zagorakis'])
    expect(bench.map(p => p.id)).toEqual(['charisteas'])
  })
})

describe('a new evaluation', () => {
  it('starts at 0–0, with the starters ticked, nobody from the bench, and everyone at Yes · Met', () => {
    const form = evaluationToForm(empty)
    expect(form).toMatchObject({ ourScore: 0, theirScore: 0, goals: [], howTheyScored: '', planWorked: [] })
    expect(hasPlayed(form, 'zagorakis', true)).toBe(true)
    expect(hasPlayed(form, 'charisteas', false)).toBe(false)
    expect(answerOf(form, 'zagorakis')).toEqual({ didJob: 'yes', against: 'met', note: '' })
    expect(summary(answerOf(form, 'zagorakis'))).toBe('Did the job · Met')
  })
})

describe('the score', () => {
  it('gives each of our goals a row, and lowering it drops the last ones', () => {
    let form = withScore(evaluationToForm(empty), 2)
    expect(form.goals).toEqual([{ scorer: null, assist: null }, { scorer: null, assist: null }])
    form = { ...form, goals: [{ scorer: 'zagorakis', assist: null }, { scorer: 'dellas', assist: 'zagorakis' }] }
    expect(withScore(form, 1).goals).toEqual([{ scorer: 'zagorakis', assist: null }])
  })
})

describe('who played', () => {
  it('unticking a player takes them off any goal they scored or assisted', () => {
    const form = { ...withScore(evaluationToForm(empty), 2), goals: [{ scorer: 'zagorakis', assist: 'dellas' }, { scorer: 'dellas', assist: 'zagorakis' }] }
    const next = setPlayed(form, 'zagorakis', false)
    expect(next.goals).toEqual([{ scorer: null, assist: 'dellas' }, { scorer: 'dellas', assist: null }])
    expect(hasPlayed(next, 'zagorakis', true)).toBe(false)
  })
})

describe('a saved draft', () => {
  const saved = {
    evaluation: { our_score: 2, their_score: 1, goals: [{ scorer: 'zagorakis', assist: null }], how_they_scored: 'A corner.', plan_worked: ['worked', null], saved_at: '2026-10-28T21:40:00Z' },
    players: [
      { squad_player_id: 'zagorakis', played: true, did_job: 'partly', against_expectation: 'above' },
      { squad_player_id: 'dellas', played: false, did_job: 'yes', against_expectation: 'met' },
      { squad_player_id: 'charisteas', played: true, did_job: 'yes', against_expectation: 'met' },
    ],
    notes: [{ squad_player_id: 'zagorakis', note: 'Brave all game.' }],
  }

  it('reloads as it was saved: the score, a row per goal, who played and each answer', () => {
    const form = evaluationToForm(saved)
    expect(form.goals).toEqual([{ scorer: 'zagorakis', assist: null }, { scorer: null, assist: null }])
    expect(form.planWorked).toEqual(['worked', null])
    expect(hasPlayed(form, 'dellas', true)).toBe(false)
    expect(hasPlayed(form, 'charisteas', false)).toBe(true)
    expect(answerOf(form, 'zagorakis')).toEqual({ didJob: 'partly', against: 'above', note: 'Brave all game.' })
  })

  it('saves every player listed, with answers and a note only for those who played, and only scorers who played', () => {
    const form = { ...evaluationToForm(saved), goals: [{ scorer: 'zagorakis', assist: 'dellas' }, { scorer: null, assist: null }] }
    const listed = [{ id: 'dellas', starter: true }, { id: 'zagorakis', starter: true }, { id: 'charisteas', starter: false }]
    expect(formToSave('g1', form, listed)).toEqual({
      p_event_id: 'g1', p_our_score: 2, p_their_score: 1, p_how_they_scored: 'A corner.', p_plan_worked: ['worked', null],
      p_goals: [{ scorer: 'zagorakis', assist: null }, { scorer: null, assist: null }],
      p_players: [
        { id: 'dellas', played: false },
        { id: 'zagorakis', played: true, did_job: 'partly', against_expectation: 'above', note: 'Brave all game.' },
        { id: 'charisteas', played: true, did_job: 'yes', against_expectation: 'met', note: '' },
      ],
    })
  })
})

describe('publishing (TRAK-289)', () => {
  const listed = [{ id: 'dellas', starter: true }, { id: 'zagorakis', starter: true }, { id: 'charisteas', starter: false }]
  const form = {
    ...withScore(evaluationToForm(empty), 2),
    played: { charisteas: true },
    answers: { zagorakis: { didJob: 'partly' as const, against: 'above' as const, note: 'Brave all game.' }, dellas: { didJob: 'yes' as const, against: 'met' as const, note: 'Good.' } },
  }

  it('sums it up: who played, how many changed from Yes · Met, and how many notes', () => {
    expect(publishSummary(form, listed)).toEqual({ players: 3, changed: 1, notes: 2 })
    expect(publishSummary(setPlayed(form, 'zagorakis', false), listed)).toEqual({ players: 2, changed: 0, notes: 1 })
  })

  it('waits for an answer to "Did the plan work?" for every goal', () => {
    expect(planAnswered({ ...form, planWorked: [] }, 0)).toBe(true)
    expect(planAnswered({ ...form, planWorked: ['worked'] }, 2)).toBe(false)
    expect(planAnswered({ ...form, planWorked: ['worked', null] }, 2)).toBe(false)
    expect(planAnswered({ ...form, planWorked: ['worked', 'didnt'] }, 2)).toBe(true)
  })

  it('previews what a player and a parent will read, from the draft and the plan as it locked', () => {
    expect(previewReview({ ...form, theirScore: 1 }, 'zagorakis', plans, 'Otto Rehhagel', 'player')).toEqual({
      eventId: '', sessionId: null, ourScore: 2, theirScore: 1, job: 'Stay tight.', didJob: 'partly', expectation: 'stretch',
      context: ['out_of_position'], against: 'above', hasNote: true, coachName: 'Otto Rehhagel', note: 'Brave all game.',
    })
    expect(previewReview(form, 'zagorakis', plans, null, 'parent')).toMatchObject({ hasNote: true, note: null, coachName: null })
    expect(previewReview(form, 'charisteas', plans, null, 'player')).toMatchObject({ job: '', expectation: 'usual', context: [], didJob: 'yes', against: 'met', hasNote: false })
  })
})
