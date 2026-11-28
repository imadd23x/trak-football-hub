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
import { useFamilyLook } from '@/components/trak/FamilyFrame'
import { FamilyMatch } from '@/components/player/FamilyMatch'
import { useSeenOnOpen } from '@/lib/tasks'
import { TrainingPlan } from '@/components/player/TrainingPlan'
import { dateLocale, useTranslation } from '@/lib/i18n'
import { format, parseISO } from 'date-fns'

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
  const look = useFamilyLook()
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
  // TRAK-580: opening it records that they saw the coach's latest change. This device may not have the old version
  // to say what moved, so the page says when the coach changed it (a cancellation says so itself).
  const { t } = useTranslation()
  const sawChange = useSeenOnOpen(current?.event ? id : undefined)
  const updatedAt = current?.event?.status === 'scheduled' ? current.event.updatedAt : null
  const changes = current?.changes.length || !sawChange || !updatedAt ? current?.changes ?? []
    : [t('common:coachChangedOn', { day: format(parseISO(updatedAt), 'EEE d MMM', { locale: dateLocale() }) })]
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
      <EventDetails event={current.event} changes={changes} />
      <TrainingPlan event={current.event} />
      {/* TRAK-289: once the coach publishes, After the game, with the coach's note to them. */}
      {user && <SharedGameReview event={current.event} childId={user.id} childName="" as="player" />}
      {/* TRAK-286: the coach's game plan, once shared: the goals, their job and the note to them. */}
      {user && <SharedGamePlan event={current.event} childId={user.id} childName="" as="player" />}
      {forThemselves && user && <CantMakeIt event={current.event} child={{ id: user.id, name: 'you' }} self />}
    </>
  }

  // TRAK-441 slices 3.3 and 7, behind family_look: the coach's page header; a match's has tabs, any other event's is Logistics.
  const inLook = look && user && current?.event ? current.event : null
  return (
    <MobileShell width={inLook ? 'wide' : 'page'}>
      {inLook ? <div className="pb-28"><FamilyMatch event={inLook} changes={changes} child={{ id: user!.id, name: '' }} as="player" back={backTo}
        cantMakeIt={forThemselves && <CantMakeIt event={inLook} child={{ id: user!.id, name: 'you' }} self />}>
        <TrainingPlan event={inLook} />
      </FamilyMatch></div>
        : <div className="pt-12 pb-28 space-y-5">
          {back}
          {body}
        </div>}
      <NavBar role="player" activeTab="/player/matches" onNavigate={navigate} />
    </MobileShell>
  )
}
