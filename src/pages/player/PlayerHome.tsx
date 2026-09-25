import { useEffect, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { supabase } from '@/integrations/supabase/client'
import { useAuth } from '@/contexts/AuthContext'
import { MobileShell, NavBar, BandPill, MetadataLabel, LoadError } from '@/components/trak'
import { CardSkeleton, MatchCardSkeleton, Skeleton } from '@/components/trak'
import { BANDS, type BandType } from '@/lib/types'
import { scoreToBand } from '@/lib/rating-engine'
import { dedupeMatches } from '@/lib/match-dedupe'
import { displayEventTime } from '@/lib/event-time'
import { parseDisplayDate } from '@/lib/calendar'
import { trackEvent } from '@/lib/telemetry'
import CardRevealModal from '@/components/player/CardRevealModal'
import { PlayerParentInviteCard } from '@/components/player/PlayerParentInviteCard'

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
  const [coachName, setCoachName] = useState('')
  const [upcomingEvents, setUpcomingEvents] = useState<any[]>([])
  const [consent, setConsent] = useState<{ required: boolean; invited_parent: string | null } | null>(null)

  // Under the digital-consent age nothing can be recorded about this player
  // until a parent approves. Without this they would sign in to a dashboard
  // that stays permanently empty with no explanation — the same false-empty
  // state the parent screens suffer from.
  useEffect(() => {
    if (!user) return
    // `as any`: generated types predate the consent migration.
    ;(supabase.rpc as any)('my_consent_status').then(({ data }: { data: unknown }) => {
      setConsent(data as { required: boolean; invited_parent: string | null } | null)
    })
  }, [user])

  const [showReveal, setShowReveal] = useState(false)
  const [newMatchCount, setNewMatchCount] = useState(0)
  const [coachAssessmentNote, setCoachAssessmentNote] = useState<string | null>(null)
  // A failed feedback read must not look like "no feedback yet".
  const [feedbackLoadFailed, setFeedbackLoadFailed] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)
  // T4 — a player whose coach misspelt their name lands on a fresh roster row
  // with no history, while the coach's row keeps it, linked to nobody. Nothing
  // errors, so the empty record reads as correct. This asks the database what
  // actually happened rather than guessing which row was theirs.
  const [mayHaveMissedHistory, setMayHaveMissedHistory] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

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

    supabase.from('matches').select('*').eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        setLoading(false)
        // A failed read is not an empty season — without this the home screen
        // showed a player with a full record the same blank card as a new one.
        if (error) { setLoadFailed(true); return }
        setLoadFailed(false)

        const deduped = dedupeMatches(data)
        setMatches(deduped)

        // Card reveal — show once when new matches have been logged since last visit
        const storageKey = `trak_last_match_count_${user.id}`
        const stored = localStorage.getItem(storageKey)
        if (stored === null) {
          // First ever open — record count silently, no reveal
          localStorage.setItem(storageKey, String(deduped.length))
        } else {
          const lastSeen = parseInt(stored, 10)
          if (deduped.length > lastSeen) {
            setNewMatchCount(deduped.length - lastSeen)
            setShowReveal(true)
          }
        }
      })
    supabase.from('player_details').select('position, current_club, age_group').eq('user_id', user.id).maybeSingle()
      .then(({ data, error }) => {
        // These sibling reads used to destructure only `data`, so a failure
        // rendered as "nothing recorded yet" — the same false empty state this
        // screen's main query was fixed for, arriving one query along.
        if (error) { setLoadFailed(true); return }
        setDetails(data)
      })
    // Fetch squad link → coach assessments + published calendar events
    supabase.from('squad_players').select('id, coach_user_id').eq('linked_player_id', user.id)
      .then(async ({ data: squadRows, error: squadError }) => {
        if (squadError) { setLoadFailed(true); return }
        if (!squadRows?.length) return
        const ids = squadRows.map((r: any) => r.id)
        const coachIds = squadRows.map((r: any) => r.coach_user_id).filter(Boolean)

        // Latest coach assessment
        const { data: assessments, error: assessError } = await supabase.from('coach_assessments')
          .select('*')
          .in('squad_player_id', ids)
          .order('created_at', { ascending: false })
          .limit(1)
        if (assessError) { setLoadFailed(true); return }
        if (assessments?.length) {
          const latest = assessments[0]
          setCoachAssessment(latest)
          const { data: cp } = await supabase.from('profiles').select('full_name').eq('user_id', latest.coach_user_id).maybeSingle()
          if (cp) setCoachName(cp.full_name)
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
            .select('body')
            .eq('assessment_id', latest.id)
            .not('published_at', 'is', null)
            .maybeSingle()
          if (cancelled) return
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
            return
          }
          setFeedbackLoadFailed(false)
          const body = (sharedRow as { body?: string } | null)?.body?.trim()
          setCoachAssessmentNote(body || null)
        }

        // Published upcoming calendar events from coach
        if (coachIds.length) {
          const { data: evs, error: evsError } = await supabase
            .from('coach_calendar_events')
            .select('*')
            .in('coach_user_id', coachIds)
            .eq('published', true)
            // An untimed session is stored at midnight, so `starts_at >= now()`
            // dropped it from its own day the moment the clock passed 00:00 —
            // the session a player most needs to see disappears on the morning
            // it happens. Filtered on the calendar day instead, with the
            // instant kept as the fallback for rows written before the
            // backfill.
            .or(`event_date.gte.${new Date().toLocaleDateString('en-CA')},and(event_date.is.null,starts_at.gte.${new Date().toISOString()})`)
            .order('event_date', { ascending: true, nullsFirst: false })
            .order('starts_at', { ascending: true })
            .limit(5)
          // A failed calendar read is not an empty calendar. Without this the
          // player is told they have no sessions coming up, which is a
          // statement about their week, not about the network.
          if (evsError) { setLoadFailed(true); return }
          setUpcomingEvents(evs || [])
        }
      })

    return () => { cancelled = true }
  }, [user, reloadKey])

  const getBandDistribution = () => {
    const dist: Record<string, number> = {}
    BANDS.forEach(b => { dist[b.word.toLowerCase()] = 0 })
    matches.forEach(m => {
      const band = scoreToBand(m.computed_rating || 6.5)
      dist[band] = (dist[band] || 0) + 1
    })
    return dist
  }

  const getSeasonBand = (): BandType => {
    if (matches.length === 0) return 'steady'
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
    if (currentIdx >= BAND_ORDER.length - 1 || matches.length === 0) return null
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
    localStorage.setItem(`trak_last_match_count_${user.id}`, String(matches.length))
  }

  const totalGoals = matches.reduce((s, m) => s + (m.goals || 0), 0)
  const totalAssists = matches.reduce((s, m) => s + (m.assists || 0), 0)

  // Consistency streak — consecutive matches at Steady+ (≥ 6.0) from most recent
  const streakCount = (() => {
    let count = 0
    for (const m of matches) {
      if ((m.computed_rating ?? 0) >= 6.0) count++
      else break
    }
    return count
  })()
  const recentMatches = matches.slice(0, 5)
  const lastMatch = matches[0]

  // Trend: calculate last 5 match ratings normalized to bar heights
  const trendMatches = matches.slice(0, 5).reverse()
  const trendHeights = trendMatches.map((m, i) => {
    const r = m.computed_rating || 6.5
    return Math.max(20, Math.min(100, ((r - 4) / 6) * 100))
  })
  const isImproving = trendMatches.length >= 2 &&
    (trendMatches[trendMatches.length - 1]?.computed_rating || 0) > (trendMatches[0]?.computed_rating || 0)

  // Band summary abbreviations
  const bandAbbrev = [
    { key: 'exceptional', abbr: 'E', color: '#C8F25A' },
    { key: 'standout', abbr: 'St', color: '#86efac' },
    { key: 'good', abbr: 'G', color: '#4ade80' },
    { key: 'steady', abbr: 'Sy', color: '#60a5fa' },
    { key: 'mixed', abbr: 'M', color: '#fb923c' },
    { key: 'developing', abbr: 'D', color: '#a78bfa' },
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
          onRetry={() => { setLoading(true); setLoadFailed(false); setReloadKey(k => k + 1) }}
        />
      </div>
      <NavBar role="player" activeTab={location.pathname} onNavigate={navigate} />
    </MobileShell>
  )

  return (
    <MobileShell>
      <div className="pt-3 pb-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-1">
          <span className="text-[11px] font-medium tracking-[0.14em] uppercase text-white/20"
            style={{ fontFamily: "'DM Mono', monospace" }}>TRAK</span>
        </div>

        {mayHaveMissedHistory && (
          <div className="rounded-xl border p-4 my-4" role="status"
            style={{ borderColor: 'rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.03)' }}>
            <p className="text-[13px] text-white/88" style={{ fontFamily: "'DM Sans', sans-serif" }}>
              Is anything missing?
            </p>
            <p className="text-[12px] text-white/55 mt-1 leading-relaxed" style={{ fontFamily: "'DM Sans', sans-serif" }}>
              Your coach may already have you on their list under a slightly different
              spelling. If you've been assessed before and nothing is showing here, ask
              them to check the name on your record.
            </p>
          </div>
        )}

        {consent?.required && (
          <div className="rounded-xl border border-primary/30 bg-primary/10 p-4 my-4">
            <p className="text-[13px] text-white/88" style={{ fontFamily: "'DM Sans', sans-serif" }}>
              Waiting for your parent
            </p>
            <p className="text-[12px] text-white/55 mt-1 leading-relaxed" style={{ fontFamily: "'DM Sans', sans-serif" }}>
              Your account needs a parent or guardian's approval before your coach can record your progress.
            </p>
          </div>
        )}

        {user && <PlayerParentInviteCard playerUserId={user.id} hideWhenLinked />}

        {/* Identity */}
        <div className="py-2.5 pb-4">
          <p className="text-xs text-white/22 mb-1">Good morning,</p>
          <p className="text-[28px] font-semibold text-white/88 leading-tight tracking-tight"
            style={{ fontFamily: "'DM Sans', sans-serif", letterSpacing: '-0.03em' }}>
            {profile?.full_name || 'Player'}
          </p>
          {details && (
            <div className="flex items-center gap-1.5 mt-2.5 flex-wrap">
              <span className="inline-flex items-center gap-1 h-5 px-2.5 rounded-full bg-white/[0.06] border border-white/[0.07] text-[8px] font-medium tracking-[0.06em] uppercase text-white/45"
                style={{ fontFamily: "'DM Mono', monospace" }}>
                <span className="w-1 h-1 rounded-full bg-[#C8F25A]" />Active
              </span>
              {details.position && (
                <span className="h-5 px-2.5 rounded-full bg-white/[0.06] border border-white/[0.07] text-[8px] font-medium tracking-[0.06em] uppercase text-white/45 inline-flex items-center"
                  style={{ fontFamily: "'DM Mono', monospace" }}>{details.position}</span>
              )}
              {details.current_club && details.age_group && (
                <span className="h-5 px-2.5 rounded-full bg-white/[0.06] border border-white/[0.07] text-[8px] font-medium tracking-[0.06em] uppercase text-white/45 inline-flex items-center"
                  style={{ fontFamily: "'DM Mono', monospace" }}>{details.current_club} {details.age_group}</span>
              )}
            </div>
          )}
        </div>

        {/* Hero Card */}
        <div className="relative rounded-[24px] p-5 mb-3.5 overflow-hidden"
          style={{ background: 'linear-gradient(135deg, #101012 0%, #0f0f12 100%)', border: '1px solid rgba(255,255,255,0.07)' }}>
          <div className="absolute -bottom-[60px] -right-[60px] w-[200px] h-[200px] rounded-full pointer-events-none"
            style={{ background: 'radial-gradient(circle, rgba(200,242,90,0.08) 0%, transparent 70%)' }} />

          <div className="flex items-start justify-between mb-4 relative z-10">
            <div>
              <MetadataLabel text="THIS SEASON" />
              {matches.length > 0 ? (
                <>
                  <p className="text-[52px] leading-none mt-2" style={{
                    fontFamily: "'DM Sans', sans-serif", fontWeight: 300, letterSpacing: '-0.04em',
                    color: BANDS.find(b => b.word.toLowerCase() === seasonBand)?.color
                  }}>
                    {BANDS.find(b => b.word.toLowerCase() === seasonBand)?.word}
                  </p>
                  {lastMatch && (
                    <p className="text-[9px] text-white/22 mt-1.5 tracking-[0.04em]" style={{ fontFamily: "'DM Mono', monospace" }}>
                      Last match · {lastMatch.competition || 'Match'}
                    </p>
                  )}
                </>
              ) : (
                /* ── Welcome state (no matches yet) ── */
                <div className="mt-2">
                  <p className="text-[34px] leading-tight text-white/70"
                    style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 300, letterSpacing: '-0.03em' }}>
                    Your card<br />is ready.
                  </p>
                  <p className="text-[10px] text-white/28 mt-2"
                    style={{ fontFamily: "'DM Sans', sans-serif" }}>
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
                              background: isLast ? band.color : 'rgba(255,255,255,0.10)',
                              boxShadow: isLast ? `0 0 8px rgba(200,242,90,0.5)` : 'none',
                            }} />
                            <span className="text-[7px]" style={{
                              fontFamily: "'DM Mono', monospace",
                              color: isLast ? band.color : 'rgba(255,255,255,0.18)',
                            }}>{abbrs[i]}</span>
                          </div>
                          {!isLast && (
                            <div className="w-3 h-px mb-3" style={{ background: 'rgba(255,255,255,0.06)' }} />
                          )}
                        </div>
                      )
                    })}
                  </div>

                  {/* Coach connection */}
                  <p className="text-[9px] text-white/30 mt-3 tracking-[0.04em]"
                    style={{ fontFamily: "'DM Mono', monospace" }}>
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
                <p className="text-[9px] font-medium tracking-[0.12em] uppercase text-white/22 mb-2"
                  style={{ fontFamily: "'DM Mono', monospace" }}>Trend</p>
                <div className="flex items-end gap-[3px] h-8 justify-end">
                  {trendHeights.map((h, i) => (
                    <div key={i} className="w-2.5 rounded-t" style={{
                      height: `${h}%`,
                      background: i >= trendHeights.length - 2
                        ? (i === trendHeights.length - 1 ? '#C8F25A' : 'rgba(200,242,90,0.35)')
                        : 'rgba(255,255,255,0.08)',
                    }} />
                  ))}
                </div>
                {streakCount >= 3 ? (
                  <p className="text-[10px] font-medium text-[#C8F25A] mt-1.5"
                    style={{ fontFamily: "'DM Mono', monospace" }}>{streakCount} in a row</p>
                ) : isImproving ? (
                  <p className="text-[10px] font-medium text-[#C8F25A] mt-1.5"
                    style={{ fontFamily: "'DM Mono', monospace" }}>↑ improving</p>
                ) : null}
              </div>
            )}
          </div>

          {/* Band summary strip */}
          {matches.length > 0 && (
            <div className="flex items-center justify-between px-3 py-2.5 rounded-[10px] relative z-10"
              style={{ background: 'rgba(0,0,0,0.3)' }}>
              <div className="flex items-center gap-[7px]">
                <div className="w-[5px] h-[5px] rounded-full bg-white/20" />
                <span className="text-[9px] font-medium tracking-[0.08em] uppercase text-white/22"
                  style={{ fontFamily: "'DM Mono', monospace" }}>Season bands</span>
              </div>
              <div className="flex items-center gap-2.5">
                {bandAbbrev.filter(b => distribution[b.key] > 0).map(b => (
                  <span key={b.key} className="text-xs" style={{ fontFamily: "'DM Sans', sans-serif", color: b.color }}>
                    {distribution[b.key]} {b.abbr}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Next milestone */}
          {matches.length > 0 && (
            <div className="flex items-center justify-between px-3 py-2 mt-1.5 rounded-[10px] relative z-10"
              style={{ background: 'rgba(0,0,0,0.2)' }}>
              <span className="text-[9px] tracking-[0.06em] text-white/25"
                style={{ fontFamily: "'DM Mono', monospace" }}>
                Next milestone
              </span>
              {nextMilestone ? (
                <span className="text-[9px] font-medium tracking-[0.04em]"
                  style={{ fontFamily: "'DM Mono', monospace", color: nextMilestone.nextConfig.color }}>
                  {nextMilestone.needed} more {nextMilestone.nextConfig.word} → {nextMilestone.nextConfig.word} season
                </span>
              ) : (
                <span className="text-[9px] tracking-[0.04em] text-white/20"
                  style={{ fontFamily: "'DM Mono', monospace" }}>
                  Season high — Exceptional ✦
                </span>
              )}
            </div>
          )}
        </div>

        {/* Stats grid */}
        {matches.length > 0 && (
          <div className="grid grid-cols-3 gap-2 mt-3.5">
            <div className="rounded-[10px] py-[11px] px-2 text-center" style={{ background: 'rgba(0,0,0,0.35)' }}>
              <p className="text-[22px] font-normal text-white/88 leading-none" style={{ fontFamily: "'DM Sans', sans-serif", letterSpacing: '-0.02em' }}>{matches.length}</p>
              <span className="text-[8px] font-medium tracking-[0.1em] uppercase text-white/22 mt-[5px] block" style={{ fontFamily: "'DM Mono', monospace" }}>Matches</span>
            </div>
            <div className="rounded-[10px] py-[11px] px-2 text-center" style={{ background: 'rgba(0,0,0,0.35)' }}>
              <p className="text-[22px] font-normal text-white/88 leading-none" style={{ fontFamily: "'DM Sans', sans-serif", letterSpacing: '-0.02em' }}>{totalGoals}</p>
              <span className="text-[8px] font-medium tracking-[0.1em] uppercase text-white/22 mt-[5px] block" style={{ fontFamily: "'DM Mono', monospace" }}>Goals</span>
            </div>
            <div className="rounded-[10px] py-[11px] px-2 text-center" style={{ background: 'rgba(0,0,0,0.35)' }}>
              <p className="text-[22px] font-normal text-white/88 leading-none" style={{ fontFamily: "'DM Sans', sans-serif", letterSpacing: '-0.02em' }}>{totalAssists}</p>
              <span className="text-[8px] font-medium tracking-[0.1em] uppercase text-white/22 mt-[5px] block" style={{ fontFamily: "'DM Mono', monospace" }}>Assists</span>
            </div>
          </div>
        )}

        {/* Daily Quote */}
        {(() => {
          const quote = getDailyQuote()
          return (
            <div className="mt-4 rounded-[18px] px-5 py-4"
              style={{ background: '#101012', border: '1px solid rgba(255,255,255,0.06)' }}>
              <p className="text-[9px] tracking-[0.14em] uppercase text-white/25 mb-3"
                style={{ fontFamily: "'DM Mono', monospace" }}>Today</p>
              <p className="text-[15px] font-light leading-[1.5] text-white/75"
                style={{ fontFamily: "'DM Sans', sans-serif", letterSpacing: '-0.01em' }}>
                "{quote.text}"
              </p>
              {quote.author ? (
                <p className="text-[9px] text-white/28 mt-2.5 tracking-[0.06em]"
                  style={{ fontFamily: "'DM Mono', monospace" }}>
                  — {quote.author}
                </p>
              ) : null}
            </div>
          )
        })()}

        {/* Upcoming Events */}
        {upcomingEvents.length > 0 && (
          <div className="mt-5">
            <MetadataLabel text="UPCOMING" />
            <div className="mt-2.5 space-y-2">
              {upcomingEvents.map(ev => {
                const typeColors: Record<string, string> = {
                  match: '#fbbf24',
                  training: '#C8F25A',
                  tournament: '#c084fc',
                  other: 'rgba(255,255,255,0.4)',
                }
                const typeLabels: Record<string, string> = {
                  match: 'MATCH', training: 'TRAINING', tournament: 'TOURNAMENT', other: 'OTHER',
                }
                const color = typeColors[ev.event_type] || typeColors.other
                const label = typeLabels[ev.event_type] || 'EVENT'
                const shown = displayEventTime(ev)
                const d = parseDisplayDate(shown.date) ?? new Date(ev.starts_at)
                const dayStr = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
                // The wall clock the coach typed, rendered as-is. Formatting it
                // through a Date would reintroduce the timezone conversion the
                // calendar columns exist to avoid.
                const timeStr = shown.time ?? 'TBC'
                return (
                  <div key={ev.id}
                    className="flex items-center gap-3 rounded-[14px] p-3.5"
                    style={{ background: '#101012', border: '1px solid rgba(255,255,255,0.06)' }}
                  >
                    <div className="w-1 self-stretch rounded-full flex-shrink-0" style={{ background: color, minHeight: 32 }} />
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-medium truncate" style={{ color: 'rgba(255,255,255,0.88)' }}>{ev.title}</p>
                      <p className="text-[9px] mt-0.5 tracking-[0.06em]"
                        style={{ fontFamily: "'DM Mono', monospace", color: 'rgba(255,255,255,0.35)' }}>
                        {label} · {dayStr} · {timeStr}
                        {ev.venue ? ` · ${ev.venue}` : ''}
                        {ev.opponent ? ` · vs ${ev.opponent}` : ''}
                      </p>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Coach Assessment */}
        {coachAssessment && (
          <div className="mt-5">
            <MetadataLabel text="LATEST COACH ASSESSMENT" />
            <div className="relative rounded-[24px] p-5 mt-2.5 overflow-hidden"
              style={{ background: 'linear-gradient(135deg, #101012 0%, #0f0f12 100%)', border: '1px solid rgba(255,255,255,0.07)' }}>
              <div className="absolute -bottom-[40px] -right-[40px] w-[160px] h-[160px] rounded-full pointer-events-none"
                style={{ background: 'radial-gradient(circle, rgba(200,242,90,0.06) 0%, transparent 70%)' }} />
              <div className="relative z-10">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <p className="text-[13px] font-medium text-white/88">{coachName || 'Coach'}</p>
                    <p className="text-[9px] text-white/22 mt-0.5 tracking-[0.04em]"
                      style={{ fontFamily: "'DM Mono', monospace" }}>
                      {new Date(coachAssessment.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                    </p>
                  </div>
                  <BandPill band={scoreToBand(
                    (coachAssessment.work_rate + coachAssessment.tactical + coachAssessment.attitude +
                     coachAssessment.technical + coachAssessment.physical + coachAssessment.coachability) / 6
                  )} />
                </div>

                {/* Category bars */}
                <div className="space-y-3 mt-4">
                  {[
                    { label: 'Work Rate',    score: coachAssessment.work_rate    },
                    { label: 'Tactical',     score: coachAssessment.tactical     },
                    { label: 'Attitude',     score: coachAssessment.attitude     },
                    { label: 'Technical',    score: coachAssessment.technical    },
                    { label: 'Physical',     score: coachAssessment.physical     },
                    { label: 'Coachability', score: coachAssessment.coachability },
                  ].map(cat => (
                    <div key={cat.label} className="flex items-center gap-2">
                      <span className="w-[90px] flex-shrink-0 text-[9px] font-medium tracking-[0.12em] uppercase text-white/45"
                        style={{ fontFamily: "'DM Mono', monospace" }}>{cat.label}</span>
                      <div className="flex-1 h-1.5 rounded-full bg-[#202024] overflow-hidden">
                        <div className="h-full rounded-full transition-all duration-500"
                          style={{
                            width: `${((cat.score || 5) / 10) * 100}%`,
                            backgroundColor: BANDS.find(b => b.word.toLowerCase() === scoreToBand(cat.score || 5))?.color,
                          }} />
                      </div>
                      <span className="text-[11px] flex-shrink-0 w-[72px] text-right"
                        style={{ color: BANDS.find(b => b.word.toLowerCase() === scoreToBand(cat.score || 5))?.color }}>
                        {BANDS.find(b => b.word.toLowerCase() === scoreToBand(cat.score || 5))?.word}
                      </span>
                    </div>
                  ))}
                </div>

                {/* TRAK-71: the coach's message in full, here, with no tap-through. */}
                {feedbackLoadFailed ? (
                  <p role="alert" className="mt-4 text-[12px] text-white/55">
                    Couldn't load your coach's message. Pull down to refresh and try again.
                  </p>
                ) : coachAssessmentNote ? (
                  <div className="mt-4 pt-4 border-t border-white/[0.06]">
                    <MetadataLabel text="MESSAGE FROM YOUR COACH" />
                    <p className="mt-1.5 text-[13px] leading-relaxed text-white/80 whitespace-pre-line">{coachAssessmentNote}</p>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        )}

        {/* Recent Matches */}
        {recentMatches.length > 0 && (
          <div className="mt-5">
            <MetadataLabel text="RECENT MATCHES" />
            <div className="mt-2.5 space-y-2">
              {recentMatches.map(m => {
                const band = scoreToBand(m.computed_rating || 6.5)
                // Same source of truth as PlayerMatches: when the match was played,
                // falling back to when the row was logged. The two screens used
                // to disagree about the same match's date.
                const formattedDate = parseDisplayDate(m.match_date || m.created_at)
                  ?.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) ?? ''
                const result = m.team_score != null && m.opponent_score != null
                  ? (m.team_score > m.opponent_score ? 'W' : m.team_score < m.opponent_score ? 'L' : 'D')
                  : null
                const resultColor = result === 'W' ? '#4ade80' : result === 'L' ? '#f87171' : '#fbbf24'
                return (
                  <button
                    key={m.id}
                    onClick={() => navigate(`/player/match/${m.id}`)}
                    className="w-full flex items-center justify-between rounded-[12px] px-4 py-3 text-left active:scale-[0.99] transition-transform"
                    style={{ background: '#101012', border: '1px solid rgba(255,255,255,0.07)' }}
                  >
                    <div className="flex-1 min-w-0 mr-3">
                      <p className="text-[13px] font-medium text-white/88 truncate">
                        {m.opponent ? `vs ${m.opponent}` : m.competition || 'Match'}
                      </p>
                      <p className="text-[9px] text-white/[0.28] mt-[3px] tracking-[0.05em]"
                        style={{ fontFamily: "'DM Mono', monospace" }}>
                        {formattedDate}{m.competition ? ` · ${m.competition}` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {result && (
                        <span className="text-[10px] font-semibold" style={{ color: resultColor, fontFamily: "'DM Mono', monospace" }}>
                          {result}{m.team_score != null && m.opponent_score != null ? ` ${m.team_score}–${m.opponent_score}` : ''}
                        </span>
                      )}
                      <BandPill band={band} />
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>
      <NavBar role="player" activeTab={location.pathname} onNavigate={navigate} />

      {showReveal && lastMatch && (
        <CardRevealModal
          bandWord={seasonBandConfig.word}
          bandColor={seasonBandConfig.color}
          newMatchCount={newMatchCount}
          latestMatch={lastMatch}
          onDismiss={handleRevealDismiss}
        />
      )}
    </MobileShell>
  )
}
