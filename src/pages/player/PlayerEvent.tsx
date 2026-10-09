import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'
import { supabase } from '@/integrations/supabase/client'
import { useAuth } from '@/contexts/AuthContext'
import { MobileShell, NavBar, LoadError } from '@/components/trak'
import { eventDay, eventHeading, eventTime, markEventOpened, toPlayerEvent, type PlayerEvent as Event } from '@/lib/player-events'

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
    const e = current.event
    const cancelled = e.status === 'cancelled'
    const rows: [string, string][] = [
      ['Date', eventDay(e)],
      ['Time', eventTime(e)],
      ...(e.meetTime ? [['Meet', e.meetTime] as [string, string]] : []),
      ...(e.venue ? [['Venue', e.venue] as [string, string]] : []),
      ...(e.kind === 'match' && e.homeAway ? [['Home or away', e.homeAway === 'home' ? 'Home' : 'Away'] as [string, string]] : []),
      ...(e.kind === 'match' && e.kit ? [['Kit', e.kit] as [string, string]] : []),
    ]
    body = (
      <div className="space-y-4">
        <h1 className={`text-[22px] font-medium ${cancelled ? 'line-through text-white/50' : 'text-white/90'}`}>{eventHeading(e)}</h1>
        {cancelled && (
          <div className="rounded-[14px] px-4 py-3" style={{ border: '1px solid hsl(var(--destructive) / 0.5)' }}>
            <p className="text-[13px] font-semibold text-destructive">This event is cancelled.</p>
            {e.cancelReason && <p className="text-[13px] text-white/70 mt-1">{e.cancelReason}</p>}
          </div>
        )}
        <ul aria-label="Event details" className="rounded-[18px] divide-y divide-white/[0.06]"
          style={{ background: '#101012', border: '1px solid rgba(255,255,255,0.06)' }}>
          {rows.map(([label, value]) => (
            <li key={label} className="flex justify-between gap-4 px-4 py-3 text-[13px]">
              <span className="text-white/45">{label}</span>
              <span className="text-white/85 text-right">{value}</span>
            </li>
          ))}
        </ul>
      </div>
    )
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
