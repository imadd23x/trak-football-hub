import { draftClashes, isCancelled, type EventRow } from '@/lib/coach-events'
import { hasStarted, registerProblem } from '@/lib/event-register'
import { phoneEventTime } from '@/lib/event-time'
import { fullTime } from '@/lib/games/loop'

/* TRAK-262 (Imad, 22 Oct): coach Home's week in Tarek's colour key (TRAK-255).
   The type is a colour; the state is a shape: a draft is dashed and only the
   coach sees it, a draft that would clash with a live event is red, a published
   event is solid, a cancelled one is a hollow red ring. Anything waiting for
   the coach is amber, by the same rule as Schedule's corner: a published event
   that has started with no register (training, other) or no match log (match).
   Each event offers one next step; Details opens the event sheet for the rest. TRAK-288: where Games is on, a match
   is evaluated from full time on its game page instead of logged. */

export type WeekState = 'draft' | 'clash' | 'published' | 'needs-you' | 'logged' | 'cancelled'
export type NextStep = 'publish' | 'share' | 'register' | 'log' | 'view' | 'evaluate' | 'publish-evaluation' | 'review'

/** A completed session: a logged training or match, linked to its event or not. */
export type WeekSession = {
  id: string
  event_id: string | null
  title: string | null
  session_type: string | null
  session_date: string | null
  venue: string | null
  squad: string | null
}

export interface WeekItem {
  id: string
  date: string
  kind: 'training' | 'match' | 'other'
  title: string
  /** "18:00", or null when there's no time to show. */
  time: string | null
  state: WeekState
  /** One quiet line: "Only you see it", "Clashes with vs Ajax 17:00–18:30". */
  note: string
  step: NextStep | null
  /** What the event sheet reads: the event's row, or the session shaped like one. */
  source: Record<string, unknown>
  sessionId?: string
  row?: EventRow
}

/** Imad, 24 Oct: which squad an event is for; no squad is the whole roster. */
export const squadName = (squad: unknown) => typeof squad === 'string' && squad ? squad : 'All squads'

const kindOf = (type: string | null | undefined): WeekItem['kind'] =>
  type === 'match' || type === 'training' ? type : 'other'

/** The week's items by date, in time order. `inView` is the squad filter; clashes count every squad, as the database does. */
export function coachWeek({ dates, events, sessions, inView, now = new Date(), evaluated = null, published }: {
  dates: string[]
  events: EventRow[]
  sessions: WeekSession[]
  inView: (squad: string | null | undefined) => boolean
  now?: Date
  /** TRAK-288: where Games is on, the matches with an evaluation draft; null where it's off. */
  evaluated?: Set<string> | null
  /** TRAK-289: the matches whose evaluation is published: their session opens the review, never the old log. */
  published?: Set<string>
}): Map<string, WeekItem[]> {
  const clashes = draftClashes(events)
  const done = new Set(sessions.map(s => s.event_id).filter(Boolean))
  const planned = new Map(events.map(e => [e.id, e]))
  const items: WeekItem[] = []

  for (const row of events) {
    // A logged event shows once, as its session.
    if (done.has(row.id) || !inView(row.squad) || !row.event_date) continue
    const kind = kindOf(row.event_type)
    // Imad, 23 Oct: the day and time on this phone's clock.
    const { date, time } = phoneEventTime(row)
    const base = { id: row.id, date, kind, title: row.title, time, source: row, row }
    const clash = clashes.get(row.id)
    if (isCancelled(row)) items.push({ ...base, state: 'cancelled', note: 'Cancelled', step: null })
    else if (!row.published && clash) items.push({ ...base, state: 'clash', note: `Clashes with ${clash.title} ${clash.start}–${clash.end}`, step: null })
    else if (!row.published) items.push({ ...base, state: 'draft', note: 'Draft · only you see it', step: 'publish' })
    else if (!hasStarted(row, now)) items.push({ ...base, state: 'published', note: 'Published', step: 'share' })
    else if (kind === 'match' && evaluated) {
      if (now.getTime() < fullTime({ ...row, ends_at: row.ends_at ?? null })) items.push({ ...base, state: 'published', note: 'Published', step: null })
      else if (evaluated.has(row.id)) items.push({ ...base, state: 'needs-you', note: 'Evaluation draft', step: 'publish-evaluation' })
      else items.push({ ...base, state: 'needs-you', note: 'Evaluate the match', step: 'evaluate' })
    }
    else if (kind === 'match') items.push({ ...base, state: 'needs-you', note: 'Log the match', step: 'log' })
    else if (!registerProblem(row, now)) items.push({ ...base, state: 'needs-you', note: 'Take the register', step: 'register' })
    else items.push({ ...base, state: 'published', note: 'Published', step: null })
  }

  for (const session of sessions) {
    if (!session.session_date || !dates.includes(session.session_date) || !inView(session.squad)) continue
    // TRAK-182 (live run 3): a logged match keeps its event's kick-off, venue and kit while the date is the event's.
    const linked = session.event_id ? planned.get(session.event_id) : undefined
    const event = session.session_type === 'match' && linked?.event_date === session.session_date ? linked : undefined
    const kind = kindOf(session.session_type)
    const source = {
      ...(event && { start_time: event.start_time, starts_at: event.starts_at, kit: event.kit, kit_snapshot: event.kit_snapshot,
        opponent: event.opponent, home_away: event.home_away, venue: event.venue }),
      id: `session:${session.id}`, published: true, title: session.title || 'Session', event_date: session.session_date, squad: session.squad,
      ...(session.venue && { venue: session.venue }), event_type: kind,
    }
    const reviewed = !!session.event_id && !!published?.has(session.event_id)
    items.push({
      id: source.id, date: session.session_date, kind, title: source.title, time: event ? phoneEventTime(event).time : null,
      state: 'logged', note: reviewed ? 'Published' : 'Logged', step: reviewed ? 'review' : 'view', source, sessionId: session.id,
      ...(reviewed && linked && { row: linked }),
    })
  }

  const byDate = new Map(dates.map(date => [date, [] as WeekItem[]]))
  for (const item of items) byDate.get(item.date)?.push(item)
  for (const list of byDate.values()) list.sort((a, b) => (a.time ?? '99').localeCompare(b.time ?? '99'))
  return byDate
}
