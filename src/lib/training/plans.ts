import type { Json, Tables } from '@/integrations/supabase/types'
import { libraryOf, pitchOf, playersOf, sessionById, titleParts, type LibrarySession } from '@/lib/library/library'
import { DRILL_LIMITS, blankDrill, cleanDrill, type Drill, type DrillDraft } from './sessions'

/* TRAK-295 (Training 2/5, spec TRAK-293): a training's plan, kept apart from the screens. A practice carries what a
   drill does, plus where it came from. The plan is saved whole by save_training_plan(); its limits are the
   database's (training_plan_practices), so change both together. */

export const PLAN_MAX = 12

/** Write my own, for one training. */
export const planPath = (eventId: string) => `/coach/training/${eventId}/plan`
/** View: the plan read at the pitch side (TRAK-309). */
export const viewPath = (eventId: string) => `/coach/training/${eventId}/view`
/** What View opens with: from Training home's View plan (TRAK-310), its back link goes back there. */
export type ViewState = { back?: 'training' } | null
/** What the planner can open with: a drill sent from Training › Drills (TRAK-296), or a past session's practices to
 *  copy (TRAK-297). */
export type PlannerState = { addDrill?: Drill; copy?: SavedPractice[]; copiedFrom?: string } | null

export type PracticeSource = 'own' | 'drill' | 'library'
export type Practice = DrillDraft & {
  source: PracticeSource
  drill_id: string | null
  library_session: string | null
  /** Written here and ticked "Save to My drills": the save makes it one of the coach's drills too. */
  saveToDrills: boolean
}

/** A new practice to write: "Save to My drills" starts ticked (mockup board 3A). */
export const blankPractice = (): Practice => ({
  ...blankDrill(), source: 'own', drill_id: null, library_session: null, saveToDrills: true,
})

export type SavedPractice = Pick<Tables<'training_plan_practices'>, 'position' | 'name' | 'minutes' | 'how' | 'tell' | 'area'
  | 'numbers' | 'direction' | 'targets' | 'conditions' | 'source' | 'drill_id' | 'library_session'>

/** The saved practices, in order, ready to change. One already saved is never saved to My drills again. */
export function fromSaved(rows: SavedPractice[]): Practice[] {
  return [...rows].sort((a, b) => a.position - b.position).map(({ position: _p, source, ...row }) => ({
    ...row, source: source as PracticeSource, saveToDrills: false,
  }))
}

/** What save_training_plan() takes: the practices in order, trimmed. */
export function toSave(practices: Practice[]): Json {
  return practices.map(({ saveToDrills, source, drill_id, library_session, ...draft }) => ({
    ...cleanDrill(draft), source, drill_id, library_session, save_to_drills: source === 'own' && saveToDrills,
  }))
}

/** The tag beside a practice. Written here and ticked for My drills, it is the coach's drill once saved. A Library
 *  practice names its library. */
export function sourceLabel(practice: Pick<Practice, 'source' | 'saveToDrills'> & { library_session?: string | null }): string {
  if (practice.source === 'library') {
    const session = practice.library_session ? sessionById(practice.library_session) : undefined
    return session ? `Library · ${libraryOf(session).label}` : 'Library'
  }
  return practice.source === 'drill' || practice.saveToDrills ? 'Your drill' : 'Written here'
}

/* TRAK-296 (Training 3/5): a practice from one of the coach's drills or a Library session, and the drills that fit a
   slot best. */

/** One of the coach's drills, as a practice: a copy, so changing the drill later never changes the plan. */
export function fromDrill(drill: Drill): Practice {
  const { id, updated_at: _at, ...draft } = drill
  return { ...draft, source: 'drill', drill_id: id, library_session: null, saveToDrills: false }
}

/** A Library session, as a practice: its name, the slot's minutes (or 20), what it's about, and its pitch and
 *  players as the area and numbers. */
export function fromLibrary(session: LibrarySession, minutes: number | null): Practice {
  const cut = (text: string | undefined, max: number) => (text ?? '').slice(0, max)
  return {
    ...blankDrill(),
    name: cut(titleParts(session).title, DRILL_LIMITS.name),
    minutes: minutes ?? 20,
    how: cut(session.summary, DRILL_LIMITS.how),
    area: cut(pitchOf(session), DRILL_LIMITS.detail),
    numbers: cut(playersOf(session), DRILL_LIMITS.detail),
    source: 'library', drill_id: null, library_session: session.id, saveToDrills: false,
  }
}

/** The minutes a new practice has room for: what's left of the training, to the nearest 5, kept to 10–30. Null
 *  when the training has no length or nothing is left. */
export function roomFor(planned: number, length: number | null): number | null {
  if (!length || length - planned <= 0) return null
  return Math.min(30, Math.max(10, Math.round((length - planned) / 5) * 5))
}

/** The drills whose usual minutes are closest to the slot's, closest first (the newest first on a tie), at most 3. */
export function bestFit<T extends { minutes: number }>(drills: T[], minutes: number, count = 3): T[] {
  return drills.map((drill, i) => ({ drill, i })).sort((a, b) =>
    Math.abs(a.drill.minutes - minutes) - Math.abs(b.drill.minutes - minutes) || a.i - b.i).slice(0, count).map(x => x.drill)
}

export const plannedMinutes = (practices: Pick<Practice, 'minutes'>[]) => practices.reduce((sum, p) => sum + p.minutes, 0)

/** "40 of 90 min planned" and what's left, or just "40 min planned" when the training has no length. */
export function minutesLine(planned: number, length: number | null): { planned: string; left: string | null } {
  if (!length) return { planned: `${planned} min planned`, left: null }
  const left = length - planned
  return {
    planned: `${planned} of ${length} min planned`,
    left: left > 0 ? `${left} min left` : left < 0 ? `${-left} min over` : 'Fills the session',
  }
}

/** Kostas, 28 Oct: a plan may run longer than the training was set for (the time may have been a mistake), so the
 *  coach can keep it; this says so plainly. Null when it fits or the training has no length. */
export function overTime(planned: number, length: number | null): string | null {
  if (!length || planned <= length) return null
  return `You set this training for ${length} min. The plan runs ${planned - length} min over. You can keep it, or change the training's time in Schedule.`
}

/** The list with one practice moved up (-1) or down (+1); unchanged at either end. */
export function move<T>(list: T[], index: number, by: -1 | 1): T[] {
  const to = index + by
  if (index < 0 || index >= list.length || to < 0 || to >= list.length) return list
  const next = [...list]
  ;[next[index], next[to]] = [next[to], next[index]]
  return next
}

/* "How do you want to plan it?" remembers the coach's last way, on this device ("You used this last time"). Copy a
   past session is TRAK-297 (Training 4/5); Build it with Trak is parked (TRAK-293). */

export const PLAN_WAYS = ['write', 'copy'] as const
export type PlanWay = (typeof PLAN_WAYS)[number]
const wayKey = (userId: string) => `trak:training:plan-way:${userId}`

export function lastPlanWay(userId: string | undefined): PlanWay | null {
  if (!userId) return null
  try {
    const way = localStorage.getItem(wayKey(userId))
    return PLAN_WAYS.find(w => w === way) ?? null
  } catch {
    return null
  }
}

export function rememberPlanWay(userId: string | undefined, way: PlanWay) {
  if (!userId) return
  try {
    localStorage.setItem(wayKey(userId), way)
  } catch {
    // Private windows can refuse storage; the sheet then just doesn't say which way was last.
  }
}

/* TRAK-297 (Training 4/5): Copy a past session. */

/** The past sessions whose title or a practice's name holds every word typed, in the order given. */
export function searchSessions<T extends { title: string; practices: { name: string }[] }>(sessions: T[], query: string): T[] {
  const words = query.toLocaleLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return sessions
  return sessions.filter(session => {
    const text = [session.title, ...session.practices.map(p => p.name)].join(' ').toLocaleLowerCase()
    return words.every(word => text.includes(word))
  })
}

/** "4 practices · 90 min · Rondos 4v1, Pressing zones, 8v8, Huddle". */
export function sessionSummary(practices: Pick<Practice, 'name' | 'minutes'>[]): string {
  const count = `${practices.length} ${practices.length === 1 ? 'practice' : 'practices'}`
  return [count, `${plannedMinutes(practices)} min`, practices.map(p => p.name).join(', ')].join(' · ')
}
