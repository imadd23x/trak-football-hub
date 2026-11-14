import { useEffect, useRef, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { supabase } from '@/integrations/supabase/client'
import { useAuth } from '@/contexts/AuthContext'
import { MobileShell, NavBar, MetadataLabel, LoadError } from '@/components/trak'
import { CardSkeleton, MatchCardSkeleton, Skeleton } from '@/components/trak'
import { toPlayerEvent, upcomingEventsFilter, type PlayerEvent } from '@/lib/player-events'
import { PlayerHomeBell, type PublishedAssessmentAlert } from '@/components/player/PlayerAlertsBell'
import { HomeHeader, HomeTitle } from '@/components/trak/HomeHeader'
import { FrameActions, useFamilyLook } from '@/components/trak/FamilyFrame'
import { ForYou } from '@/components/trak/ForYou'
import { Avatar } from '@/components/arc/avatar/avatar'
import { LoadedWeekStrip } from '@/components/trak/WeekStrip'
import { EventSheet } from '@/components/trak/EventSheet'
import { CantMakeIt, CantMakeItButton } from '@/components/parent/CantMakeIt'
import { CalendarHomePrompt } from '@/components/trak/AddToCalendar'
import { trackEvent } from '@/lib/telemetry'
import { PlayerParentInviteCard } from '@/components/player/PlayerParentInviteCard'
import { OwnConsentCard } from '@/components/player/OwnConsentCard'
import { MySeasonCard } from '@/components/player/MySeasonCard'
import { LatestEvaluation } from '@/components/player/LatestEvaluation'
import { SeasonSoFar } from '@/components/player/SeasonSoFar'
import { ParentAssessmentCarousel } from '@/components/parent/ParentAssessmentCarousel'
import { progressSummary, useEvaluationProgress } from '@/lib/evaluation-progress'
import { useMySeason } from '@/lib/my-season'


export default function PlayerHome() {
  const { user, profile } = useAuth()
  const look = useFamilyLook()
  const navigate = useNavigate()
  const location = useLocation()
  const [loading, setLoading] = useState(true)
  const [details, setDetails] = useState<any>(null)
  const [coachAssessment, setCoachAssessment] = useState<any>(null)
  // TRAK-172 (Imad, 19 Oct): the latest five, as the parent's swipe cards. Set and cleared with coachAssessment.
  const [recentAssessments, setRecentAssessments] = useState<any[]>([])
  const [coachName, setCoachName] = useState('')
  const [upcomingEvents, setUpcomingEvents] = useState<PlayerEvent[]>([])
  type ConsentStatus = { required: boolean; invited_parent: string | null; age?: number | null
    consent_age?: number; threshold?: number; own_choice?: boolean | null }
  const [consent, setConsent] = useState<ConsentStatus | null>(null)
  const [consentReload, setConsentReload] = useState(0)
  const [choseHere, setChoseHere] = useState(false)
  // TRAK-177: from the academy's consent age (15 in Greece) until 18 the player decides.
  const decidesForSelf = consent?.age != null && consent.consent_age != null
    && consent.age >= consent.consent_age && consent.age < (consent.threshold ?? 18)
  // TRAK-183: from the consent age (18 included) a player says Can't make it
  // themselves, once their consent is in place (no button that can only fail).
  const reportsForSelf = consent?.required === false && consent.age != null && consent.consent_age != null
    && consent.age >= consent.consent_age

  // Under the digital-consent age nothing can be recorded about this player
  // until a parent approves. Without this they would sign in to a dashboard
  // that stays permanently empty with no explanation — the same false-empty
  // state the parent screens suffer from.
  useEffect(() => {
    if (!user) return
    let cancelled = false
    // `as any`: generated types predate the consent migration.
    ;(supabase.rpc as any)('my_consent_status').then(({ data }: { data: unknown }) => {
      if (cancelled) return
      setConsent(data as ConsentStatus | null)
    })
    return () => { cancelled = true }
  }, [user, consentReload])

  const [coachAssessmentNote, setCoachAssessmentNote] = useState<string | null>(null)
  const [assessmentAlert, setAssessmentAlert] = useState<PublishedAssessmentAlert | null>(null)
  // A failed feedback read must not look like "no feedback yet".
  const [feedbackLoadFailed, setFeedbackLoadFailed] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)
  // T4 — a player whose coach misspelt their name lands on a fresh roster row
  // with no history, while the coach's row keeps it, linked to nobody. Nothing
  // errors, so the empty record reads as correct. This asks the database what
  // actually happened rather than guessing which row was theirs.
  const [mayHaveMissedHistory, setMayHaveMissedHistory] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  // The account and Retry count of the last load that finished. A run for the
  // same pair is a background refresh (see below), not a first load.
  const loadedFor = useRef<{ userId: string; reloadKey: number } | null>(null)

  // J7 counts published messages the player opens. The message is read here now
  // (TRAK-71), not behind a tap, so showing it is opening it.
  // TRAK-441: the new Home doesn't show the message (it's on the evaluation's page), so it doesn't count it.
  const shownAssessmentId = !look && coachAssessmentNote && !feedbackLoadFailed ? coachAssessment?.id : undefined
  useEffect(() => {
    if (shownAssessmentId) trackEvent('feedback_opened', { assessment_id: shownAssessmentId })
  }, [shownAssessmentId])

  // TRAK-401: an evaluation's assessment card says how the objectives went. Only evaluation assessments are asked for; a
  // failed read leaves the card as it was (the evaluation page says it when it can't load).
  const evaluationIds = recentAssessments.filter(a => a.evaluation_id).map(a => a.id as string)
  const evaluationProgress = useEvaluationProgress(evaluationIds)
  // TRAK-437: the position is the one the coach set (the season plan's read, shared with the My season card), nothing if none; never the sign-up value.
  const position = useMySeason().data?.position
  const progressLines: Record<string, string> = {}
  for (const [id, p] of evaluationProgress.data ?? []) {
    const line = progressSummary(p.objectives)
    if (line) progressLines[id] = line
  }

  useEffect(() => {
    if (!user) return
    // This effect re-runs on an Auth refresh for the same account. Without a
    // guard, a response from the previous run can land after the current one
    // and reinstate what it read — which is how retracted feedback stayed on
    // screen. Only the newest run may write to state.
    let cancelled = false
    // AuthContext hands out a new user object on every token refresh (hourly,
    // and on returning to the tab), so a same-account re-run is a background
    // refresh: it keeps the card on screen and replaces each value from its own
    // result, instead of blanking the card behind the skeleton (Kostas, #133).
    // A first load, a Retry and a different account still start from nothing.
    const background = loadedFor.current?.userId === user.id && loadedFor.current.reloadKey === reloadKey
    let failed = false
    const fail = () => { failed = true; setLoadFailed(true) }
    // These belong to this load's accessible roster and latest assessment.
    // A successful empty read must not retain values from the previous load.
    const clearCoach = () => {
      setCoachAssessment(null)
      setRecentAssessments([])
      setCoachName('')
      setCoachAssessmentNote(null)
      setAssessmentAlert(null)
      setFeedbackLoadFailed(false)
    }
    if (!background) {
      setLoading(true)
      setLoadFailed(false)
      clearCoach()
      setUpcomingEvents([])
    }

    const detailsRequest = supabase.from('player_details').select('current_club, age_group').eq('user_id', user.id).maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return
        // These sibling reads used to destructure only `data`, so a failure
        // rendered as "nothing recorded yet" — the same false empty state this
        // screen's main query was fixed for, arriving one query along.
        if (error) { fail(); return }
        setDetails(data)
      })
    // Fetch squad link → coach assessments + published calendar events
    const squadRequest = supabase.from('squad_players').select('id, coach_user_id').eq('linked_player_id', user.id)
      .then(async ({ data: squadRows, error: squadError }) => {
        if (cancelled) return
        if (squadError) { fail(); return }
        if (!squadRows?.length) { clearCoach(); setUpcomingEvents([]); return }
        const ids = squadRows.map((r: any) => r.id)
        const coachIds = squadRows.map((r: any) => r.coach_user_id).filter(Boolean)

        // Latest coach assessment
        const { data: assessments, error: assessError } = await supabase.from('coach_assessments')
          .select('*')
          .in('squad_player_id', ids)
          .order('created_at', { ascending: false })
          .limit(5)
        if (cancelled) return
        if (assessError) { fail(); return }
        if (!assessments?.length) clearCoach()
        else {
          const latest = assessments[0]
          const { data: cp } = await supabase.from('profiles').select('full_name').eq('user_id', latest.coach_user_id).maybeSingle()
          if (cancelled) return
          // Published feedback the coach wrote FOR this player — not the
          // coach's private note, which K9 (20260918135500) made unreadable
          // here and which was never meant for the child in the first place.
          // RLS already restricts this to published rows on their own
          // assessments; the published_at filter makes that explicit at the
          // call site so a future policy change cannot quietly widen it.
          //
          // The previous console.log printed the private note to the browser
          // console — X9 by a third route. Gone with the query that fed it.
          const { data: sharedRow, error: sharedError } = await supabase
            .from('coach_shared_feedback' as any)
            .select('body, published_at')
            .eq('assessment_id', latest.id)
            .not('published_at', 'is', null)
            .maybeSingle()
          if (cancelled) return
          // The assessment, its coach and its message change together, so a
          // background refresh never pairs a new assessment with an old message.
          setCoachAssessment(latest)
          setRecentAssessments(assessments)
          setCoachName(cp?.full_name || '')
          // Assign unconditionally, including null. The previous version only
          // assigned a truthy body, so once feedback had been displayed it
          // could never be taken away: a coach retracting a publication left
          // the old text on the child's screen on every later render. Imad
          // reproduced it with an Auth refresh returning zero rows.
          //
          // An error clears it too. If we cannot confirm the text is still
          // published, continuing to show it is the wrong side to fail on —
          // the whole point of K9 is that the child sees only what a coach
          // currently means them to see.
          // A console line is not a user-visible state. An empty card reads as
          // "my coach hasn't written anything yet", which is the false-empty
          // state #30 fixed on this screen — arriving back in the same file.
          // Tarek raised it on #44; #42 makes the sibling queries in this
          // effect set loadFailed, so this one would have stood out as the
          // exception once both landed.
          if (sharedError) {
            console.error('[Trak] shared feedback fetch failed', sharedError.message)
            setFeedbackLoadFailed(true)
            setCoachAssessmentNote(null)
            setAssessmentAlert(null)
          } else {
            setFeedbackLoadFailed(false)
            const published = sharedRow as { body?: string; published_at?: string } | null
            const body = published?.body?.trim()
            setCoachAssessmentNote(body || null)
            // TRAK-401: an evaluation exists only once published, with or without a note, so
            // it alerts at its own time like the parent's bell. A session assessment still
            // waits for its published message (TRAK-171).
            const publishedAt = body && published?.published_at ? published.published_at : latest.evaluation_id ? latest.created_at : null
            setAssessmentAlert(publishedAt && Number.isFinite(Date.parse(publishedAt))
              ? { id: latest.id, userId: user.id, publishedAt, hasMessage: !!body, coachName: cp?.full_name ?? '' } : null)
          }
        }

        // Published upcoming calendar events from coach
        if (!coachIds.length) setUpcomingEvents([])
        else {
          // Through child_events (TRAK-164), like the parent's screens: it
          // applies the child's consent and drops a cancel reason naming a
          // squad-mate or holding a link.
          const { data: evs, error: evsError } = await supabase
            .rpc('child_events', { p_child: user.id })
            // An untimed session is stored at midnight, so `starts_at >= now()`
            // dropped it from its own day the moment the clock passed 00:00 —
            // the session a player most needs to see disappears on the morning
            // it happens. Filtered on the calendar day instead, with the
            // instant kept as the fallback for rows written before the
            // backfill.
            .or(upcomingEventsFilter())
            .order('event_date', { ascending: true, nullsFirst: false })
            .order('starts_at', { ascending: true })
            // Enough for the bell (TRAK-163), not just Next up.
            .limit(20)
          if (cancelled) return
          // A failed calendar read is not an empty calendar. Without this the
          // player is told they have no sessions coming up, which is a
          // statement about their week, not about the network.
          if (evsError) { fail(); return }
          setUpcomingEvents((evs || []).map(r => toPlayerEvent(r as Record<string, unknown>)).filter((e): e is PlayerEvent => e !== null))
        }
      })

    // A sibling success cannot erase a failure. Keep loading until all of
    // this run's required reads finish; only a run that finishes cleanly
    // clears loadFailed. A callback that throws, instead of resolving with
    // { error }, ends in the same retryable error rather than an endless
    // skeleton (Kostas and Imad, #133).
    Promise.all([detailsRequest, squadRequest]).then(() => {
      if (cancelled) return
      if (!failed) setLoadFailed(false)
      setLoading(false)
      loadedFor.current = { userId: user.id, reloadKey }
    }, error => {
      if (cancelled) return
      console.error('[Trak] player home load failed', error)
      setLoadFailed(true)
      setLoading(false)
      loadedFor.current = { userId: user.id, reloadKey }
    })

    return () => { cancelled = true }
  }, [user, reloadKey])


  if (loading) return (
    <MobileShell>
      <div className="pt-12 pb-4 space-y-6">
        <CardSkeleton />
        <div className="space-y-3"><Skeleton className="h-3 w-28" /><MatchCardSkeleton /><MatchCardSkeleton /></div>
      </div>
      <NavBar role="player" activeTab={location.pathname} onNavigate={navigate} />
    </MobileShell>
  )

  if (loadFailed) return (
    <MobileShell>
      <div className="pt-12 pb-4">
        <LoadError
          what="your card"
          onRetry={() => setReloadKey(k => k + 1)}
        />
      </div>
      <NavBar role="player" activeTab={location.pathname} onNavigate={navigate} />
    </MobileShell>
  )

  const bell = user && <PlayerHomeBell key={user.id} userId={user.id}
    events={loadedFor.current?.userId === user.id ? upcomingEvents : []}
    assessment={loadFailed ? null : assessmentAlert} assessmentLoadFailed={feedbackLoadFailed || loadFailed}
    onRetry={() => setReloadKey(k => k + 1)} />
  const name = profile?.full_name || 'Player'
  // TRAK-441 slice 2 (Imad, 13 Nov), behind family_look: the coach's Home. A phone: avatar, name, calendar, bell. A
  // laptop: no header, the bell in the top bar; two columns, as the coach's Home.
  const header = look
    ? <FrameActions fallback={<HomeHeader calendarTo="/player/calendar" left={<span className="arc flex"><Avatar name={name} size="md" /></span>}
        center={<HomeTitle>{name}</HomeTitle>} right={bell} />}>{bell}</FrameActions>
    : <HomeHeader calendarTo="/player/calendar" center={<HomeTitle>{name}</HomeTitle>} right={bell} />
  return (
    <MobileShell width={look ? 'wide' : 'page'}>
      <div className="pt-3 pb-4">
        {/* TRAK-163: calendar, the player's name, the bell; then the next seven days. */}
        {header}
        {/* TRAK-194 (Kostas, 16 Oct): one quiet line, as parent Home has it, not a greeting and chips that look like buttons. */}
        {!look && details && <p className="text-xs text-muted-foreground text-center -mt-1 pb-4">
          {[position, details.current_club, details.age_group].filter(Boolean).join(' · ')}
        </p>}
        <div className={look ? 'grid grid-cols-[minmax(0,1fr)] gap-5 laptop:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] laptop:items-start laptop:gap-6' : ''}>
        <div className={look ? 'grid grid-cols-[minmax(0,1fr)] content-start gap-5' : ''}>
        {user && <LoadedWeekStrip key={user.id} loadKey={user.id} absentFor={user.id} picker={look} renderSheet={(event, trigger) => <EventSheet event={event} role="player" trigger={trigger}>
          {reportsForSelf && <CantMakeIt event={event} child={{ id: user.id, name: 'you' }} self />}
        </EventSheet>}
          renderPrimary={reportsForSelf ? event => <CantMakeItButton event={event} child={{ id: user.id, name: 'you' }} self /> : undefined}
          load={(from, to) => supabase.rpc('child_events', { p_child: user.id })
            .gte('event_date', from).lte('event_date', to).order('event_date', { ascending: true })} />}
        {/* TRAK-133 (J8.10): once there are events, offer the phone calendar. */}
        <CalendarHomePrompt hasEvents={upcomingEvents.length > 0} />

        {mayHaveMissedHistory && (
          <div className="rounded-xl border p-4 my-4" role="status"
            style={{ borderColor: 'rgb(var(--t-line))', background: 'rgb(var(--t-raised))' }}>
            <p className="text-[13px] text-ink" style={{ fontFamily: 'var(--t-font)' }}>
              Is anything missing?
            </p>
            <p className="text-[12px] text-ink-2 mt-1 leading-relaxed" style={{ fontFamily: 'var(--t-font)' }}>
              Your coach may already have you on their list under a slightly different
              spelling. If you've been assessed before and nothing is showing here, ask
              them to check the name on your record.
            </p>
          </div>
        )}

        {/* Shown until the player agrees (a refusal can be changed here); kept for this visit to confirm the choice. */}
        {decidesForSelf && (choseHere || consent?.own_choice !== true) && (
          <OwnConsentCard turned={!consent?.required && consent?.own_choice == null}
            onChange={() => { setChoseHere(true); setConsentReload(n => n + 1) }} />
        )}
        {consent?.required && !decidesForSelf && (
          <div className="rounded-xl border border-primary/30 bg-primary/10 p-4 my-4">
            <p className="text-[13px] text-ink" style={{ fontFamily: 'var(--t-font)' }}>
              Waiting for your parent
            </p>
            <p className="text-[12px] text-ink-2 mt-1 leading-relaxed" style={{ fontFamily: 'var(--t-font)' }}>
              Your account needs a parent or guardian's approval before your coach can record your progress.
            </p>
          </div>
        )}

        {user && <PlayerParentInviteCard playerUserId={user.id} hideWhenLinked />}

        {/* TRAK-436: what's new from the coach, one card each, before the season (the coach's "Needs you"). */}
        {look && user && <ForYou childId={user.id} as="player" />}

        {/* TRAK-397: the season plan the coach shared; nothing here when there is none. */}
        {user && <MySeasonCard key={user.id} />}
        </div>
        <div className={look ? 'grid grid-cols-[minmax(0,1fr)] content-start gap-5' : ''}>

        {/* Coach assessments: the parent's swipe cards (TRAK-172, Imad 19 Oct), each opening
            that assessment; the coach's message on the latest stays below (TRAK-71). */}
        {/* TRAK-441 slice 2.5: the coach's look shows the latest evaluation's bands; its note is on its own page. */}
        {look && user && coachAssessment && <LatestEvaluation assessment={coachAssessment} readerId={user.id} />}
        {look && user && <SeasonSoFar key={user.id} childId={user.id} />}
        {!look && coachAssessment && (
          <div className="mt-5">
            <ParentAssessmentCarousel key={recentAssessments.map(a => a.id).join(',')} assessments={recentAssessments}
              allHref={null} openHref={id => `/player/feedback/${encodeURIComponent(id)}`} progressLines={progressLines} />
            {feedbackLoadFailed ? (
              <p role="alert" className="mt-4 text-[12px] text-ink-2">
                Couldn't load your coach's message.{' '}
                <button type="button" onClick={() => setReloadKey(k => k + 1)} className="underline text-brand">Retry</button>
              </p>
            ) : coachAssessmentNote ? (
              <div className="mt-4 rounded-xl border border-border bg-card p-5">
                <MetadataLabel text="MESSAGE FROM YOUR COACH" />
                {coachName && <p className="mt-1.5 text-[13px] font-medium text-foreground">{coachName}</p>}
                <p className="mt-1.5 text-[13px] leading-relaxed text-foreground whitespace-pre-line">{coachAssessmentNote}</p>
              </div>
            ) : null}
          </div>
        )}

        </div>
        </div>
        {/* TRAK-194: no "Recent matches" here; the Sessions tab lists every match. */}
      </div>
      <NavBar role="player" activeTab={location.pathname} onNavigate={navigate} />

    </MobileShell>
  )
}
