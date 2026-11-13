import { i18n } from '@/lib/i18n'
import type { Tables } from '@/integrations/supabase/types'
import { libraryOf, sessionById } from '@/lib/library/library'
import type { DrillDraft } from './sessions'
import type { PartType } from './shelf'

/* TRAK-295 (Training 2/5, spec TRAK-293): a training's plan, kept apart from the screens. A practice carries what a
   drill does, plus where it came from. The plan is saved whole by save_training_plan(); its limits are the
   database's (training_plan_practices), so change both together. */

/** Plan session, for one training (TRAK-340; was Write my own). */
export const planPath = (eventId: string) => `/coach/training/${eventId}/plan`
/** Who's here: the register, then Trak's suggestions for the plan (TRAK-342). */
export const herePath = (eventId: string) => `/coach/training/${eventId}/here`
/** View: the plan read at the pitch side (TRAK-309). */
export const viewPath = (eventId: string) => `/coach/training/${eventId}/view`
/** What the planner can open with: a Library drill sent from its page (TRAK-391; was a drill from My drills,
 *  TRAK-296), or a past session's practices to copy (TRAK-297). */
export type PlannerState = {
  /** The Library drill's id, and the players and level the coach set on its page. */
  addLibrary?: { drill: string; players: number; level: number }
  copy?: SavedPractice[]; copiedFrom?: string
  /** TRAK-341: from a saved plan's Review page, change one part (by its place) or add one. */
  editPart?: number
  addPart?: { type: PartType; name: string }
} | null

export type PracticeSource = 'own' | 'drill' | 'library' | 'trak'
export type Practice = DrillDraft & {
  source: PracticeSource
  drill_id: string | null
  library_session: string | null
  /** TRAK-340: the part it fills, as the coach named it. */
  part?: string
}

export type SavedPractice = Pick<Tables<'training_plan_practices'>, 'position' | 'name' | 'minutes' | 'how' | 'tell' | 'area'
  | 'numbers' | 'direction' | 'targets' | 'conditions' | 'source' | 'drill_id' | 'library_session' | 'part' | 'part_type'
  | 'trak_drill' | 'players_kind' | 'group_size' | 'trak_level'>

/** The saved practices, in order, ready to change. */
export function fromSaved(rows: SavedPractice[]): Practice[] {
  return [...rows].sort((a, b) => a.position - b.position).map(({ position: _p, source, ...row }) => ({
    ...row, source: source as PracticeSource,
  }))
}

/** The tag beside a practice. A Library practice names its library; a coach-made drill (none since 8 Nov) is theirs. */
export function sourceLabel(practice: Pick<Practice, 'source'> & { library_session?: string | null }): string {
  if (practice.source === 'trak') return 'Trak drill'
  if (practice.source === 'library') {
    const session = practice.library_session ? sessionById(practice.library_session) : undefined
    return session ? `Library · ${libraryOf(session).label}` : 'Library'
  }
  return practice.source === 'drill' ? 'Your drill' : 'Written here'
}

export const plannedMinutes = (practices: Pick<Practice, 'minutes'>[]) => practices.reduce((sum, p) => sum + p.minutes, 0)

/** Kostas, 28 Oct: a plan may run longer than the training was set for (the time may have been a mistake), so the
 *  coach can keep it; this says so plainly. Null when it fits or the training has no length. */
export function overTime(planned: number, length: number | null): string | null {
  if (!length || planned <= length) return null
  return i18n.t('coachTraining:overTime', { length, over: planned - length })
}

/** TRAK-367: a practice on one line: its part, then its drill ("Rondo · Rondo 4 v 2 with a target"). Only the name when
 *  they're the same, or it's an older plan with no parts. */
export const practiceLine = (practice: { name: string; part?: string | null }) =>
  practice.part && practice.part !== practice.name ? `${practice.part} · ${practice.name}` : practice.name

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
  const count = i18n.t('coachTraining:practiceCount', { count: practices.length })
  return [count, i18n.t('coachHome:minutes', { count: plannedMinutes(practices) }), practices.map(p => p.name).join(', ')].join(' · ')
}
