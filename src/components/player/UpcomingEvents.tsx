import { useEffect, useState } from 'react'
import { supabase } from '@/integrations/supabase/client'
import { MetadataLabel, LoadError } from '@/components/trak'
import { isChanged, noteEventsShown, readSeenSequences, toPlayerEvent, upcomingEventsFilter, type PlayerEvent } from '@/lib/player-events'
import { UpcomingEventCard } from './UpcomingEventCard'

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
    supabase.from('coach_calendar_events').select('*')
      .eq('published', true)
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
          <p className="text-[12px] text-white/35">Loading…</p>
        ) : events.length === 0 ? (
          <p className="text-[12px] text-white/45">Nothing scheduled yet.</p>
        ) : (
          events.map(e => <UpcomingEventCard key={e.id} event={e} changed={isChanged(e, seen)} />)
        )}
      </div>
    </section>
  )
}
