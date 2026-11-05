/* TRAK-285 (Games 3/8): the line-up as the coach builds it, before it's saved to game_plan_players. A slot holds one
   player and a player one slot. Someone who can come and isn't on the pitch is on the bench until the coach says
   otherwise (Imad, 28 Oct); a player left out keeps only their note. */

export type Role = 'starter' | 'bench' | 'not_selected'
export type Expectation = 'stretch' | 'usual' | 'lead'
export type PlayerPlan = { role: Role; slot: number | null; job: string; note: string; context: string[]; expectation: Expectation }
/** By squad row. Only the players the coach has set are here; everyone else reads as `playerPlan`'s default. */
export type PlayerPlans = Record<string, PlayerPlan>

/** What the coach takes into account; only the coach sees it. Never a diagnosis. */
export const CONTEXT = [
  { value: 'out_of_position', label: 'Out of position' },
  { value: 'first_start', label: 'First start' },
  { value: 'back_from_injury', label: 'Back from injury' },
  { value: 'young_for_age_group', label: 'Young for the age group' },
  { value: 'playing_up', label: 'Playing up an age group' },
]
/** The coach's plain labels, with the words the player reads once the evaluation is published (TRAK-282). */
export const EXPECTATIONS: { value: Expectation; label: string; description: string }[] = [
  { value: 'stretch', label: 'Stretch', description: 'A big ask today. A solid job is a good game.' },
  { value: 'usual', label: 'Usual', description: 'Your normal game.' },
  { value: 'lead', label: 'Lead', description: 'We needed you to take charge.' },
]
/** TRAK-370 (Imad, 5 Nov): an expectation's badge colour, as context's is orange: stretch orange, lead blue
 *  (arc-theme.css maps Arc's amber and sky to Trak's). Usual stays a plain badge. */
export const EXPECTATION_COLOR = { stretch: 'amber', usual: undefined, lead: 'sky' } as const satisfies Record<Expectation, 'amber' | 'sky' | undefined>
/** Database limits (20261028140000_game_plan_players.sql). */
export const PLAYER_LIMITS = { job: 300, note: 500 }

const BENCH: PlayerPlan = { role: 'bench', slot: null, job: '', note: '', context: [], expectation: 'usual' }

export const playerPlan = (plans: PlayerPlans, id: string): PlayerPlan => plans[id] ?? BENCH

/** Puts `id` in `slot`. Whoever held the slot moves to the slot `id` left, or to the bench. */
export function place(plans: PlayerPlans, id: string, slot: number): PlayerPlans {
  const from = playerPlan(plans, id).slot
  const next: PlayerPlans = { ...plans, [id]: { ...playerPlan(plans, id), role: 'starter', slot } }
  for (const [other, plan] of Object.entries(plans)) {
    if (other === id || plan.slot !== slot) continue
    next[other] = from == null ? { ...plan, role: 'bench', slot: null } : { ...plan, slot: from }
  }
  return next
}

export const takeOff = (plans: PlayerPlans, id: string): PlayerPlans =>
  ({ ...plans, [id]: { ...playerPlan(plans, id), role: 'bench', slot: null } })

/** Bench or not selected, for a player off the pitch. Left out, they keep only their note. */
export function setRole(plans: PlayerPlans, id: string, role: Exclude<Role, 'starter'>): PlayerPlans {
  const plan = playerPlan(plans, id)
  return { ...plans, [id]: role === 'bench' ? { ...plan, role, slot: null } : { ...BENCH, role, note: plan.note } }
}

/** A smaller format has fewer slots: starters beyond it go to the bench. */
export function fitFormat(plans: PlayerPlans, format: number): PlayerPlans {
  return Object.fromEntries(Object.entries(plans).map(([id, plan]) =>
    [id, plan.slot != null && plan.slot > format ? { ...plan, role: 'bench' as const, slot: null } : plan]))
}

export const startersWithJob = (plans: PlayerPlans, format: number) =>
  Object.values(plans).filter(plan => plan.role === 'starter' && plan.slot != null && plan.slot <= format && plan.job.trim()).length

/** One row per player the coach has set, for the players who can still be recorded (`eligible`). While that isn't
 *  known (null), every row goes and the database checks each one. */
export function rowsToSave(eventId: string, plans: PlayerPlans, eligible: Set<string> | null) {
  return Object.entries(plans).filter(([id]) => !eligible || eligible.has(id)).map(([id, plan]) => ({
    event_id: eventId, squad_player_id: id, role: plan.role, slot: plan.slot,
    job: plan.job.trim(), note: plan.note.trim(), context: plan.context, expectation: plan.expectation,
  }))
}
