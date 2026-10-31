import type { Json } from '@/integrations/supabase/types'
import { localParts } from '@/lib/event-time'
import { formToPlan, type Goal, type PlanForm } from './plan'
import { playerPlan, type Role } from './lineup'

/* TRAK-286 (Games 4/8): what players and families read once the plan is shared. The database writes two copies per
   child: the family's (the role) and the player's (the goals, their job and, when they're left out, the coach's note).
   TRAK-319 (Imad, 30 Oct): the job is the player's alone (20261030200000_games_job_player_only.sql). The Share step's
   preview builds the same from what the coach has typed, by the same rules. */

/** One child's shared plan: the role from the family's copy, and the player's (`player`, with their job), which is null
 *  for a guardian, who never reads the goals, the job or the note. */
export type SharedPlan = { role: Role; player: { goals: Goal[]; job: string; note: string } | null; updated: boolean }

/** Who reads the plan once it's shared: everyone who can come, and a starter who can't (their slot is flagged until
 *  the coach moves them), as trak_private.game_copies decides. */
export function readers<T extends { id: string; absent: boolean }>(form: PlanForm, players: T[]): T[] {
  return players.filter(player => !player.absent || playerPlan(form.players, player.id).role === 'starter')
}

/** What `id`, or their family, would read if the coach shared what's typed now: the Share step's preview. */
export function previewOf(form: PlanForm, id: string, as: 'player' | 'parent'): SharedPlan {
  const plan = playerPlan(form.players, id)
  // One box per player (TRAK-319): a selected player's job, or a left-out player's note.
  const left = plan.role === 'not_selected'
  return {
    role: plan.role, updated: false,
    player: as === 'parent' ? null : { goals: formToPlan(form).goals.map(goal => ({ title: goal.title, looksLike: goal.looks_like })),
      job: left ? '' : plan.job.trim(), note: left ? plan.note.trim() : '' },
  }
}

/** The starters in the format's slots, among players who can still be recorded, and how many have a job. */
export function lineUpCounts(form: PlanForm, players: { id: string }[]) {
  const starters = players.map(player => playerPlan(form.players, player.id))
    .filter(plan => plan.role === 'starter' && plan.slot != null && plan.slot <= form.format)
  return { placed: starters.length, withJob: starters.filter(plan => plan.job.trim()).length }
}

type FamilyRow = { role: string; changed_at: string | null }
type PlayerRow = { goals: Json; job: string; note: string; changed_at: string | null }

/** A child's copies as the database returns them. Updated: a later share changed either. */
export function sharedPlan(family: FamilyRow, player: PlayerRow | null): SharedPlan {
  const goals = (Array.isArray(player?.goals) ? player.goals : []) as { title: string; looks_like: string }[]
  return {
    role: family.role as Role,
    player: player && { goals: goals.map(goal => ({ title: goal.title, looksLike: goal.looks_like })), job: player.job, note: player.note },
    updated: family.changed_at != null || player?.changed_at != null,
  }
}

/** TRAK-290: a scheduled share's moment as the academy's day and time ("2026-10-29", "19:30"), for the Share at…
 *  form, which is on the academy's clock as every form is. The academy's offset is read from the match's own wall
 *  clock and instant, as academyClock does; a match with no time yet leaves the phone's clock. */
export function shareWall(game: { event_date?: string | null; start_time?: string | null; starts_at: string }, at: string) {
  const offset = game.event_date && game.start_time
    ? Date.parse(`${game.event_date}T${game.start_time.slice(0, 5)}:00Z`) - Date.parse(game.starts_at) : null
  if (offset === null) { const { date, time } = localParts(at); return { day: date, time } }
  const wall = new Date(Date.parse(at) + offset).toISOString()
  return { day: wall.slice(0, 10), time: wall.slice(11, 16) }
}
