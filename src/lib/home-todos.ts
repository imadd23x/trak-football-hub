import { gameState, fullTime, type GameState, type PlanProgress } from '@/lib/games/loop'
import { trainingEnd } from '@/lib/training/sessions'
import { dayIn } from '@/lib/watch-first'

/* TRAK-607 (New Home 1/8, index TRAK-606): the coach's To-do, worked out from what Trak already stores, as gameState
   does for a match. Nothing is kept here: a to-do is there while its record is missing and goes when it's saved. The
   rules are table 2 and 3 of Kostas's 26 Nov mockup (linked on TRAK-606):

     group     rank  to-do                    shows from              done when                 longest it stays
     match     1     Match plan               00:00 on match day      shared, nothing unshared  kick-off
     training  2     Today's training plan    00:00 on training day   planned and shared        the session's start
     training  3     Take the register        the training day        the register is saved     48 h after the end
     match     4     Evaluate the game        match day               the draft is saved        7 days after kick-off
     match     5     Publish the evaluation   the draft is saved      it's published            7 days after kick-off
     training  6     Write session notes      the training day        saved, or "No notes"      48 h after the end
     players   7     Reports ready            the report day          the reports are sent      until sent
     both      8     Next training or match   a day with no events    that step is done         the end of that day
     yours     9     The coach's own          (TRAK-612)

   Urgent first, then by rank, then the earlier event. A to-do done today stays, ticked, until midnight; days are the
   academy's (its time zone), as the evaluation's are. There's no "Rate the players" step: every player in a match
   evaluation starts at Yes · Met (game_evaluation_players), so nobody is ever unrated. */

export type TodoGroup = 'training' | 'match' | 'players' | 'yours'
export type TodoKind = 'match-plan' | 'training-plan' | 'register' | 'evaluate' | 'publish' | 'notes' | 'reports' | 'next-training' | 'next-match' | 'own'

export const RANK: Record<TodoKind, number> = {
  'match-plan': 1, 'training-plan': 2, register: 3, evaluate: 4, publish: 5, notes: 6, reports: 7, 'next-training': 8, 'next-match': 8, own: 9,
}
const GROUP: Record<TodoKind, TodoGroup> = {
  'match-plan': 'match', 'training-plan': 'training', register: 'training', evaluate: 'match', publish: 'match', notes: 'training',
  reports: 'players', 'next-training': 'training', 'next-match': 'match', own: 'yours',
}

const HOUR = 60 * 60_000
/** A register or notes still missing leaves Home 48 h after the training ends; it stays on the training's page. */
export const TRAINING_KEEP = 48 * HOUR
/** Evaluating and publishing a match leave Home 7 days after kick-off; they stay on the match's page. */
export const MATCH_KEEP = 7 * 24 * HOUR
/** Upcoming's reach: the next training or match on a day with no events is one within this. */
const AHEAD = 7 * 24 * HOUR

/** A training, as Home reads it. `sharedAt`: when its plan went to the players (TRAK-601); until that exists, a
 *  published training counts as shared, as its Share publishes it today. */
export type HomeTraining = {
  id: string
  squad: string | null
  starts_at: string
  ends_at: string | null
  start_time: string | null
  published: boolean
  cancelled: boolean
  planned: boolean
  sharedAt?: string | null
  /** When its register was saved (the completed session), or null. */
  registeredAt: string | null
  /** When its Notes were saved or skipped, or null. Either closes the training, so no register is owed after. */
  notedAt: string | null
}

/** A match, as Home reads it: its plan as gameState reads it, and its evaluation. */
export type HomeMatch = {
  id: string
  squad: string | null
  starts_at: string
  ends_at: string | null
  published: boolean
  cancelled: boolean
  plan: Pick<PlanProgress, 'drafted' | 'shared' | 'sharedAt' | 'changes'>
  /** When the evaluation draft was saved, or null. */
  evaluatedAt: string | null
  /** When the evaluation was published, or null. */
  publishedAt: string | null
  /** TRAK-290: the 09:00 reminder after the draft. From then on, publishing is urgent. */
  remindAt: string | null
}

/** TRAK-612: one of the coach's own to-dos (coach_todos): its text, the academy day it's for, and when it was ticked. */
export type HomeOwnTodo = { id: string; title: string; dueOn: string; urgent: boolean; doneAt: string | null; createdAt: string
  /** TRAK-622: the event it was added from (Add to To-do), or null. */
  eventId?: string | null }

/** A squad whose report day has come (TRAK-364, TRAK-531): `since` is the academy day it fell due. */
export type HomeReport = { squad: string; since: string }

export type HomeTodo = {
  /** Stable across reads, so the coach's order (TRAK-613) can hold: "register:{eventId}". */
  key: string
  kind: TodoKind
  group: TodoGroup
  rank: number
  urgent: boolean
  done: boolean
  squad: string | null
  eventId: string | null
  /** The event's start, for "the earlier event first"; a report's day. */
  at: number
  /** When its button opens, while that's still to come (the register at the start, notes at the end, the evaluation
   *  at full time); null when it can be done now. */
  opensAt: number | null
  /** When it leaves Home if it's not done; null when it waits until done. */
  leavesAt: number | null
  /** Where a plan is: Plan, Share or Shared for a training; the match's own state (gameState) for a match. */
  step?: 'plan' | 'share' | 'shared' | GameState
  /** TRAK-612: the coach's own words, for their own to-do. */
  title?: string
}

const parse = (iso: string) => Date.parse(iso)
/** The training's start as the plan's deadline: its start time, or its end when it has no time (it lasts its day). */
const trainingStart = (t: HomeTraining) => (t.start_time ? parse(t.starts_at) : trainingEnd(t))

/** The coach's To-do at `now`, in order. `zone` is the academy's time zone; `inView` is the squad picked (All: every). */
export function homeTodos({ trainings, matches, reports = [], own = [], now, zone, inView = () => true, training = true }: {
  trainings: HomeTraining[]
  matches: HomeMatch[]
  reports?: HomeReport[]
  /** TRAK-612: the coach's own to-dos, shown under every squad. */
  own?: HomeOwnTodo[]
  now: number
  zone: string
  inView?: (squad: string | null) => boolean
  /** TRAK-608: whether the academy's Training is on. Off, a training has no plan or notes to ask for; its register stays. */
  training?: boolean
}): HomeTodo[] {
  const today = dayIn(zone, new Date(now))
  const dayOf = (instant: number) => dayIn(zone, new Date(instant))
  const doneToday = (at: string | null | undefined) => !!at && dayOf(parse(at)) === today
  const todos: HomeTodo[] = []
  const add = (kind: TodoKind, id: string, rest: Omit<HomeTodo, 'key' | 'kind' | 'group' | 'rank' | 'eventId'> & { eventId?: string | null }) =>
    todos.push({ key: `${kind}:${id}`, kind, group: GROUP[kind], rank: RANK[kind], eventId: rest.eventId ?? id, ...rest })

  const liveTrainings = trainings.filter(t => !t.cancelled && inView(t.squad))
  const liveMatches = matches.filter(m => !m.cancelled && inView(m.squad))

  for (const t of liveTrainings) {
    const start = parse(t.starts_at), end = trainingEnd(t), at = start
    const isToday = dayOf(start) === today
    if (dayOf(start) > today) continue
    const base = { squad: t.squad, at }

    // Today's plan: Plan, then Share, then ✓ Shared. Missing on the day, it's urgent; it leaves at the start.
    if (isToday && training) {
      const shared = t.planned && (t.sharedAt ? parse(t.sharedAt) <= now : t.published)
      const deadline = trainingStart(t)
      if (shared || now < deadline) {
        add('training-plan', t.id, { ...base, done: shared, urgent: !t.planned, opensAt: null,
          leavesAt: shared ? null : deadline, step: !t.planned ? 'plan' : shared ? 'shared' : 'share' })
      }
    }

    // A training never published has no register (take_event_register refuses it) and nothing to note: its plan's
    // Share publishes it first.
    if (!t.published) continue

    // The register: from the start, owed once the training is over, for 48 h. Notes saved or skipped close it.
    const registerGone = now >= end + TRAINING_KEEP
    if (t.registeredAt ? doneToday(t.registeredAt) : !t.notedAt && !registerGone) {
      add('register', t.id, { ...base, done: !!t.registeredAt, urgent: !t.registeredAt && now >= end,
        opensAt: !t.registeredAt && now < start ? start : null, leavesAt: t.registeredAt ? null : end + TRAINING_KEEP })
    }

    // Notes: from the end, never urgent, for 48 h.
    if (training && (t.notedAt ? doneToday(t.notedAt) : !registerGone)) {
      add('notes', t.id, { ...base, done: !!t.notedAt, urgent: false,
        opensAt: !t.notedAt && now < end ? end : null, leavesAt: t.notedAt ? null : end + TRAINING_KEEP })
    }
  }

  for (const m of liveMatches) {
    const kickOff = parse(m.starts_at), whistle = fullTime(m), at = kickOff
    if (dayOf(kickOff) > today) continue
    const base = { squad: m.squad, at }
    const gone = now >= kickOff + MATCH_KEEP

    // The match plan, on match day until kick-off: urgent until it's shared (a scheduled share counts).
    if (dayOf(kickOff) === today) {
      const state = gameState(m, Math.min(now, kickOff - 1), m.plan)
      const shared = state === 'shared' || state === 'scheduled'
      if (shared || now < kickOff) {
        add('match-plan', m.id, { ...base, done: shared, urgent: !shared, opensAt: null, leavesAt: shared ? null : kickOff, step: state })
      }
    }

    // A match never published (its logistics never went out) has no evaluation to ask for.
    if (!m.published) continue

    // Evaluate: on match day, opening at full time; for 7 days after kick-off.
    if (m.evaluatedAt ? doneToday(m.evaluatedAt) : !gone) {
      add('evaluate', m.id, { ...base, done: !!m.evaluatedAt, urgent: false,
        opensAt: !m.evaluatedAt && now < whistle ? whistle : null, leavesAt: m.evaluatedAt ? null : kickOff + MATCH_KEEP })
    }

    // Publish: once a draft is saved, urgent from its 09:00 reminder; for 7 days after kick-off.
    if (m.evaluatedAt && (m.publishedAt ? doneToday(m.publishedAt) : !gone)) {
      add('publish', m.id, { ...base, done: !!m.publishedAt, urgent: !m.publishedAt && !!m.remindAt && now >= parse(m.remindAt),
        opensAt: null, leavesAt: m.publishedAt ? null : kickOff + MATCH_KEEP })
    }
  }

  // Reports ready: from the report day until they're sent; urgent once that day has passed.
  for (const r of reports) {
    if (!inView(r.squad) || r.since > today) continue
    add('reports', r.squad, { squad: r.squad, eventId: null, at: Date.parse(`${r.since}T00:00:00Z`), done: false,
      urgent: r.since < today, opensAt: null, leavesAt: null })
  }

  // TRAK-612: the coach's own, from its day until ticked (an unticked one moves on to the next day), then ticked until
  // midnight. Rank 9, after Trak's; an urgent one goes up with the urgent. Under every squad, as they're the coach's.
  for (const o of own) {
    if (o.doneAt ? !doneToday(o.doneAt) : o.dueOn > today) continue
    // TRAK-624: one added from an event (Add to To-do) carries it, so its line names the event.
    add('own', o.id, { squad: null, eventId: o.eventId ?? null, at: parse(o.createdAt), done: !!o.doneAt, urgent: o.urgent && !o.doneAt,
      opensAt: null, leavesAt: null, title: o.title })
  }

  // A day with no training or match: the next training's plan and the next match's next step, while still missing.
  const eventToday = liveTrainings.some(t => dayOf(parse(t.starts_at)) === today) || liveMatches.some(m => dayOf(parse(m.starts_at)) === today)
  if (!eventToday) {
    const endOfDay = startOfNextDay(now, zone)
    const ahead = (iso: string) => dayOf(parse(iso)) > today && parse(iso) <= now + AHEAD
    const nextTraining = liveTrainings.filter(t => ahead(t.starts_at)).sort((a, b) => parse(a.starts_at) - parse(b.starts_at))[0]
    if (training && nextTraining && !nextTraining.planned) {
      add('next-training', nextTraining.id, { squad: nextTraining.squad, at: parse(nextTraining.starts_at), done: false, urgent: false,
        opensAt: null, leavesAt: endOfDay, step: 'plan' })
    }
    const nextMatch = liveMatches.filter(m => ahead(m.starts_at)).sort((a, b) => parse(a.starts_at) - parse(b.starts_at))[0]
    if (nextMatch) {
      const state = gameState(nextMatch, now, nextMatch.plan)
      if (state === 'logistics' || state === 'plan' || state === 'planDraft' || state === 'changes') {
        add('next-match', nextMatch.id, { squad: nextMatch.squad, at: parse(nextMatch.starts_at), done: false, urgent: false,
          opensAt: null, leavesAt: endOfDay, step: state })
      }
    }
  }

  return todos.sort(byOrder)
}

/** TRAK-610: every training and match from tomorrow to 7 days ahead still missing a step (a training's plan, then its
 *  share while it's a draft, TRAK-611; a match's logistics, plan or share), soonest first, as next-training and next-match to-dos. Home suggests the first that isn't
 *  already a to-do; Upcoming (TRAK-611) lists them all. */
export function upcomingSteps({ trainings, matches, now, zone, inView = () => true, training = true }: {
  trainings: HomeTraining[]
  matches: HomeMatch[]
  now: number
  zone: string
  inView?: (squad: string | null) => boolean
  training?: boolean
}): HomeTodo[] {
  const today = dayIn(zone, new Date(now))
  const ahead = (iso: string) => dayIn(zone, new Date(parse(iso))) > today && parse(iso) <= now + AHEAD
  const steps: HomeTodo[] = []
  const base = { done: false, urgent: false, opensAt: null, leavesAt: null }
  if (training) {
    for (const t of trainings) {
      if (t.cancelled || !inView(t.squad) || !ahead(t.starts_at) || (t.planned && t.published)) continue
      steps.push({ ...base, key: `next-training:${t.id}`, kind: 'next-training', group: 'training', rank: RANK['next-training'],
        squad: t.squad, eventId: t.id, at: parse(t.starts_at), step: t.planned ? 'share' : 'plan' })
    }
  }
  for (const m of matches) {
    if (m.cancelled || !inView(m.squad) || !ahead(m.starts_at)) continue
    const state = gameState(m, now, m.plan)
    if (state !== 'logistics' && state !== 'plan' && state !== 'planDraft' && state !== 'changes') continue
    steps.push({ ...base, key: `next-match:${m.id}`, kind: 'next-match', group: 'match', rank: RANK['next-match'],
      squad: m.squad, eventId: m.id, at: parse(m.starts_at), step: state })
  }
  return steps.sort((a, b) => a.at - b.at || a.key.localeCompare(b.key))
}

/** TRAK-613 (Kostas, 26 Nov): the coach's own order, which holds until midnight. Without one, Trak's order. With one, the
 *  saved keys still on the list keep their places; a new urgent to-do goes to the top and anything else new to the
 *  bottom, in Trak's order. */
export function applyOrder<T extends { todo: HomeTodo }>(items: T[], saved: string[] | null | undefined): T[] {
  if (!saved?.length) return items
  const byKey = new Map(items.map(item => [item.todo.key, item]))
  const known = new Set(saved)
  const kept = saved.flatMap(key => byKey.has(key) ? [byKey.get(key)!] : [])
  const fresh = items.filter(item => !known.has(item.todo.key))
  const pressing = (item: T) => item.todo.urgent && !item.todo.done
  return [...fresh.filter(pressing), ...kept, ...fresh.filter(item => !pressing(item))]
}

/** Urgent first, then by rank, then the earlier event. */
export function byOrder(a: HomeTodo, b: HomeTodo): number {
  return Number(b.urgent) - Number(a.urgent) || a.rank - b.rank || a.at - b.at || a.key.localeCompare(b.key)
}

/** The first instant of the academy's next day after `now` (its midnight), found by stepping through the day's hours:
 *  a day is 23 to 25 hours long where the clocks change. */
export function startOfNextDay(now: number, zone: string): number {
  const today = dayIn(zone, new Date(now))
  let low = now, high = now + 26 * HOUR
  while (high - low > 60_000) {
    const mid = low + Math.floor((high - low) / 2)
    if (dayIn(zone, new Date(mid)) === today) low = mid
    else high = mid
  }
  // Midnight falls on a whole minute in (low, high], and high is less than a minute past it.
  return Math.floor(high / 60_000) * 60_000
}
