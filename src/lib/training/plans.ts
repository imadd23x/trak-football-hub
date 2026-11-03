import type { Tables } from '@/integrations/supabase/types'
import { libraryOf, sessionById } from '@/lib/library/library'
import type { Drill, DrillDraft } from './sessions'
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
/** What the planner can open with: a drill sent from Training › Drills (TRAK-296), or a past session's practices to
 *  copy (TRAK-297). */
export type PlannerState = {
  addDrill?: Drill & { part_type?: string | null; players_kind?: string | null; group_size?: number | null }
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
  /** Written here and ticked "Save to My drills": the save makes it one of the coach's drills too. */
  saveToDrills: boolean
  /** TRAK-340: the part it fills, as the coach named it. */
  part?: string
}

export type SavedPractice = Pick<Tables<'training_plan_practices'>, 'position' | 'name' | 'minutes' | 'how' | 'tell' | 'area'
  | 'numbers' | 'direction' | 'targets' | 'conditions' | 'source' | 'drill_id' | 'library_session' | 'part' | 'part_type'
  | 'trak_drill' | 'players_kind' | 'group_size'>

/** The saved practices, in order, ready to change. One already saved is never saved to My drills again. */
export function fromSaved(rows: SavedPractice[]): Practice[] {
  return [...rows].sort((a, b) => a.position - b.position).map(({ position: _p, source, ...row }) => ({
    ...row, source: source as PracticeSource, saveToDrills: false,
  }))
}

/** The tag beside a practice. Written here and ticked for My drills, it is the coach's drill once saved. A Library
 *  practice names its library. */
export function sourceLabel(practice: Pick<Practice, 'source' | 'saveToDrills'> & { library_session?: string | null }): string {
  if (practice.source === 'trak') return 'Trak drill'
  if (practice.source === 'library') {
    const session = practice.library_session ? sessionById(practice.library_session) : undefined
    return session ? `Library · ${libraryOf(session).label}` : 'Library'
  }
  return practice.source === 'drill' || practice.saveToDrills ? 'Your drill' : 'Written here'
}

export const plannedMinutes = (practices: Pick<Practice, 'minutes'>[]) => practices.reduce((sum, p) => sum + p.minutes, 0)

/** Kostas, 28 Oct: a plan may run longer than the training was set for (the time may have been a mistake), so the
 *  coach can keep it; this says so plainly. Null when it fits or the training has no length. */
export function overTime(planned: number, length: number | null): string | null {
  if (!length || planned <= length) return null
  return `You set this training for ${length} min. The plan runs ${planned - length} min over. You can keep it, or change the training's time in Schedule.`
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
