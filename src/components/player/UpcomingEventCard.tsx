import { Link } from 'react-router-dom'
import { eventDay, eventHeading, eventTime, type PlayerEvent } from '@/lib/player-events'
// The coach calendar's colours (TRAK-159, founders 12 Oct): one constant everywhere.
import { CANCELLED_COLOR, EVENT_COLOR } from '@/lib/coach-events'
import { withAlpha } from '@/lib/with-alpha'
import { Badge } from '@/components/arc/badge/badge'

/**
 * One upcoming event (TRAK-130). `nextUp` is the home card; otherwise a row
 * in the Sessions tab's list. Either opens the event page.
 */
export function UpcomingEventCard({ event, changed, nextUp = false, linkBase = '/player/event', plan = null }: {
  event: PlayerEvent
  changed: boolean
  nextUp?: boolean
  /** The event page's route; parents open /parent/event (J8.8). */
  linkBase?: string
  /** TRAK-286: the coach shared a game plan, or a later share changed it for this reader (planBadge). TRAK-289: or
   *  published their review of the game, which says so instead. */
  plan?: 'shared' | 'updated' | 'review' | null
}) {
  const cancelled = event.status === 'cancelled'
  const heading = eventHeading(event)
  const where = [event.meetTime ? `Meet ${event.meetTime}` : null, event.venue].filter(Boolean).join(' · ')
  return (
    <Link
      to={`${linkBase}/${event.id}`}
      aria-label={nextUp ? `Next up: ${heading}` : undefined}
      className="flex items-stretch gap-3 rounded-[14px] p-3.5"
      style={{ background: 'rgb(var(--t-surface))', border: `1px solid ${cancelled ? `${withAlpha(CANCELLED_COLOR, 0.5)}` : 'rgb(var(--t-line))'}` }}
    >
      <div className="w-1 rounded-full flex-shrink-0" style={{ background: cancelled ? CANCELLED_COLOR : EVENT_COLOR[event.kind] }} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          {cancelled && <span className="text-[10px] font-semibold text-danger">Cancelled</span>}
          {changed && <span className="text-[10px] font-semibold text-brand">Changed</span>}
          {plan && !cancelled && <span className="arc"><Badge size="sm" tone={plan === 'updated' ? 'info' : 'success'}>
            {plan === 'review' ? 'Coach’s review' : plan === 'updated' ? 'Updated' : 'Plan shared'}</Badge></span>}
        </div>
        <p className={`text-[13px] font-medium truncate ${cancelled ? 'line-through text-ink-2' : 'text-ink'}`}>{heading}</p>
        <p className="text-[11px] mt-0.5 text-ink-2">{eventDay(event)} · {eventTime(event)}</p>
        {where && <p className="text-[11px] text-ink-3 truncate">{where}</p>}
        {event.kind === 'match' && event.kit && <p className="text-[11px] text-ink-3">Kit: {event.kit}</p>}
        {cancelled && event.cancelReason && <p className="text-[11px] text-danger">{event.cancelReason}</p>}
      </div>
    </Link>
  )
}
