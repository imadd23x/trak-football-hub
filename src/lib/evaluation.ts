import { format, parseISO } from 'date-fns'
import { scoreToBand } from '@/lib/rating-engine'
import { BANDS, type BandConfig } from '@/lib/types'

/* TRAK-364 (Season plan 16/18, spec TRAK-348): the evaluation. Where the season plan is on, the coach evaluates every
   consented player of a squad on the plan's rhythm (every 2 weeks, every month or every 6 weeks, on a day) instead of
   being reminded one player at a time. The dates come from the season's dates, as the mockup's evalDates(): every 2 or
   6 weeks, the first one on the day after a full gap from the start; every month, the last such day of each month at
   least 20 days into the season. They count from the day the plan was first shared, after the last evaluation, in the
   academy's time zone. A missed date stays due; when several have passed, one evaluation closes them all. Each player
   starts from their latest six ratings, however they were given, which give the band (BANDS, scoreToBand). */

export type EvalEvery = '2w' | 'month' | '6w'
export const EVAL_EVERY: { value: EvalEvery; label: string }[] = [
  { value: '2w', label: 'Every 2 weeks' }, { value: 'month', label: 'Every month' }, { value: '6w', label: 'Every 6 weeks' },
]
/** Days of the week as JavaScript counts them, 0 Sunday. */
export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const
/** The mockup's default, and the database's: every month, on the last Sunday. */
export const DEFAULT_EVAL_EVERY: EvalEvery = 'month'
export const DEFAULT_EVAL_DAY = 0

export const isEvalEvery = (value: unknown): value is EvalEvery => EVAL_EVERY.some(e => e.value === value)
/** A plan's rhythm, with the defaults where a row (or an older reply) has none. */
export function rhythmOf(plan: { eval_every?: string | null; eval_day?: number | null }): { every: EvalEvery; day: number } {
  const day = plan.eval_day
  return {
    every: isEvalEvery(plan.eval_every) ? plan.eval_every : DEFAULT_EVAL_EVERY,
    day: typeof day === 'number' && Number.isInteger(day) && day >= 0 && day <= 6 ? day : DEFAULT_EVAL_DAY,
  }
}

/** "every month, on the last Sunday", "every 2 weeks, on Saturday" */
export function rhythmText(every: EvalEvery, day: number): string {
  const name = WEEKDAYS[day] ?? WEEKDAYS[DEFAULT_EVAL_DAY]
  return every === 'month' ? `every month, on the last ${name}` : `${every === '2w' ? 'every 2 weeks' : 'every 6 weeks'}, on ${name}`
}

const DAY = 86_400_000
const dayNumber = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / DAY
const isoOf = (n: number) => new Date(n * DAY).toISOString().slice(0, 10)
const weekdayOf = (n: number) => new Date(n * DAY).getUTCDay()

/** Every evaluation date of the season, as YYYY-MM-DD, oldest first. None without both dates. */
export function evaluationDates({ startsOn, endsOn, every, day }: {
  startsOn: string | null; endsOn: string | null; every: EvalEvery; day: number
}): string[] {
  if (!startsOn || !endsOn || endsOn <= startsOn) return []
  const start = dayNumber(startsOn), end = dayNumber(endsOn), out: string[] = []
  if (every === 'month') {
    const year = Number(startsOn.slice(0, 4)), month = Number(startsOn.slice(5, 7)) - 1
    for (let m = month; out.length < 24 && m < month + 36; m++) {
      // The month's last day (Date.UTC rolls the month over), then back to the day of the week.
      let d = Date.UTC(year, m + 1, 0) / DAY
      while (weekdayOf(d) !== day) d -= 1
      if (d > end) break
      if (d - start >= 20) out.push(isoOf(d))
    }
    return out
  }
  const gap = every === '2w' ? 14 : 42
  let d = start + gap - 1
  while (weekdayOf(d) !== day) d += 1
  for (; d <= end && out.length < 40; d += gap) out.push(isoOf(d))
  return out
}

export type EvaluationDue = {
  /** The date a publish closes: the latest scheduled date that has passed. Null when nothing is due. */
  dueOn: string | null
  /** The first date still waiting, the day it became due. Null when nothing is due. */
  since: string | null
  /** The next scheduled date after today, or null when the season has none left. */
  next: string | null
}

/** Where a shared plan's evaluation stands on `today`, every day the academy's: the dates from the day the plan was
 *  first shared, after the last evaluation's. */
export function evaluationDue({ dates, sharedOn, lastDueOn, today }: {
  dates: string[]; sharedOn: string; lastDueOn: string | null; today: string
}): EvaluationDue {
  const counted = dates.filter(d => d >= sharedOn && (!lastDueOn || d > lastDueOn))
  const passed = counted.filter(d => d <= today)
  return { dueOn: passed.at(-1) ?? null, since: passed[0] ?? null, next: counted.find(d => d > today) ?? null }
}

/** "Sun 29 Nov", and "Sun 29 Nov 2026" with the year. */
export const evalDay = (iso: string, year = false) => format(parseISO(iso), year ? 'EEE d MMM yyyy' : 'EEE d MMM')

// ── The six ratings ──────────────────────────────────────────────────────────
/** As the assessment's sliders, in their order and words (CoachAssessPage). */
export const RATINGS = [
  { key: 'work_rate', label: 'Work Rate' }, { key: 'tactical', label: 'Tactical' }, { key: 'attitude', label: 'Attitude' },
  { key: 'technical', label: 'Technical' }, { key: 'physical', label: 'Physical' }, { key: 'coachability', label: 'Coachability' },
] as const
export type RatingKey = (typeof RATINGS)[number]['key']
export type Ratings = Record<RatingKey, number>
/** Where a player with no ratings yet starts: the assessment's own start, 5 each. */
export const START_RATING = 5
/** As the assessment's message. */
export const NOTE_MAX = 300

export const startRatings = (): Ratings => Object.fromEntries(RATINGS.map(r => [r.key, START_RATING])) as Ratings
export const ratingsAverage = (r: Ratings) => RATINGS.reduce((sum, { key }) => sum + r[key], 0) / RATINGS.length
export const sameRatings = (a: Ratings, b: Ratings) => RATINGS.every(({ key }) => a[key] === b[key])
/** The band six ratings give, as BANDS has it. */
export function bandOf(r: Ratings): BandConfig {
  const band = scoreToBand(ratingsAverage(r))
  return BANDS.find(b => b.word.toLowerCase() === band) ?? BANDS[BANDS.length - 1]
}
/** Up (1), down (-1) or the same band (0) as `before`. */
export function bandMove(now: Ratings, before: Ratings | null): number {
  if (!before) return 0
  return Math.sign(bandOf(now).minScore - bandOf(before).minScore)
}

type AssessmentRow = { squad_player_id: string; created_at: string | null } & Partial<Record<RatingKey, number | null>>

/** Each player's latest six ratings, however they were given (a session's assessment or an evaluation). */
export function latestRatings(assessments: AssessmentRow[]): Map<string, Ratings> {
  const latest = new Map<string, { at: string; ratings: Ratings }>()
  for (const row of assessments) {
    if (!row.created_at || RATINGS.some(({ key }) => typeof row[key] !== 'number')) continue
    const seen = latest.get(row.squad_player_id)
    if (seen && seen.at >= row.created_at) continue
    latest.set(row.squad_player_id, { at: row.created_at, ratings: Object.fromEntries(RATINGS.map(({ key }) => [key, row[key]])) as Ratings })
  }
  return new Map([...latest].map(([id, { ratings }]) => [id, ratings]))
}

/** One player in the evaluation: the ratings on screen, the note, and whether the coach has rated them. A player with
 *  ratings from before is rated from the start; one without has to be rated first (no band is made up for them). */
export type EvaluationEntry = { ratings: Ratings; note: string; rated: boolean }

export function startEntry(before: Ratings | undefined): EvaluationEntry {
  return before ? { ratings: { ...before }, note: '', rated: true } : { ratings: startRatings(), note: '', rated: false }
}

/** What publish_evaluation() is sent: each player once, the six ratings and the note, trimmed. */
export function toPublish(players: string[], entries: Record<string, EvaluationEntry>) {
  return players.map(id => {
    const entry = entries[id]
    return { squad_player_id: id, ...entry.ratings, note: entry.note.trim() }
  })
}

// ── What the season plan says about the rhythm ───────────────────────────────
/** Step 1 and Share, before the plan is shared: the first date the rhythm gives from `today` (the plan counts from the
 *  day it's shared, so no earlier date will be due). */
export function firstDateLine({ startsOn, endsOn, every, day, today }: {
  startsOn: string | null; endsOn: string | null; every: EvalEvery; day: number; today: string
}): string {
  if (!startsOn || !endsOn || endsOn <= startsOn) return 'Add the season’s dates to see your evaluation days.'
  const first = evaluationDates({ startsOn, endsOn, every, day }).find(d => d >= today)
  return first ? `First evaluation ${evalDay(first, true)}: each player’s six ratings, which give their band. Everyone starts where they were last time.`
    : 'No evaluation date is left in this season.'
}

/** Once shared: whether one is due, or the next date. */
export function nextDateLine(due: EvaluationDue, today: string): string {
  if (due.dueOn) return `Due now${due.since && due.since < today ? `, since ${evalDay(due.since)}` : ''}.`
  return due.next ? `Next evaluation ${evalDay(due.next, true)}.` : 'No evaluation is left this season.'
}

/** The academy's calendar day for an instant, as YYYY-MM-DD (watch-first's dayIn, kept here so this file stands alone). */
const dayInZone = (timeZone: string, instant: Date) =>
  new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(instant)

/** A shared plan's evaluation at `now`, every day counted in the academy's `zone`: from the day it was first shared,
 *  after its last evaluation (`lastDueOn`). */
export function squadEvaluation({ plan, lastDueOn, zone, now }: {
  plan: { starts_on: string | null; ends_on: string | null; shared_at: string; eval_every?: string | null; eval_day?: number | null }
  lastDueOn: string | null
  zone: string
  now: Date
}): { due: EvaluationDue; sharedOn: string; today: string } {
  const { every, day } = rhythmOf(plan)
  const today = dayInZone(zone, now), sharedOn = dayInZone(zone, new Date(plan.shared_at))
  return { today, sharedOn, due: evaluationDue({ dates: evaluationDates({ startsOn: plan.starts_on, endsOn: plan.ends_on, every, day }), sharedOn, lastDueOn, today }) }
}
