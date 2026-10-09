import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'
import { supabase } from '@/integrations/supabase/client'
import { useAuth } from '@/contexts/AuthContext'
import { MobileShell, NavBar, LoadError } from '@/components/trak'
import { markEventOpened, toPlayerEvent, type PlayerEvent as Event } from '@/lib/player-events'
import { EventDetails } from '@/components/player/EventDetails'

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
  const [reloadKey, setReloadKey] = useState(0)
  const [result, setResult] = useState<{ id: string; reloadKey: number; event: Event | null; failed: boolean } | null>(null)

  useEffect(() => {
    let cancelled = false
    setResult(null)
    if (!id || !user) return
    supabase.from('coach_calendar_events').select('*').eq('id', id).eq('published', true).maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return
        const event = data ? toPlayerEvent(data as Record<string, unknown>) : null
        if (event) markEventOpened(user.id, event)
        setResult({ id, reloadKey, event, failed: Boolean(error) })
      })
    return () => { cancelled = true }
  }, [id, user, reloadKey])

  const current = result && result.id === id && result.reloadKey === reloadKey ? result : null
  const back = (
    <button type="button" onClick={() => navigate('/player/matches')}
      className="flex items-center gap-1 text-[13px] text-white/50">
      <ChevronLeft size={16} /> Sessions
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
    body = <p className="text-[13px] text-white/60">This event isn't available. Your coach may have removed it.</p>
  } else {
    body = <EventDetails event={current.event} />
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
