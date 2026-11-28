import { useState, type ReactElement, type ReactNode } from 'react'
import { format, parseISO } from 'date-fns'
import { Link, useLocation } from 'react-router-dom'
import { Ban, CalendarPlus, Check, CircleCheck, CircleDashed, MapPin } from 'lucide-react'
import { Badge } from '@/components/arc/badge/badge'
import { SheetStateContext, type SheetState } from '@/components/trak/event-sheet-state'
import { BottomSheet } from '@/components/arc/bottom-sheet/bottom-sheet'
import { CANCELLED_COLOR } from '@/lib/coach-events'
import { updatedNote } from '@/lib/alert-read-state'
import { academyLine, meetText } from '@/lib/player-events'
import type { StripEvent } from '@/components/trak/WeekStrip'
import { KitAnnouncement } from '@/components/trak/kits/KitAnnouncement'
import { venueParts } from '@/lib/venue-link'

/* TRAK-182 (Imad, 15 Oct): an event opens in Arc's bottom sheet. Imad's 16 Oct
   layout: the opponent (or the session's name) at top left with Home / Away /
   Training ground under it, and the date at top right. Then "Kick-off" over a
   big start time, and the details as spaced rows: meet time, where (Open in
   Maps), kit, note. No status line for an ordinary event: the coach's
   Published button says it. Cancelled, Logged and Draft still show. The role's
   own part (the coach's buttons and Attending, a family's Can't make it) comes
   in as children; "Updated 3h ago" sits under the buttons. TRAK-554 (Kostas, 23 Nov): the coach's "Published" is a
   state, not a button, so it sits at the top right under the date, where the coach's part of the sheet puts it. */
type SheetRole = 'coach' | 'parent' | 'player'


const KIND_NAME: Record<StripEvent['kind'], string> = { training: 'Training', match: 'Match', tournament: 'Tournament', other: 'Event' }

function sheetTitle(event: StripEvent): string {
  if (event.kind === 'match' && event.opponent) return `vs ${event.opponent}`
  return event.title ?? KIND_NAME[event.kind]
}

function sheetPlace(event: StripEvent): string | null {
  if (event.kind === 'match') return event.homeAway === 'home' ? 'Home' : event.homeAway === 'away' ? 'Away' : null
  return event.kind === 'training' ? 'Training ground' : null
}

/** Only what the buttons don't already say: Cancelled, Logged, or the coach's Draft. */
function sheetStatus(event: StripEvent, role: SheetRole): { text: string; tone: 'ok' | 'draft' | 'cancelled' } | null {
  if (event.status === 'cancelled') return { text: 'Cancelled.', tone: 'cancelled' }
  if (event.sessionId) return { text: 'Logged.', tone: 'ok' }
  return role === 'coach' && event.draft ? { text: 'Draft. Only you see this.', tone: 'draft' } : null
}

/** "Kick-off" (or "Starts") over the start time, the sheet's headline. */
function TimeRow({ event }: { event: StripEvent }) {
  // A logged session has no start time of its own; a logged match shows its event's kick-off (TRAK-182).
  if (event.sessionId && !event.time) return null
  // Imad, 23 Oct: the time is this phone's; the academy's own time shows under it only when the clocks differ.
  const academy = academyLine(event)
  return (
    <div>
      <p className="text-[13px] text-ink-2">{event.kind === 'match' ? 'Kick-off' : 'Starts'}</p>
      {event.time
        ? <p className="text-[40px] leading-[1.1] font-medium tracking-[-0.02em] text-ink">{event.time}</p>
        : <p className="text-[17px] text-ink mt-1">Time to be confirmed</p>}
      {event.time && academy && <p className="text-[13px] text-ink-2">{academy}</p>}
    </div>
  )
}

/** An earlier meet time, as a detail rather than a second headline. */
const meetTime = (event: StripEvent) => event.time && event.meetTime && event.meetTime < event.time ? event.meetTime : null

export function EventSheet({ event, role, trigger, squad, children }: {
  event: StripEvent
  role: SheetRole
  trigger: ReactElement
  /** Imad, 24 Oct: for a coach with two squads or more, which squad it's for ("U17", or "All squads"). */
  squad?: string | null
  children?: ReactNode
}) {
  const { pathname } = useLocation()
  const [state, setState] = useState<SheetState>(null)
  const status = sheetStatus(event, role)
  const updated = updatedNote(event)
  const cancelled = event.status === 'cancelled'
  // Decided 16 Oct (TRAK-182): once an event has started, the coach's sheet drops
  // what only mattered before it, the meet time and the note for families.
  const past = role === 'coach' && !!event.startsAt && Date.parse(event.startsAt) <= Date.now()
  const meet = past ? null : meetTime(event)
  // TRAK-225: a pasted Maps link opens that place; the line shows the name without it.
  const venue = event.venue ? venueParts(event.venue) : null
  const rows = ([
    cancelled && event.cancelReason ? ['Reason', event.cancelReason] : null,
    meet ? ['Meet', meetText(event, meet)] : null,
    venue ? ['Where', <>
      {venue.text && <span className="block">{venue.text}</span>}
      {!cancelled && (
        <a href={venue.mapsUrl} target="_blank" rel="noopener noreferrer"
          className="-mb-3 -mt-1.5 inline-flex min-h-11 items-center gap-1.5 text-primary underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-primary rounded-md">
          <MapPin size={14} aria-hidden="true" />Open in Maps
        </a>
      )}
    </>] : null,
    event.kit && !event.kitSnapshot ? ['Kit', event.kit] : null,
    event.familyNote && !past ? ['Note', event.familyNote] : null,
  ] as ([string, ReactNode] | null)[]).filter((row): row is [string, ReactNode] => !!row)
  const Icon = status?.tone === 'cancelled' ? Ban : status?.tone === 'draft' ? CircleDashed : CircleCheck
  const color = status?.tone === 'cancelled' ? CANCELLED_COLOR : status?.tone === 'draft' ? 'rgb(var(--t-ink-2))' : 'rgb(var(--t-success))'

  const date = format(parseISO(event.date), 'EEE d MMM')
  // TRAK-554: the date at top right, and under it "Published" when the coach's part says so.
  const aside = state === 'published' && !cancelled
    ? <span className="grid justify-items-end gap-1.5">{date}<Badge pill tone="success" size="sm" icon={<Check size={12} aria-hidden="true" />}>Published</Badge></span>
    : date
  return (
    <SheetStateContext.Provider value={setState}>
    <BottomSheet trigger={trigger} title={sheetTitle(event)} description={[squad, sheetPlace(event)].filter(Boolean).join(' · ') || undefined}
      aside={aside} detents={[0.62, 0.92]} initialDetent={event.kitSnapshot ? 1 : 0} className="arc">
      <div className="space-y-5 pb-4">
        <TimeRow event={event} />
        {status && (
          <p className="flex items-center gap-2 text-[14px]">
            <Icon size={16} aria-hidden="true" style={{ color }} />
            <span className="font-medium text-ink">{status.text}</span>
          </p>
        )}
        {rows.length > 0 && (
          <dl className="space-y-4 text-[14px]">
            {rows.map(([term, value]) => (
              <div key={term} className="flex gap-4">
                <dt className="w-14 shrink-0 text-ink-3">{term}</dt>
                <dd className="min-w-0 text-ink">{value}</dd>
              </div>
            ))}
          </dl>
        )}
        {event.kitSnapshot && <KitAnnouncement kit={event.kitSnapshot.design} slot={event.kitSnapshot.slot} />}
        {/* Kostas's #310 review: the full page (Add to calendar, every detail) stays one tap away. */}
        {role !== 'coach' && (
          // TRAK-182: the page's Back returns here in one step.
          <Link to={`/${role}/event/${event.id}`} state={{ from: pathname }}
            className="inline-flex min-h-11 items-center gap-2 text-[14px] text-primary focus-visible:ring-2 focus-visible:ring-primary rounded-md">
            <CalendarPlus size={16} aria-hidden="true" />Open event page
          </Link>
        )}
        {children}
        {/* The coach's sheet places this between its buttons and Attending. */}
        {role !== 'coach' && updated && <p className="text-[13px] text-ink-2">{updated}</p>}
      </div>
    </BottomSheet>
    </SheetStateContext.Provider>
  )
}
