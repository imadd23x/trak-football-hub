/*
 * TRAK-127 (J8.4): the coach's event form, and the one place that knows how it
 * maps onto coach_calendar_events. The schedule screen and its tests only go
 * through these helpers, so a column rename lands here and nowhere else.
 *
 * Columns from J8.2 (TRAK-125): meet_time, kit, home_away, status and
 * cancel_reason. The sequence number goes up in the database on every change;
 * the app never writes it.
 */
import { calendarFields, displayEventTime, toInstant } from '@/lib/event-time'

export type EventKind = 'training' | 'match' | 'other'
export const EVENT_KINDS: EventKind[] = ['training', 'match', 'other']
export const DURATIONS = [60, 75, 90, 120] as const

export type EventForm = {
  kind: EventKind
  title: string
  date: string       // YYYY-MM-DD
  time: string       // HH:MM kickoff or start, '' while unknown
  duration: number   // minutes
  venue: string
  meetTime: string   // HH:MM, '' when it's the same as the start
  opponent: string
  homeAway: '' | 'home' | 'away'
  kit: string
}

export type EventRow = {
  id: string
  title: string
  event_type: string
  starts_at: string
  ends_at?: string | null
  event_date?: string | null
  start_time?: string | null
  venue?: string | null
  opponent?: string | null
  notes?: string | null
  published: boolean
  meet_time?: string | null
  kit?: string | null
  home_away?: string | null
  status?: string | null
  cancel_reason?: string | null
}

export function blankForm(date: string): EventForm {
  return { kind: 'training', title: '', date, time: '', duration: 90, venue: '', meetTime: '', opponent: '', homeAway: '', kit: '' }
}

const minutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

/** What's wrong with the form in words the coach can act on, or null. */
export function formProblem(form: EventForm): string | null {
  if (!form.date || !toInstant(form.date, form.time || null)) return 'Pick a real date and time'
  if (form.kind === 'match' && !form.opponent.trim()) return 'Add the opponent'
  if (form.kind === 'other' && !form.title.trim()) return 'Say what the event is'
  if (form.meetTime && !form.time) return 'Add the start time before the meet time'
  if (form.meetTime && form.time && minutes(form.meetTime) > minutes(form.time)) return 'Meet time must be before the start'
  return null
}

export function eventTitle(form: EventForm): string {
  const typed = form.title.trim()
  if (typed) return typed
  if (form.kind === 'match') return `vs ${form.opponent.trim()}`
  return 'Training'
}

/** The columns a save writes. Call only when formProblem() is null. */
export function formToRow(form: EventForm) {
  const starts_at = toInstant(form.date, form.time || null)!
  const cal = calendarFields(form.date, form.time || null)!
  const isMatch = form.kind === 'match'
  // A length only means something from a known start. An end past midnight
  // keeps its instant; the wall-clock end is left blank, as the table only
  // accepts an end_time on the same day.
  let ends_at: string | null = null
  let end_time: string | null = null
  if (form.time) {
    ends_at = new Date(new Date(starts_at).getTime() + form.duration * 60_000).toISOString()
    const end = minutes(form.time) + form.duration
    if (end < 24 * 60) end_time = `${String(Math.floor(end / 60)).padStart(2, '0')}:${String(end % 60).padStart(2, '0')}:00`
  }
  return {
    title: eventTitle(form),
    event_type: form.kind,
    starts_at,
    ends_at,
    ...cal,
    end_time,
    venue: form.venue.trim() || null,
    meet_time: form.meetTime ? `${form.meetTime}:00` : null,
    opponent: isMatch ? form.opponent.trim() : null,
    home_away: isMatch && form.homeAway ? form.homeAway : null,
    kit: isMatch ? form.kit.trim() || null : null,
  }
}

/** A saved event back into the form, for editing. */
export function rowToForm(row: EventRow): EventForm {
  const { date, time } = displayEventTime(row)
  const kind: EventKind = row.event_type === 'match' || row.event_type === 'training' ? row.event_type : 'other'
  const duration = row.ends_at && time
    ? Math.round((new Date(row.ends_at).getTime() - new Date(row.starts_at).getTime()) / 60_000)
    : 90
  const autoTitle = kind === 'match' ? `vs ${row.opponent ?? ''}` : kind === 'training' ? 'Training' : ''
  return {
    kind,
    title: row.title === autoTitle ? '' : row.title,
    date,
    time: time ?? '',
    duration: duration > 0 ? duration : 90,
    venue: row.venue ?? '',
    meetTime: row.meet_time ? row.meet_time.slice(0, 5) : '',
    opponent: row.opponent ?? '',
    homeAway: row.home_away === 'home' || row.home_away === 'away' ? row.home_away : '',
    kit: row.kit ?? '',
  }
}

export function cancelPatch(reason: string) {
  return { status: 'cancelled', cancel_reason: reason.trim() || null }
}

export const isCancelled = (row: Pick<EventRow, 'status'>) => row.status === 'cancelled'

/** Delete is only for a mistake nobody has seen: a draft never published. */
export const canDelete = (row: Pick<EventRow, 'published' | 'status'>) => !row.published && !isCancelled(row)

/** The coach's venues, most recently used first, for "pick or add". */
export function savedVenues(rows: Pick<EventRow, 'venue' | 'starts_at'>[]): string[] {
  const seen = new Map<string, { name: string; at: string }>()
  for (const row of rows) {
    const name = row.venue?.trim()
    if (!name) continue
    const key = name.toLowerCase()
    const prior = seen.get(key)
    if (!prior || row.starts_at > prior.at) seen.set(key, { name, at: row.starts_at })
  }
  return [...seen.values()].sort((a, b) => b.at.localeCompare(a.at)).map(v => v.name)
}
