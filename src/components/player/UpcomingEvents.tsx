import { useEffect, useState } from 'react'
import { supabase } from '@/integrations/supabase/client'
import { MetadataLabel, LoadError } from '@/components/trak'
import { isChanged, noteEventsShown, readSeenSequences, toPlayerEvent, upcomingEventsFilter, type PlayerEvent } from '@/lib/player-events'
import { UpcomingEventCard } from './UpcomingEventCard'
import { fetchSharedPlans, planBadge } from '@/lib/games/shared-plans'
import { fetchReviews } from '@/lib/games/reviews'
import { SeeMoreList } from '@/components/trak/SeeMoreList'

/**
 * The Sessions tab's "Upcoming" list (TRAK-130). The database returns only
 * this player's squad's published events; a failed read says so and offers a
 * retry, never an empty schedule.
 */
export function UpcomingEvents({ playerUserId }: { playerUserId: string }) {
  const [events, setEvents] = useState<PlayerEvent[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    setFailed(false)
    // Through child_events (TRAK-164), the family read path with the reason rule.
    supabase.rpc('child_events', { p_child: playerUserId })
      .or(upcomingEventsFilter())
      .order('event_date', { ascending: true, nullsFirst: false })
      .order('starts_at', { ascending: true })
      .limit(20)
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) { setFailed(true); return }
        setEvents((data ?? []).map(r => toPlayerEvent(r as Record<string, unknown>)).filter((e): e is PlayerEvent => e !== null))
      })
    return () => { cancelled = true }
  }, [playerUserId, reloadKey])

  // TRAK-286: which matches have a shared plan. A failed read only leaves the badges off.
  const [plans, setPlans] = useState<Map<string, boolean>>(new Map())
  // TRAK-289: and which have the coach's review.
  const [reviewed, setReviewed] = useState<Set<string>>(new Set())
  useEffect(() => {
    const abort = new AbortController()
    fetchSharedPlans(playerUserId, true, abort.signal).then(setPlans, () => {})
    fetchReviews(playerUserId, abort.signal).then(reviews => setReviewed(reviews.events), () => {})
    return () => abort.abort()
  }, [playerUserId, reloadKey])

  // Shown is recorded after render; the read below is the state before it.
  const seen = readSeenSequences(playerUserId)
  useEffect(() => { if (events) noteEventsShown(playerUserId, events) }, [events, playerUserId])

  return (
    <section aria-label="Upcoming" className="mb-5">
      <MetadataLabel text="UPCOMING" />
      <div className="mt-2.5 space-y-2">
        {failed ? (
          <LoadError what="upcoming events" onRetry={() => setReloadKey(k => k + 1)} />
        ) : events === null ? (
          <p className="text-[12px] text-ink-3">Loading…</p>
        ) : events.length === 0 ? (
          <p className="text-[12px] text-ink-3">Nothing scheduled yet.</p>
        ) : (
          <SeeMoreList items={events} render={e => <UpcomingEventCard key={e.id} event={e} changed={isChanged(e, seen)}
            plan={reviewed.has(e.id) ? 'review' : planBadge(plans.get(e.id), e)} />} />
        )}
      </div>
    </section>
  )
}
