import { format, parseISO } from 'date-fns'
import { displayEventTime } from './event-time'

/**
 * What a player sees of their squad's events (J8.7, TRAK-130).
 *
 * Rows come from coach_calendar_events, which the database already limits to
 * the player's own squad's published events. J8.2 (TRAK-125) adds the
 * columns below; they are named only here, so if J8.2 settles on different
 * names this is the one place to change. Until J8.2 lands they are absent,
 * and every event reads as scheduled, sequence 0.
 */
export const EVENT_COLUMNS = {
  meetTime: 'meet_time',
  kit: 'kit',
  homeAway: 'home_away',
  status: 'status',
  cancelReason: 'cancel_reason',
  sequence: 'sequence',
} as const

export type EventKind = 'training' | 'match' | 'tournament' | 'other'

export interface PlayerEvent {
  id: string
  kind: EventKind
  title: string | null
  /** YYYY-MM-DD, the day the coach chose. */
  date: string
  /** HH:MM as the coach typed it, or null while not known. */
  time: string | null
  meetTime: string | null
  venue: string | null
  kit: string | null
  opponent: string | null
  homeAway: 'home' | 'away' | null
  status: 'scheduled' | 'cancelled'
  cancelReason: string | null
  /** Goes up on every change the coach makes (J8.2). */
  sequence: number
}

export const EVENT_KIND_LABEL: Record<EventKind, string> = {
  training: 'Training',
  match: 'Match',
  tournament: 'Tournament',
  other: 'Event',
}

const KINDS = new Set<EventKind>(['training', 'match', 'tournament', 'other'])
const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)
const clock = (v: unknown): string | null => (typeof v === 'string' && /^\d{2}:\d{2}/.test(v) ? v.slice(0, 5) : null)

export function toPlayerEvent(row: Record<string, unknown>): PlayerEvent | null {
  const shown = displayEventTime({
    event_date: row.event_date as string | null,
    start_time: row.start_time as string | null,
    starts_at: row.starts_at as string | null,
  })
  if (!shown.date || typeof row.id !== 'string') return null
  const kind = KINDS.has(row.event_type as EventKind) ? (row.event_type as EventKind) : 'other'
  const homeAway = row[EVENT_COLUMNS.homeAway]
  const sequence = Number(row[EVENT_COLUMNS.sequence])
  return {
    id: row.id,
    kind,
    title: text(row.title),
    date: shown.date,
    time: shown.time,
    meetTime: clock(row[EVENT_COLUMNS.meetTime]),
    venue: text(row.venue),
    kit: text(row[EVENT_COLUMNS.kit]),
    opponent: text(row.opponent),
    homeAway: homeAway === 'home' || homeAway === 'away' ? homeAway : null,
    status: row[EVENT_COLUMNS.status] === 'cancelled' ? 'cancelled' : 'scheduled',
    cancelReason: text(row[EVENT_COLUMNS.cancelReason]),
    sequence: Number.isInteger(sequence) && sequence > 0 ? sequence : 0,
  }
}

/**
 * PostgREST filter for "from today on". An untimed event is stored at local
 * midnight, so filtering on the instant would drop it from its own day the
 * moment the clock passed 00:00; the calendar day decides, with the instant
 * as the fallback for rows written before event_date existed.
 */
export function upcomingEventsFilter(now: Date = new Date()): string {
  return `event_date.gte.${now.toLocaleDateString('en-CA')},and(event_date.is.null,starts_at.gte.${now.toISOString()})`
}

/** "Match vs Rivals FC (away)", the coach's title, or the type. */
export function eventHeading(event: PlayerEvent): string {
  if (event.kind === 'match' && event.opponent) {
    return `Match vs ${event.opponent}${event.homeAway ? ` (${event.homeAway})` : ''}`
  }
  return event.title?.trim() || EVENT_KIND_LABEL[event.kind]
}

/** "Sat 14 Nov", from the calendar day itself. */
export const eventDay = (event: PlayerEvent) => format(parseISO(event.date), 'EEE d MMM')
/** The coach's time, or "Time to be confirmed": never midnight. */
export const eventTime = (event: PlayerEvent) => event.time ?? 'Time to be confirmed'

// ── "Changed" until opened ──────────────────────────────────────────────────
// Per device, like the parent bell (ParentAlertsBell): for each event, the
// change sequence this player has seen. An event seen for the first time sets
// its baseline, so it is never "Changed" to someone who never saw the old
// version. Opening the event page moves the baseline to the current sequence.

const seenKey = (userId: string) => `trak:player-events-seen:${userId}`

export function readSeenSequences(userId: string): Record<string, number> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(seenKey(userId)) ?? '{}')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, number>) : {}
  } catch {
    return {}
  }
}

function writeSeen(userId: string, seen: Record<string, number>) {
  try { localStorage.setItem(seenKey(userId), JSON.stringify(seen)) } catch { /* storage unavailable */ }
}

/** Record a baseline for events shown for the first time; returns the seen map. */
export function noteEventsShown(userId: string, events: PlayerEvent[]): Record<string, number> {
  const seen = readSeenSequences(userId)
  let added = false
  for (const e of events) {
    if (seen[e.id] === undefined) { seen[e.id] = e.sequence; added = true }
  }
  if (added) writeSeen(userId, seen)
  return seen
}

export function markEventOpened(userId: string, event: PlayerEvent) {
  const seen = readSeenSequences(userId)
  seen[event.id] = Math.max(seen[event.id] ?? 0, event.sequence)
  writeSeen(userId, seen)
}

export function isChanged(event: PlayerEvent, seen: Record<string, number>): boolean {
  if (event.status === 'cancelled') return false
  const baseline = seen[event.id]
  return baseline !== undefined && event.sequence > baseline
}
