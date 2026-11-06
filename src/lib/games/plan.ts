import type { Tables } from '@/integrations/supabase/types'
import type { Format } from './formations'
import type { Expectation, PlayerPlans, Role } from './lineup'

/* TRAK-284 (Games 2/8): the plan's first step as the coach types it and as the database keeps it (game_plans). Only the
   coach ever reads it. TRAK-285: the second step adds the format, the formation and the line-up (game_plan_players).
   TRAK-328 (Imad, 2 Nov): the step is Tactics & analysis and the goals read "Instructions" on every screen (the data
   keeps `goals`). Their line-up left the step: the form neither reads nor writes their_formation or key_players, so
   what an earlier plan saved there stays as it was. */

export type Strength = 'weaker' | 'similar' | 'stronger'
/** TRAK-363: an instruction picked from the season plan carries its season objective, whatever the words become. */
export type Goal = { title: string; looksLike: string; seasonObjectiveId?: string | null }
export type PlanForm = {
  strength: Strength | null; scouting: string; goals: Goal[]
  format: Format; formation: string | null; players: PlayerPlans
}
type SavedPlan = Pick<Tables<'game_plans'>, 'strength' | 'scouting' | 'goals' | 'format' | 'formation'>
type SavedPlayer = Pick<Tables<'game_plan_players'>, 'squad_player_id' | 'role' | 'slot' | 'job' | 'note' | 'context' | 'expectation'>

export const MAX_GOALS = 3
/** The database's limits (20261028100000_game_plans.sql), so typing never runs past them. */
export const LIMITS = { scouting: 2000, title: 80, looksLike: 300 }

export const STRENGTHS: { value: Strength; label: string; description: string }[] = [
  { value: 'weaker', label: 'Weaker', description: 'Below our level. We expect to have the ball.' },
  { value: 'similar', label: 'Similar', description: 'Our level. It could go either way.' },
  { value: 'stronger', label: 'Stronger', description: 'Above our level. We expect to defend more.' },
]

export const emptyGoal = (): Goal => ({ title: '', looksLike: '' })

/** A saved plan as the form shows it. No plan yet is an empty form, with no instruction until the coach adds one
 *  (TRAK-328), 11 a side. */
export function planToForm(row: SavedPlan | null, saved: SavedPlayer[] = []): PlanForm {
  const goals = (Array.isArray(row?.goals) ? row.goals : []) as { title: string; looks_like: string; season_objective_id?: string | null }[]
  return {
    strength: (row?.strength ?? null) as Strength | null,
    scouting: row?.scouting ?? '',
    goals: goals.map(g => ({ title: g.title, looksLike: g.looks_like, ...(g.season_objective_id ? { seasonObjectiveId: g.season_objective_id } : {}) })),
    format: (row?.format ?? 11) as Format,
    formation: row?.formation ?? null,
    players: Object.fromEntries(saved.map(p => [p.squad_player_id, {
      role: p.role as Role, slot: p.slot, job: p.job, note: p.note, context: p.context, expectation: p.expectation as Expectation,
    }])),
  }
}

/** What Save draft writes to game_plans: instructions left empty are dropped and text is trimmed. The line-up goes to
 *  game_plan_players (`rowsToSave`). */
export function formToPlan(form: PlanForm) {
  return {
    strength: form.strength,
    scouting: form.scouting.trim(),
    goals: form.goals.map(g => ({ title: g.title.trim(), looks_like: g.looksLike.trim(), ...(g.seasonObjectiveId ? { season_objective_id: g.seasonObjectiveId } : {}) }))
      .filter(g => g.title || g.looks_like),
    format: form.format,
    formation: form.formation,
  }
}
