/* TRAK-283 (Games 1/8): where a match is in its loop (TRAK-282), from the event alone. The plan (TRAK-284 to 287)
   and the evaluation (TRAK-288, 289) add their own states. The clock is an instant (now, starts_at, ends_at), so
   the device's time zone never matters: the database sets both instants on the academy's clock (TRAK-175). */

export type GameEvent = { id: string; published: boolean; starts_at: string; ends_at: string | null }
export type GameState = 'logistics' | 'plan' | 'planDraft' | 'shared' | 'changes' | 'locked' | 'fullTime' | 'evaluationDraft' | 'published'
export type GameTab = 'logistics' | 'plan' | 'evaluation'
/** Where the plan is: saved as a draft (TRAK-284), shared, and how many players' copies an edit since would change
 *  (TRAK-286). And whether an evaluation draft is saved (TRAK-288). */
export type PlanProgress = { drafted?: boolean; shared?: boolean; changes?: number; evaluated?: boolean; published?: boolean }
/** The next action opens a tab; `step: 'share'` opens the plan's Share step. */
export type GameAction = { label: string; tab: GameTab; step?: 'share' }

/** The loop as the stepper draws it (TRAK-282). */
export const LOOP_STEPS = ['Logistics', 'Plan', 'Shared', 'Kick-off', 'Evaluation', 'Published'] as const

/** Each state's badge, its place on the loop and the one next action, if any. */
export const STATE: Record<GameState, {
  label: string; tone: 'neutral' | 'info' | 'warning' | 'success'; step: number; action?: GameAction
}> = {
  // Publishing the match in Schedule is "share the logistics" (TRAK-282, step 1).
  logistics: { label: 'Logistics not shared', tone: 'neutral', step: 0, action: { label: 'Share the logistics', tab: 'logistics' } },
  plan: { label: 'Plan not written', tone: 'warning', step: 1, action: { label: 'Write the plan', tab: 'plan' } },
  // TRAK-284: a draft only the coach sees. Sharing it (TRAK-286) closes "Plan not shared".
  planDraft: { label: 'Plan not shared', tone: 'warning', step: 1, action: { label: 'Share the plan', tab: 'plan', step: 'share' } },
  shared: { label: 'Plan shared', tone: 'success', step: 2 },
  // TRAK-286: edits after sharing wait until the coach shares them.
  changes: { label: 'Changes not shared', tone: 'warning', step: 2, action: { label: 'Share the changes', tab: 'plan', step: 'share' } },
  locked: { label: 'Locked at kick-off', tone: 'info', step: 3 },
  // TRAK-288: the evaluation opens at full time. Which past matches still owe one is the week's rule (coachWeek).
  fullTime: { label: 'Full time', tone: 'neutral', step: 4, action: { label: 'Evaluate', tab: 'evaluation' } },
  // TRAK-288: a draft only the coach sees, until it's published (TRAK-289).
  evaluationDraft: { label: 'Evaluation draft', tone: 'warning', step: 4, action: { label: 'Publish', tab: 'evaluation' } },
  // TRAK-289: the loop closes.
  published: { label: 'Published', tone: 'success', step: 5 },
}

/** Full time: the event's end, or 90 minutes after kick-off when it has none, as the database reads it (event_wall_end). */
export function fullTime(game: GameEvent): number {
  return game.ends_at ? Date.parse(game.ends_at) : Date.parse(game.starts_at) + 90 * 60_000
}

export function gameState(game: GameEvent, now: number, plan: PlanProgress = {}): GameState {
  if (!game.published) return 'logistics' // a draft can still be published after its time (TRAK-230)
  if (now < Date.parse(game.starts_at)) {
    return plan.shared ? (plan.changes ? 'changes' : 'shared') : plan.drafted ? 'planDraft' : 'plan'
  }
  return now < fullTime(game) ? 'locked' : plan.published ? 'published' : plan.evaluated ? 'evaluationDraft' : 'fullTime'
}

/** The game page's address for a next action. */
export const actionLink = (eventId: string, action: Omit<GameAction, 'label'>) =>
  `/coach/games/${eventId}?tab=${action.tab}${action.step ? `&step=${action.step}` : ''}`

const WEEK = 7 * 24 * 60 * 60_000

/** Needs you (TRAK-284): matches whose logistics are shared and that kick off within 7 days, soonest first. A
 *  cancelled match isn't one of the coach's games. Home asks each for "Plan not shared" or, once shared, "Changes not
 *  shared" (TRAK-286). */
export function needsAPlan<T extends GameEvent>(games: T[], now: number): T[] {
  const kickOff = (game: T) => Date.parse(game.starts_at)
  return games.filter(game => game.published && kickOff(game) > now && kickOff(game) <= now + WEEK)
    .sort((a, b) => kickOff(a) - kickOff(b))
}

/** Upcoming matches soonest first, then past ones newest first, as the mockup orders them. The next game is the
 *  soonest that hasn't kicked off. */
export function orderGames<T extends GameEvent>(games: T[], now: number): { next: T | null; games: T[] } {
  const kickOff = (game: T) => Date.parse(game.starts_at)
  const upcoming = games.filter(game => kickOff(game) > now).sort((a, b) => kickOff(a) - kickOff(b))
  const past = games.filter(game => kickOff(game) <= now).sort((a, b) => kickOff(b) - kickOff(a))
  return { next: upcoming[0] ?? null, games: [...upcoming, ...past] }
}
