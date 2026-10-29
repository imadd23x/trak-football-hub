import { useEffect, useRef, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { supabase } from '@/integrations/supabase/client'
import { useAuth } from '@/contexts/AuthContext'
import { MobileShell, NavBar, BandPill, MetadataLabel, LoadError } from '@/components/trak'
import { CardSkeleton, MatchCardSkeleton, Skeleton } from '@/components/trak'
import { BANDS, type BandType, BAND_TEXT } from '@/lib/types'
import { scoreToBand } from '@/lib/rating-engine'
import { dedupeMatches } from '@/lib/match-dedupe'
import { toPlayerEvent, upcomingEventsFilter, type PlayerEvent } from '@/lib/player-events'
import { PlayerAlertsBell, type PublishedAssessmentAlert } from '@/components/player/PlayerAlertsBell'
import { HomeHeader, HomeTitle } from '@/components/trak/HomeHeader'
import { LoadedWeekStrip } from '@/components/trak/WeekStrip'
import { EventSheet } from '@/components/trak/EventSheet'
import { CantMakeIt } from '@/components/parent/CantMakeIt'
import { CalendarHomePrompt } from '@/components/trak/AddToCalendar'
import { trackEvent } from '@/lib/telemetry'
import CardRevealModal from '@/components/player/CardRevealModal'
import { PlayerParentInviteCard } from '@/components/player/PlayerParentInviteCard'
import { OwnConsentCard } from '@/components/player/OwnConsentCard'
import { ParentAssessmentCarousel } from '@/components/parent/ParentAssessmentCarousel'

const QUOTES = [
  { text: "The more difficult the victory, the greater the happiness in winning.", author: "Pelé" },
  { text: "You have to fight to reach your dream. You have to sacrifice and work hard for it.", author: "Lionel Messi" },
  { text: "I learned all about life with a ball at my feet.", author: "Ronaldinho" },
  { text: "Talent without working hard is nothing.", author: "Cristiano Ronaldo" },
  { text: "Don't watch the clock; do what it does. Keep going.", author: "Sam Levenson" },
  { text: "The secret is to believe in your dreams; in your potential that you can be like your star.", author: "Zinedine Zidane" },
  { text: "Set your goals high, and don't stop till you get there.", author: "Bo Jackson" },
  { text: "If you fail to prepare, you prepare to fail.", author: "Roy Keane" },
  { text: "Hard work beats talent when talent doesn't work hard.", author: "Tim Notke" },
  { text: "Push yourself because no one else is going to do it for you.", author: "" },
  { text: "Success is no accident. It is hard work, perseverance, learning, and sacrifice.", author: "Pelé" },
  { text: "The difference between the impossible and the possible lies in determination.", author: "Tommy Lasorda" },
  { text: "When you're not training, someone else is.", author: "" },
  { text: "Every champion was once a contender that refused to give up.", author: "Rocky Balboa" },
  { text: "I am not the best, but I'm giving everything to be the best.", author: "Kylian Mbappé" },
  { text: "Great things never come from comfort zones.", author: "" },
  { text: "Champions keep playing until they get it right.", author: "Billie Jean King" },
  { text: "Pain is temporary. Glory is forever.", author: "" },
  { text: "Be hungry, be humble, be the hardest worker in the room.", author: "" },
  { text: "The only place success comes before work is in the dictionary.", author: "Vince Lombardi" },
  { text: "Believe in yourself and all that you are.", author: "" },
  { text: "Every session is a chance to get better.", author: "" },
  { text: "Dream big. Work hard. Stay focused.", author: "" },
  { text: "There is no substitute for hard work.", author: "Thomas Edison" },
  { text: "It always seems impossible until it's done.", author: "Nelson Mandela" },
  { text: "Small steps every day lead to big results.", author: "" },
  { text: "Your only competition is who you were yesterday.", author: "" },
  { text: "Leave everything on the pitch.", author: "" },
  { text: "The best view comes after the hardest climb.", author: "" },
  { text: "Winners are not people who never fail, but people who never quit.", author: "" },
]

function getDailyQuote() {
  const now = new Date()
  const dayOfYear = Math.floor(
    (now.getTime() - new Date(now.getFullYear(), 0, 0).getTime()) / 86400000
  )
  return QUOTES[dayOfYear % QUOTES.length]
}

export default function PlayerHome() {
  const { user, profile } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [matches, setMatches] = useState<any[]>([])
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

  const [showReveal, setShowReveal] = useState(false)
  const [newMatchCount, setNewMatchCount] = useState(0)
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
  const shownAssessmentId = coachAssessmentNote && !feedbackLoadFailed ? coachAssessment?.id : undefined
  useEffect(() => {
    if (shownAssessmentId) trackEvent('feedback_opened', { assessment_id: shownAssessmentId })
  }, [shownAssessmentId])

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

    const matchesRequest = supabase.from('matches').select('*').eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (cancelled) return
        // A failed read is not an empty season — without this the home screen
        // showed a player with a full record the same blank card as a new one.
        if (error) { fail(); return }

        const deduped = dedupeMatches(data)
        setMatches(deduped)

        // Card reveal — show once when new matches have been logged since last visit. TRAK-289: only rated matches; a
        // Games match has no number (Imad, 28 Oct).
        const ratedCount = deduped.filter(m => m.computed_rating != null).length
        try {
          const storageKey = `trak_last_match_count_${user.id}`
          const stored = localStorage.getItem(storageKey)
          if (stored === null) {
            // First ever open — record count silently, no reveal
            localStorage.setItem(storageKey, String(ratedCount))
          } else {
            const lastSeen = parseInt(stored, 10)
            if (ratedCount > lastSeen) {
              setNewMatchCount(ratedCount - lastSeen)
              setShowReveal(true)
            }
          }
        } catch {
          // Reveal bookkeeping is optional when browser storage is unavailable.
          // It must not prevent the successful card reads from finishing.
        }
      })
    const detailsRequest = supabase.from('player_details').select('position, current_club, age_group').eq('user_id', user.id).maybeSingle()
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
            setAssessmentAlert(body && published?.published_at && Number.isFinite(Date.parse(published.published_at))
              ? { id: latest.id, userId: user.id, publishedAt: published.published_at, coachName: cp?.full_name ?? '' } : null)
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
    Promise.all([matchesRequest, detailsRequest, squadRequest]).then(() => {
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

  // TRAK-289: a Games match has no rating, so bands, streaks and trends read only the rated ones.
  const rated = matches.filter((m): m is typeof m & { computed_rating: number } => m.computed_rating != null)
  const getBandDistribution = () => {
    const dist: Record<string, number> = {}
    BANDS.forEach(b => { dist[b.word.toLowerCase()] = 0 })
    rated.forEach(m => {
      const band = scoreToBand(m.computed_rating)
      dist[band] = (dist[band] || 0) + 1
    })
    return dist
  }

  const getSeasonBand = (): BandType => {
    if (rated.length === 0) return 'steady'
    const dist = getBandDistribution()
    let maxBand: BandType = 'steady'
    let maxCount = 0
    Object.entries(dist).forEach(([band, count]) => {
      if (count > maxCount) { maxCount = count; maxBand = band as BandType }
    })
    return maxBand
  }

  const seasonBand = getSeasonBand()
  const distribution = getBandDistribution()

  const seasonBandConfig = BANDS.find(b => b.word.toLowerCase() === seasonBand) ?? BANDS[3]

  // Next milestone — how many more matches at the next band are needed to flip the season band
  const nextMilestone = (() => {
    const BAND_ORDER: BandType[] = ['difficult', 'developing', 'mixed', 'steady', 'good', 'standout', 'exceptional']
    const currentIdx = BAND_ORDER.indexOf(seasonBand)
    if (currentIdx >= BAND_ORDER.length - 1 || rated.length === 0) return null
    const nextBand = BAND_ORDER[currentIdx + 1]
    const currentCount = distribution[seasonBand] || 0
    const nextCount = distribution[nextBand] || 0
    const needed = Math.max(1, currentCount - nextCount + 1)
    const nextConfig = BANDS.find(b => b.word.toLowerCase() === nextBand)!
    return { needed, nextConfig }
  })()

  const handleRevealDismiss = () => {
    if (!user) return
    setShowReveal(false)
    localStorage.setItem(`trak_last_match_count_${user.id}`, String(rated.length))
  }

  const totalGoals = matches.reduce((s, m) => s + (m.goals || 0), 0)
  const totalAssists = matches.reduce((s, m) => s + (m.assists || 0), 0)

  // Consistency streak — consecutive matches at Steady+ (≥ 6.0) from most recent
  const streakCount = (() => {
    let count = 0
    for (const m of rated) {
      if (m.computed_rating >= 6.0) count++
      else break
    }
    return count
  })()
  const lastMatch = matches[0]

  // Trend: calculate last 5 match ratings normalized to bar heights
  const trendMatches = rated.slice(0, 5).reverse()
  const trendHeights = trendMatches.map((m, i) => {
    const r = m.computed_rating
    return Math.max(20, Math.min(100, ((r - 4) / 6) * 100))
  })
  const isImproving = trendMatches.length >= 2 &&
    trendMatches[trendMatches.length - 1].computed_rating > trendMatches[0].computed_rating

  // Band summary abbreviations
  const bandAbbrev = [
    { key: 'exceptional', abbr: 'E', color: BAND_TEXT.Exceptional },
    { key: 'standout', abbr: 'St', color: BAND_TEXT.Standout },
    { key: 'good', abbr: 'G', color: BAND_TEXT.Good },
    { key: 'steady', abbr: 'Sy', color: BAND_TEXT.Steady },
    { key: 'mixed', abbr: 'M', color: BAND_TEXT.Mixed },
    { key: 'developing', abbr: 'D', color: BAND_TEXT.Developing },
  ]

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

  return (
    <MobileShell>
      <div className="pt-3 pb-4">
        {/* TRAK-163: calendar, the player's name, the bell; then the next seven days. */}
        <HomeHeader calendarTo="/player/calendar" center={<HomeTitle>{profile?.full_name || 'Player'}</HomeTitle>}
          right={user && <PlayerAlertsBell key={user.id} userId={user.id}
            events={loadedFor.current?.userId === user.id ? upcomingEvents : []}
            assessment={loadFailed ? null : assessmentAlert} assessmentLoadFailed={feedbackLoadFailed || loadFailed}
            onRetry={() => setReloadKey(k => k + 1)} />} />
        {/* TRAK-194 (Kostas, 16 Oct): one quiet line, as parent Home has it, not a greeting and chips that look like buttons. */}
        {details && <p className="text-xs text-muted-foreground text-center -mt-1 pb-4">
          {[details.position, details.current_club, details.age_group].filter(Boolean).join(' · ')}
        </p>}
        {user && <LoadedWeekStrip key={user.id} loadKey={user.id} absentFor={user.id} renderSheet={(event, trigger) => <EventSheet event={event} role="player" trigger={trigger}>
          {reportsForSelf && <CantMakeIt event={event} child={{ id: user.id, name: 'you' }} self />}
        </EventSheet>}
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

        {/* Hero Card: a light card like the rest; band words in their readable shades (TRAK-229) */}
        <div className="relative rounded-[24px] p-5 mb-3.5 overflow-hidden"
          style={{ background: 'linear-gradient(135deg, rgb(var(--t-surface)) 0%, rgb(var(--t-surface)) 100%)', border: '1px solid rgb(var(--t-line))' }}>
          <div className="absolute -bottom-[60px] -right-[60px] w-[200px] h-[200px] rounded-full pointer-events-none"
            style={{ background: 'radial-gradient(circle, rgb(var(--t-brand) / 0.08) 0%, transparent 70%)' }} />

          <div className="flex items-start justify-between mb-4 relative z-10">
            <div>
              <MetadataLabel text="THIS SEASON" />
              {rated.length > 0 ? (
                <>
                  <p className="text-[52px] leading-none mt-2" style={{
                    fontFamily: 'var(--t-font)', fontWeight: 300, letterSpacing: '-0.04em',
                    color: BANDS.find(b => b.word.toLowerCase() === seasonBand)?.text
                  }}>
                    {BANDS.find(b => b.word.toLowerCase() === seasonBand)?.word}
                  </p>
                  {lastMatch && (
                    <p className="text-[9px] text-ink-3 mt-1.5 tracking-[0.04em]" style={{ fontFamily: 'var(--t-font-mono)' }}>
                      Last match · {lastMatch.competition || 'Match'}
                    </p>
                  )}
                </>
              ) : (
                /* ── Welcome state (no matches yet) ── */
                <div className="mt-2">
                  <p className="text-[34px] leading-tight text-ink-2"
                    style={{ fontFamily: 'var(--t-font)', fontWeight: 300, letterSpacing: '-0.03em' }}>
                    Your card<br />is ready.
                  </p>
                  <p className="text-[10px] text-ink-3 mt-2"
                    style={{ fontFamily: 'var(--t-font)' }}>
                    Play. Get assessed. Watch it evolve.
                  </p>

                  {/* Band journey — Difficult → Exceptional */}
                  <div className="flex items-end gap-0 mt-4">
                    {[...BANDS].reverse().map((band, i, arr) => {
                      const isLast = i === arr.length - 1
                      const abbrs = ['DIF','DEV','MIX','STY','GD','STO','EXC']
                      return (
                        <div key={band.word} className="flex items-center">
                          <div className="flex flex-col items-center gap-1">
                            <div className="w-2.5 h-2.5 rounded-full" style={{
                              background: isLast ? band.color : 'rgb(var(--t-ink-3))',
                              boxShadow: isLast ? `0 0 8px rgb(var(--t-brand) / 0.5)` : 'none',
                            }} />
                            <span className="text-[7px]" style={{
                              fontFamily: 'var(--t-font-mono)',
                              color: isLast ? band.text : 'rgb(var(--t-ink-3))',
                            }}>{abbrs[i]}</span>
                          </div>
                          {!isLast && (
                            <div className="w-3 h-px mb-3" style={{ background: 'rgb(var(--t-raised))' }} />
                          )}
                        </div>
                      )
                    })}
                  </div>

                  {/* Coach connection */}
                  <p className="text-[9px] text-ink-3 mt-3 tracking-[0.04em]"
                    style={{ fontFamily: 'var(--t-font-mono)' }}>
                    {coachName
                      ? `↳ ${coachName} has you in their squad`
                      : 'Your coach will log your first match soon.'}
                  </p>
                </div>
              )}
            </div>

            {/* Trend mini-chart */}
            {trendHeights.length > 0 && (
              <div className="text-right">
                <p className="text-[9px] font-medium tracking-[0.12em] uppercase text-ink-3 mb-2"
                  style={{ fontFamily: 'var(--t-font-mono)' }}>Trend</p>
                <div className="flex items-end gap-[3px] h-8 justify-end">
                  {trendHeights.map((h, i) => (
                    <div key={i} className="w-2.5 rounded-t" style={{
                      height: `${h}%`,
                      background: i >= trendHeights.length - 2
                        ? (i === trendHeights.length - 1 ? 'rgb(var(--t-brand))' : 'rgb(var(--t-brand) / 0.35)')
                        : 'rgb(var(--t-raised))',
                    }} />
                  ))}
                </div>
                {streakCount >= 3 ? (
                  <p className="text-[10px] font-medium text-brand mt-1.5"
                    style={{ fontFamily: 'var(--t-font-mono)' }}>{streakCount} in a row</p>
                ) : isImproving ? (
                  <p className="text-[10px] font-medium text-brand mt-1.5"
                    style={{ fontFamily: 'var(--t-font-mono)' }}>↑ improving</p>
                ) : null}
              </div>
            )}
          </div>

          {/* Band summary strip */}
          {rated.length > 0 && (
            <div className="flex items-center justify-between px-3 py-2.5 rounded-[10px] relative z-10"
              style={{ background: 'rgb(var(--t-raised))' }}>
              <div className="flex items-center gap-[7px]">
                <div className="w-[5px] h-[5px] rounded-full bg-ink-3" />
                <span className="text-[9px] font-medium tracking-[0.08em] uppercase text-ink-3"
                  style={{ fontFamily: 'var(--t-font-mono)' }}>Season bands</span>
              </div>
              <div className="flex items-center gap-2.5">
                {bandAbbrev.filter(b => distribution[b.key] > 0).map(b => (
                  <span key={b.key} className="text-xs" style={{ fontFamily: 'var(--t-font)', color: b.color }}>
                    {distribution[b.key]} {b.abbr}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Next milestone */}
          {rated.length > 0 && (
            <div className="flex items-center justify-between px-3 py-2 mt-1.5 rounded-[10px] relative z-10"
              style={{ background: 'rgb(var(--t-raised))' }}>
              <span className="text-[9px] tracking-[0.06em] text-ink-3"
                style={{ fontFamily: 'var(--t-font-mono)' }}>
                Next milestone
              </span>
              {nextMilestone ? (
                <span className="text-[9px] font-medium tracking-[0.04em]"
                  style={{ fontFamily: 'var(--t-font-mono)', color: nextMilestone.nextConfig.text }}>
                  {nextMilestone.needed} more {nextMilestone.nextConfig.word} → {nextMilestone.nextConfig.word} season
                </span>
              ) : (
                <span className="text-[9px] tracking-[0.04em] text-ink-3"
                  style={{ fontFamily: 'var(--t-font-mono)' }}>
                  Season high — Exceptional ✦
                </span>
              )}
            </div>
          )}
        </div>

        {/* Stats grid */}
        {matches.length > 0 && (
          <div className="grid grid-cols-3 gap-2 mt-3.5">
            <div className="rounded-[10px] py-[11px] px-2 text-center" style={{ background: 'rgb(var(--t-raised))' }}>
              <p className="text-[22px] font-normal text-ink leading-none" style={{ fontFamily: 'var(--t-font)', letterSpacing: '-0.02em' }}>{matches.length}</p>
              <span className="text-[8px] font-medium tracking-[0.1em] uppercase text-ink-3 mt-[5px] block" style={{ fontFamily: 'var(--t-font-mono)' }}>Matches</span>
            </div>
            <div className="rounded-[10px] py-[11px] px-2 text-center" style={{ background: 'rgb(var(--t-raised))' }}>
              <p className="text-[22px] font-normal text-ink leading-none" style={{ fontFamily: 'var(--t-font)', letterSpacing: '-0.02em' }}>{totalGoals}</p>
              <span className="text-[8px] font-medium tracking-[0.1em] uppercase text-ink-3 mt-[5px] block" style={{ fontFamily: 'var(--t-font-mono)' }}>Goals</span>
            </div>
            <div className="rounded-[10px] py-[11px] px-2 text-center" style={{ background: 'rgb(var(--t-raised))' }}>
              <p className="text-[22px] font-normal text-ink leading-none" style={{ fontFamily: 'var(--t-font)', letterSpacing: '-0.02em' }}>{totalAssists}</p>
              <span className="text-[8px] font-medium tracking-[0.1em] uppercase text-ink-3 mt-[5px] block" style={{ fontFamily: 'var(--t-font-mono)' }}>Assists</span>
            </div>
          </div>
        )}

        {/* Daily Quote */}
        {(() => {
          const quote = getDailyQuote()
          return (
            <div className="mt-4 rounded-[18px] px-5 py-4"
              style={{ background: 'rgb(var(--t-surface))', border: '1px solid rgb(var(--t-line))' }}>
              <p className="text-[9px] tracking-[0.14em] uppercase text-ink-3 mb-3"
                style={{ fontFamily: 'var(--t-font-mono)' }}>Today</p>
              <p className="text-[15px] font-light leading-[1.5] text-ink"
                style={{ fontFamily: 'var(--t-font)', letterSpacing: '-0.01em' }}>
                "{quote.text}"
              </p>
              {quote.author ? (
                <p className="text-[9px] text-ink-3 mt-2.5 tracking-[0.06em]"
                  style={{ fontFamily: 'var(--t-font-mono)' }}>
                  — {quote.author}
                </p>
              ) : null}
            </div>
          )
        })()}

        {/* Coach assessments: the parent's swipe cards (TRAK-172, Imad 19 Oct), each opening
            that assessment; the coach's message on the latest stays below (TRAK-71). */}
        {coachAssessment && (
          <div className="mt-5">
            <ParentAssessmentCarousel key={recentAssessments.map(a => a.id).join(',')} assessments={recentAssessments}
              allHref={null} openHref={id => `/player/feedback/${encodeURIComponent(id)}`} />
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

        {/* TRAK-194: no "Recent matches" here; the Sessions tab lists every match. */}
      </div>
      <NavBar role="player" activeTab={location.pathname} onNavigate={navigate} />

      {showReveal && lastMatch && (
        <CardRevealModal
          bandWord={seasonBandConfig.word}
          bandColor={seasonBandConfig.text}
          newMatchCount={newMatchCount}
          latestMatch={lastMatch}
          onDismiss={handleRevealDismiss}
        />
      )}
    </MobileShell>
  )
}
