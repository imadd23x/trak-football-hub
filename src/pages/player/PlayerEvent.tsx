import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'
import { supabase } from '@/integrations/supabase/client'
import { useAuth } from '@/contexts/AuthContext'
import { MobileShell, NavBar, LoadError } from '@/components/trak'
import { changesSinceSeen, markEventOpened, toPlayerEvent, type PlayerEvent as Event } from '@/lib/player-events'
import { EventDetails } from '@/components/player/EventDetails'
import { CantMakeIt } from '@/components/parent/CantMakeIt'
import { SharedGamePlan } from '@/components/player/SharedGamePlan'
import { SharedGameReview } from '@/components/player/SharedGameReview'
import { useEventBack } from '@/lib/event-back'

/**
 * The event page (TRAK-130, J8.7): every detail of one of the squad's events.
 * Opening it clears "Changed". The database decides whether the player may
 * read it (their squad, published, consent active); anything else reads as
 * not available, and a failed read offers a retry.
 */
export default function PlayerEvent() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const backTo = useEventBack('/player/matches')
  const [reloadKey, setReloadKey] = useState(0)
  const [result, setResult] = useState<{ id: string; reloadKey: number; event: Event | null; failed: boolean; changes: string[] } | null>(null)

  useEffect(() => {
    let cancelled = false
    setResult(null)
    if (!id || !user) return
    // Through child_events (TRAK-164), the family read path with the reason rule.
    supabase.rpc('child_events', { p_child: user.id }).eq('id', id).maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return
        const event = data ? toPlayerEvent(data as Record<string, unknown>) : null
        // TRAK-134: what moved, read before opening it marks it seen.
        const changes = event ? changesSinceSeen(user.id, event) : []
        if (event) markEventOpened(user.id, event)
        setResult({ id, reloadKey, event, failed: Boolean(error), changes })
      })
    return () => { cancelled = true }
  }, [id, user, reloadKey])

  // TRAK-183: at or above their academy's consent age, a player says "Can't
  // make it" for themselves, as a guardian does. A failed check shows nothing.
  const consent = useQuery({
    queryKey: ['player', 'consent-status', user?.id],
    enabled: Boolean(user),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('my_consent_status' as never)
      if (error) throw error
      return data as { age?: number | null; consent_age?: number | null } | null
    },
  })
  const forThemselves = consent.data?.age != null && consent.data.consent_age != null && consent.data.age >= consent.data.consent_age

  const current = result && result.id === id && result.reloadKey === reloadKey ? result : null
  const back = (
    <button type="button" onClick={backTo.go}
      className="flex items-center gap-1 text-[13px] text-ink-2">
      <ChevronLeft size={16} /> {backTo.label}
    </button>
  )

  let body: JSX.Element
  if (!current) {
    body = (
      <div className="flex items-center justify-center h-[50vh]" role="status" aria-label="Loading event">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    )
  } else if (current.failed) {
    body = <LoadError what="this event" onRetry={() => setReloadKey(k => k + 1)} />
  } else if (!current.event) {
    body = <p className="text-[13px] text-ink-2">This event isn't available. Your coach may have removed it.</p>
  } else {
    body = <>
      <EventDetails event={current.event} changes={current.changes} />
      {/* TRAK-289: once the coach publishes, After the game, with the coach's note to them. */}
      {user && <SharedGameReview event={current.event} childId={user.id} childName="" as="player" />}
      {/* TRAK-286: the coach's game plan, once shared: the goals, their job and the note to them. */}
      {user && <SharedGamePlan event={current.event} childId={user.id} childName="" as="player" />}
      {forThemselves && user && <CantMakeIt event={current.event} child={{ id: user.id, name: 'you' }} self />}
    </>
  }

  return (
    <MobileShell>
      <div className="pt-12 pb-28 space-y-5">
        {back}
        {body}
      </div>
      <NavBar role="player" activeTab="/player/matches" onNavigate={navigate} />
    </MobileShell>
  )
}
