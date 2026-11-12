import { i18n } from '@/lib/i18n'
/* TRAK-285 (Games 3/8): the line-up as the coach builds it, before it's saved to game_plan_players. A slot holds one
   player and a player one slot. Someone who can come and isn't on the pitch is on the bench until the coach says
   otherwise (Imad, 28 Oct); a player left out keeps only their note. TRAK-359 (spec TRAK-348): and one who isn't
   coming is Not attending, which carries nothing at all; a family's "Can't make it" puts the child there. */

export type Role = 'starter' | 'bench' | 'not_selected' | 'not_attending'
export type Expectation = 'stretch' | 'usual' | 'lead'
export type PlayerPlan = {
  role: Role; slot: number | null; job: string; note: string; context: string[]; expectation: Expectation
  /** TRAK-358: who ticked Out of position. True: Trak, when the player was placed outside their positions; false: the
   *  coach, in the sheet. Unset as saved: it's never written, so a saved tick on a player out of position reads as
   *  Trak's. */
  outOfPositionByTrak?: boolean
}
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

/** Bench, not selected or not attending, for a player off the pitch. Left out, they keep only their note; not attending,
 *  nothing. */
export function setRole(plans: PlayerPlans, id: string, role: Exclude<Role, 'starter'>): PlayerPlans {
  const plan = playerPlan(plans, id)
  return { ...plans, [id]: role === 'bench' ? { ...plan, role, slot: null }
    : { ...BENCH, role, note: role === 'not_selected' ? plan.note : '' } }
}

/** TRAK-359: a child whose family said "Can't make it" starts in Not attending, where the coach hasn't placed them
 *  (they have no row). A coach's own row for them stays as it is: a report that comes later only flags them. */
export function withReported(plans: PlayerPlans, players: { id: string; absent: boolean }[]): PlayerPlans {
  const missing = players.filter(player => player.absent && !plans[player.id])
  return missing.length === 0 ? plans : { ...plans, ...Object.fromEntries(missing.map(player => [player.id, { ...BENCH, role: 'not_attending' as const }])) }
}

/** A smaller format has fewer slots: starters beyond it go to the bench. */
export function fitFormat(plans: PlayerPlans, format: number): PlayerPlans {
  return Object.fromEntries(Object.entries(plans).map(([id, plan]) =>
    [id, plan.slot != null && plan.slot > format ? { ...plan, role: 'bench' as const, slot: null } : plan]))
}

/* TRAK-358 (Season plan 10/18, spec TRAK-348): the line-up on Formations' pitch, with Bench and Not selected as tabs
   beside it. A drag ends on a place, on a face off the pitch, or on a list (its tab or its panel). */

export type LineUpDrop = { kind: 'slot'; slot: number } | { kind: 'player'; id: string } | { kind: 'list'; role: Exclude<Role, 'starter'> }

/** A drag of `id`. Onto a place: they start there (`place`). Onto a starter: the two swap places, or, from off the
 *  pitch, the starter goes to the bench. Onto a bench player: a starter swaps with them, as Formations' bench does;
 *  from off the pitch it's the bench. Onto a Not selected player, or a list: that list. Nothing else changes. */
export function moveTo(plans: PlayerPlans, id: string, to: LineUpDrop): PlayerPlans {
  const plan = playerPlan(plans, id)
  if (to.kind === 'slot') return plan.role === 'starter' && plan.slot === to.slot ? plans : place(plans, id, to.slot)
  if (to.kind === 'list') return plan.role === to.role ? plans : setRole(plans, id, to.role)
  if (to.id === id) return plans
  const other = playerPlan(plans, to.id)
  if (other.role === 'starter' && other.slot != null) return place(plans, id, other.slot)
  if (other.role === 'bench' && plan.role === 'starter' && plan.slot != null) return place(plans, to.id, plan.slot)
  return moveTo(plans, id, { kind: 'list', role: other.role === 'starter' ? 'bench' : other.role })
}

const OUT_OF_POSITION = 'out_of_position'
type Stands = (id: string, plan: PlayerPlan) => boolean

/** Out of position follows the pitch. Placed outside their position and Can also play, a player gets it ticked, by
 *  Trak; moved back, or off the pitch, Trak's tick goes. The coach's own tick stays. `wasOut` and `isOut` say whether
 *  a plan stands outside the player's positions, before and after (a new shape moves the lines). */
export function followPosition(before: PlayerPlans, after: PlayerPlans, wasOut: Stands, isOut: Stands): PlayerPlans {
  const next = { ...after }
  for (const [id, plan] of Object.entries(after)) {
    const was = wasOut(id, playerPlan(before, id)), now = isOut(id, plan)
    if (was === now) continue
    const ticked = plan.context.includes(OUT_OF_POSITION)
    if (now && !ticked) next[id] = { ...plan, context: [...plan.context, OUT_OF_POSITION], outOfPositionByTrak: true }
    // A tick from before the player went out of position is the coach's.
    else if (now) next[id] = { ...plan, outOfPositionByTrak: plan.outOfPositionByTrak ?? false }
    else if (ticked && plan.outOfPositionByTrak !== false)
      next[id] = { ...plan, context: plan.context.filter(tag => tag !== OUT_OF_POSITION), outOfPositionByTrak: undefined }
  }
  return next
}

/** The coach's context, from the sheet. Ticking or unticking Out of position makes it theirs, so a move never undoes it. */
export function setContext(plan: PlayerPlan, context: string[]): PlayerPlan {
  const changed = context.includes(OUT_OF_POSITION) !== plan.context.includes(OUT_OF_POSITION)
  return { ...plan, context, ...(changed ? { outOfPositionByTrak: false } : {}) }
}

/** A face's markers: ✓ for a job (for a Not selected player, a note), i for any context, and the expectation's ring
 *  (yellow for Stretch, green for Lead, none for Usual; Tarek, 6 Nov). */
export function markersOf(plan: PlayerPlan) {
  return {
    done: !!(plan.role === 'not_selected' ? plan.note : plan.job).trim(),
    context: plan.context.length > 0,
    ring: plan.expectation === 'usual' ? null : plan.expectation,
  }
}

/** The markers in words, for the face's accessible name, so colour is never the only signal. */
export function markerWords(plan: PlayerPlan): string[] {
  const { done, context, ring } = markersOf(plan)
  // TRAK-407: said in the language showing (English as it was).
  const labels = plan.context.map(tag => (CONTEXT.some(item => item.value === tag) ? i18n.t(`coachMatches:context_${tag}` as 'coachMatches:saved') : tag).toLocaleLowerCase())
  return [ring === 'stretch' ? i18n.t('coachMatches:markStretch') : ring === 'lead' ? i18n.t('coachMatches:markLead') : '',
    done ? (plan.role === 'not_selected' ? i18n.t('coachMatches:markNote') : i18n.t('coachMatches:markJob')) : '',
    context ? i18n.t('coachMatches:markContext', { labels: labels.join(i18n.t('coachSquad:fmAnd')) }) : '']
    .filter(Boolean)
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
