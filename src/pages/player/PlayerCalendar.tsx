import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { format, endOfMonth, startOfMonth } from 'date-fns'
import { ChevronLeft } from 'lucide-react'
import { supabase } from '@/integrations/supabase/client'
import { useAuth } from '@/contexts/AuthContext'
import { MobileShell, NavBar, LoadError } from '@/components/trak'
import { Calendar } from '@/components/arc/calendar/calendar'
import { DayEvents, type StripEvent } from '@/components/trak/WeekStrip'
import { EventSheet } from '@/components/trak/EventSheet'
import { CantMakeIt } from '@/components/parent/CantMakeIt'
import { CANCELLED_COLOR, EVENT_COLOR } from '@/lib/coach-events'
import { toPlayerEvent } from '@/lib/player-events'
import { SeenOnOpen } from '@/lib/tasks'
import { PlanInSheet } from '@/components/player/TrainingPlan'

const day = (date: Date) => format(date, 'yyyy-MM-dd')

/**
 * TRAK-171 (live run 3, Tarek; Imad agreed): the player's calendar button
 * opens a month calendar of their own events, like the coach's, instead of a
 * second door into Sessions. Read through child_events (TRAK-164), the family
 * read path. A failed read is an error with Retry, never an empty month.
 */
export default function PlayerCalendar() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [selected, setSelected] = useState(() => day(new Date()))
  const [month, setMonth] = useState(() => startOfMonth(new Date()))
  const [attempt, setAttempt] = useState(0)
  const [loaded, setLoaded] = useState<{ month: string; events: StripEvent[] } | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!user) return
    let stale = false
    setFailed(false)
    supabase.rpc('child_events', { p_child: user.id })
      .gte('event_date', day(month)).lte('event_date', day(endOfMonth(month))).order('event_date', { ascending: true })
      .then(({ data, error }) => {
        if (stale) return
        if (error) { setFailed(true); return }
        const events = ((data ?? []) as Record<string, unknown>[]).map(toPlayerEvent).filter((e): e is StripEvent => e !== null)
        setLoaded({ month: day(month), events })
      })
    return () => { stale = true }
  }, [user, month, attempt])

  // TRAK-183: at or above their academy's consent age, a player says "Can't make it" for themselves,
  // as on Home, once their consent is in place (no button that can only fail).
  const consent = useQuery({
    queryKey: ['player', 'consent-status', user?.id],
    enabled: Boolean(user),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('my_consent_status' as never)
      if (error) throw error
      return data as { required?: boolean; age?: number | null; consent_age?: number | null } | null
    },
  })
  const forThemselves = consent.data?.required === false && consent.data.age != null && consent.data.consent_age != null
    && consent.data.age >= consent.data.consent_age

  const events = loaded?.month === day(month) ? loaded.events : null
  const onDay = (date: string) => (events ?? []).filter(e => e.date === date).sort((a, b) => (a.time ?? '99').localeCompare(b.time ?? '99'))

  return (
    <MobileShell>
      <div className="pt-3 pb-24 space-y-4">
        <Link to="/player/home" className="inline-flex min-h-11 items-center gap-1 text-[13px] text-ink-2 focus-visible:ring-2 focus-visible:ring-primary rounded-md">
          <ChevronLeft size={16} aria-hidden="true" /> Home
        </Link>
        <h1 className="text-[22px] font-medium tracking-[-0.01em] text-ink">Calendar</h1>
        {failed ? <LoadError what="your calendar" onRetry={() => setAttempt(n => n + 1)} /> : <>
          <div className="arc rounded-2xl border border-line overflow-hidden flex justify-center px-3 pt-2" style={{ background: 'rgb(var(--t-surface))' }}>
            <Calendar locale="en-GB" showToday value={new Date(`${selected}T12:00:00`)} onChange={date => setSelected(day(date))}
              month={month} onMonthChange={next => setMonth(startOfMonth(next))}
              marks={date => onDay(day(date)).map(e => e.status === 'cancelled' ? { color: CANCELLED_COLOR, hollow: true } : EVENT_COLOR[e.kind])} />
          </div>
          <section aria-label="Day" className="arc">
            {events
              ? <DayEvents day={selected} events={onDay(selected)} renderSheet={(event, trigger) => (
                  <EventSheet event={event} role="player" trigger={trigger}>
                    <SeenOnOpen eventId={event.id} />
                    <PlanInSheet event={event} />
                    {forThemselves && user && <CantMakeIt event={event} child={{ id: user.id, name: 'you' }} self />}
                  </EventSheet>
                )} />
              : <p role="status" className="text-[13px] text-ink-3 py-2">Loading…</p>}
          </section>
        </>}
      </div>
      <NavBar role="player" activeTab="/player/home" onNavigate={navigate} />
    </MobileShell>
  )
}
