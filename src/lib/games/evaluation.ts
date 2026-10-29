import type { Tables } from '@/integrations/supabase/types'
import { playerPlan, type PlayerPlans } from './lineup'
import type { Review } from './reviews'

/* TRAK-288 (Games 6/8): the evaluation after full time, as the coach fills it and as save_game_evaluation keeps it
   (20261029100000_game_evaluations.sql). A draft only the coach reads, against the plan as it locked at kick-off.
   Publishing is TRAK-289. */

export type DidJob = 'yes' | 'partly' | 'not_yet'
export type Against = 'below' | 'met' | 'above'
export type PlanWorked = 'didnt' | 'partly' | 'worked'
export type Answer = { didJob: DidJob; against: Against; note: string }
/** One of our goals: who scored and who assisted, by squad row; null when not recorded (an own goal, a guest). */
export type ScoredGoal = { scorer: string | null; assist: string | null }
export type EvaluationForm = {
  ourScore: number; theirScore: number; goals: ScoredGoal[]; howTheyScored: string
  /** Did the plan work, for each of the plan's goals in order; null until answered. */
  planWorked: (PlanWorked | null)[]
  /** By squad row, once the coach ticks or unticks them; until then a starter played and the bench didn't. */
  played: Record<string, boolean>
  answers: Record<string, Answer>
}

export const DID_JOB: { value: DidJob; label: string; summary: string }[] = [
  { value: 'yes', label: 'Yes', summary: 'Did the job' },
  { value: 'partly', label: 'Partly', summary: 'Did part of the job' },
  { value: 'not_yet', label: 'Not yet', summary: 'Not yet' },
]
export const AGAINST: { value: Against; label: string }[] = [
  { value: 'below', label: 'Below' }, { value: 'met', label: 'Met' }, { value: 'above', label: 'Above' },
]
export const PLAN_WORKED: { value: PlanWorked; label: string }[] = [
  { value: 'didnt', label: 'Didn’t' }, { value: 'partly', label: 'Partly' }, { value: 'worked', label: 'Worked' },
]
/** The database's limits. */
export const EVALUATION_LIMITS = { score: 99, howTheyScored: 2000, note: 500 }

const MET: Answer = { didJob: 'yes', against: 'met', note: '' }
export const answerOf = (form: EvaluationForm, id: string): Answer => form.answers[id] ?? MET
export const hasPlayed = (form: EvaluationForm, id: string, starter: boolean) => form.played[id] ?? starter
export const summary = (answer: Answer) =>
  `${DID_JOB.find(d => d.value === answer.didJob)!.summary} · ${AGAINST.find(a => a.value === answer.against)!.label}`

/** Who the evaluation lists: the starters by slot, then everyone else who can be recorded and wasn't left out. */
export function lineUpAtKickOff<P extends { id: string }>(plans: PlayerPlans, eligible: P[]) {
  const starters = eligible.filter(p => playerPlan(plans, p.id).role === 'starter')
    .sort((a, b) => (playerPlan(plans, a.id).slot ?? 0) - (playerPlan(plans, b.id).slot ?? 0))
  return { starters, bench: eligible.filter(p => playerPlan(plans, p.id).role === 'bench') }
}

type Saved = {
  evaluation: Pick<Tables<'game_evaluations'>, 'our_score' | 'their_score' | 'goals' | 'how_they_scored' | 'plan_worked'> | null
  players: Pick<Tables<'game_evaluation_players'>, 'squad_player_id' | 'played' | 'did_job' | 'against_expectation'>[]
  notes: Pick<Tables<'game_evaluation_notes'>, 'squad_player_id' | 'note'>[]
}

/** A saved draft as the form shows it. Nothing saved yet: 0–0, and everyone at their default. */
export function evaluationToForm({ evaluation, players, notes }: Saved): EvaluationForm {
  const scored = (Array.isArray(evaluation?.goals) ? evaluation.goals : []) as ScoredGoal[]
  const note = new Map(notes.map(n => [n.squad_player_id, n.note]))
  return {
    ...withScore({ ourScore: 0, goals: scored } as EvaluationForm, evaluation?.our_score ?? 0),
    theirScore: evaluation?.their_score ?? 0,
    howTheyScored: evaluation?.how_they_scored ?? '',
    planWorked: (evaluation?.plan_worked ?? []) as (PlanWorked | null)[],
    played: Object.fromEntries(players.map(p => [p.squad_player_id, p.played])),
    answers: Object.fromEntries(players.filter(p => p.played).map(p => [p.squad_player_id,
      { didJob: p.did_job as DidJob, against: p.against_expectation as Against, note: note.get(p.squad_player_id) ?? '' }])),
  }
}

/** One row per goal we scored: a lower score drops the last ones. */
export const withScore = (form: EvaluationForm, ourScore: number): EvaluationForm =>
  ({ ...form, ourScore, goals: Array.from({ length: ourScore }, (_, i) => form.goals[i] ?? { scorer: null, assist: null }) })

/** Someone who didn't play scored nothing and assisted nothing. */
export function setPlayed(form: EvaluationForm, id: string, played: boolean): EvaluationForm {
  const goals = played ? form.goals
    : form.goals.map(goal => ({ scorer: goal.scorer === id ? null : goal.scorer, assist: goal.assist === id ? null : goal.assist }))
  return { ...form, played: { ...form.played, [id]: played }, goals }
}

/** What save_game_evaluation takes: every player listed; answers and a note only for those who played. */
export function formToSave(eventId: string, form: EvaluationForm, listed: { id: string; starter: boolean }[]) {
  const played = new Set(listed.filter(p => hasPlayed(form, p.id, p.starter)).map(p => p.id))
  const who = (id: string | null) => (id && played.has(id) ? id : null)
  return {
    p_event_id: eventId, p_our_score: form.ourScore, p_their_score: form.theirScore,
    p_goals: form.goals.map(goal => ({ scorer: who(goal.scorer), assist: who(goal.assist) })),
    p_how_they_scored: form.howTheyScored.trim(), p_plan_worked: form.planWorked,
    p_players: listed.map(({ id }) => {
      if (!played.has(id)) return { id, played: false }
      const answer = answerOf(form, id)
      return { id, played: true, did_job: answer.didJob, against_expectation: answer.against, note: answer.note.trim() }
    }),
  }
}

/** TRAK-289: the Publish step's line: who played, how many changed from Yes · Met, and how many notes. */
export function publishSummary(form: EvaluationForm, listed: { id: string; starter: boolean }[]) {
  const played = listed.filter(p => hasPlayed(form, p.id, p.starter)).map(p => answerOf(form, p.id))
  return {
    players: played.length,
    changed: played.filter(a => a.didJob !== 'yes' || a.against !== 'met').length,
    notes: played.filter(a => a.note.trim()).length,
  }
}

/** Publishing waits for an answer to "Did the plan work?" for each of the plan's goals. */
export const planAnswered = (form: EvaluationForm, goals: number) =>
  form.planWorked.length >= goals && form.planWorked.slice(0, goals).every(answer => answer != null)

/** What a player or their parent will read once it's published, from the draft and the plan as it locked. */
export function previewReview(form: EvaluationForm, id: string, plans: PlayerPlans, coachName: string | null, as: 'player' | 'parent'): Review {
  const plan = playerPlan(plans, id)
  const answer = answerOf(form, id)
  const note = answer.note.trim()
  return {
    eventId: '', sessionId: null, ourScore: form.ourScore, theirScore: form.theirScore, job: plan.job,
    didJob: answer.didJob, expectation: plan.expectation, context: plan.context, against: answer.against,
    hasNote: !!note, coachName, note: as === 'player' && note ? note : null,
  }
}
