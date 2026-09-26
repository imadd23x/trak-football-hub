import { useEffect, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { supabase } from '@/integrations/supabase/client'
import { useAuth } from '@/contexts/AuthContext'
import { MobileShell, NavBar, MetadataLabel, BandPill, LoadError} from '@/components/trak'
import { toast } from 'sonner'
import { Zap } from 'lucide-react'
import { scoreToBand } from '@/lib/rating-engine'
import { BANDS } from '@/lib/types'
import { calculateSquadAnalytics, type SquadAnalytics } from '@/lib/squad-analytics'
import { trackEvent } from '@/lib/telemetry'
import { generateCode } from '@/lib/invite-codes'
import { openable } from '@/lib/openable'
import { timeOfDayGreeting } from '@/lib/greeting'

// Derived from BANDS rather than restated. CLAUDE.md says colours never live
// outside the BANDS config, and this file had a seventh-hand copy of them: the
// two maps happened to agree today, which is exactly how a colour survives a
// rename in one place and not the other. Two more copies exist in
// src/lib/clubMock.ts and src/lib/matchDetailHelpers.ts — player-side files,
// flagged to Tarek rather than edited here.
const BAND_COLORS: Record<string, string> = Object.fromEntries(
  BANDS.map(b => [b.word.toLowerCase(), b.color]),
)

export default function CoachHomePage() {
  const { user, profile } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [playerCount, setPlayerCount] = useState(0)
  const [assessments, setAssessments] = useState<any[]>([])
  const [allAssessments, setAllAssessments] = useState<any[]>([])
  const [loadFailed, setLoadFailed] = useState(false)
  const [sessionCount, setSessionCount] = useState(0)
  const [coachDetails, setCoachDetails] = useState<any>(null)
  const [inviteCode, setInviteCode] = useState('TRK-XXXX')
  // Three states, not a boolean. A failure flag that nothing clears leaves a
  // valid code showing as "Unavailable" after a later read succeeds, and while
  // the first read is still in flight the copyable placeholder "TRK-XXXX" is on
  // screen for a coach to hand over in good faith. Only 'ready' may be copied.
  const [inviteStatus, setInviteStatus] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [squadAnalytics, setSquadAnalytics] = useState<SquadAnalytics | null>(null)
  // Distinguishes "nothing to show" from "we could not find out". Without it
  // the band strip and the distribution chart render their empty state on a
  // failed read, which is a claim about the squad rather than about the network.
  const [analyticsFailed, setAnalyticsFailed] = useState(false)

  useEffect(() => {
    if (!user) return
    // A response from a previous run must not overwrite the current one's
    // state on an Auth refresh for the same account.
    let cancelled = false
    /* Union of two fixes that arrived on this file from opposite directions,
       and I caused the overlap: #44 (this PR) already tracked a failed roster
       and analytics read via analyticsFailed, and #79 then added loadFailed
       for the SAME screen because I did not check what this branch already
       had. Neither is redundant now — analyticsFailed guards the band strip
       and distribution, loadFailed covers the two reads #44 never checked
       (recent assessments, session count) and suppresses their false zeros.
       Taking either side whole would have dropped the other's coverage. */
    supabase.from('squad_players').select('id, player_name').eq('coach_user_id', user.id)
      .then(({ data, error }) => {
        if (cancelled) return
        // A failed roster read is not an empty roster. Falling through to
        // `data || []` here reported the squad as 0 players AND handed
        // calculateSquadAnalytics an empty roster, which flags nobody and
        // bands nobody — a coach offline would be told their squad is empty
        // and that nothing needs attention. Both statements would be false.
        if (error) {
          console.error('Squad read failed:', error)
          setAnalyticsFailed(true)
          setLoadFailed(true)
          return
        }
        const players = data || []
        setPlayerCount(players.length)
        // Fetch all assessments for analytics
        supabase.from('coach_assessments').select('id, squad_player_id, coach_rating, created_at')
          .eq('coach_user_id', user.id)
          .order('created_at', { ascending: false })
          .then(({ data: allData, error: assessError }) => {
            if (cancelled) return
            if (assessError) {
              console.error('Assessment read failed:', assessError)
              setAnalyticsFailed(true)
              setLoadFailed(true)
              return
            }
            const allAssess = allData || []
            setAllAssessments(allAssess)
            setAnalyticsFailed(false)
            setLoadFailed(false)
            const analytics = calculateSquadAnalytics(players, allAssess)
            setSquadAnalytics(analytics)
            trackEvent('squad_analytics_viewed', {})
          })
      })
    supabase.from('coach_assessments').select('*, squad_players(player_name)')
      .eq('coach_user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(5)
      .then(({ data, error }) => { if (error) { setLoadFailed(true); return } setAssessments(data || []) })
    supabase.from('coach_sessions').select('id', { count: 'exact' }).eq('coach_user_id', user.id)
      .then(({ count, error }) => { if (error) { setLoadFailed(true); return } setSessionCount(count || 0) })
    supabase.from('coach_details').select('current_club, team, coach_role').eq('user_id', user.id).maybeSingle()
      .then(({ data }) => setCoachDetails(data))
    supabase.from('profiles').select('invite_code').eq('user_id', user.id).maybeSingle()
      .then(async ({ data, error }) => {
        // A failed read is not "this coach has no code". The error was
        // discarded here, so an offline moment or an RLS denial fell through to
        // the else branch and OVERWROTE the coach's existing invite code with a
        // freshly generated one — silently rotating the code every player had
        // already been given, and breaking every pending link.
        if (cancelled) return
        if (error) {
          console.error('Invite code read failed:', error)
          setInviteStatus('failed')
          return
        }

        if (data?.invite_code) {
          setInviteCode(`TRK-${data.invite_code}`)
          setInviteStatus('ready')   // clears an earlier failure
          return
        }

        // Genuinely no code yet. Only now is generating one correct.
        const newCode = generateCode()
        // select() back, so a zero-row update is not mistaken for a stored
        // code. An absent profile row updates nothing and returns no error,
        // and the coach would be shown a code the database never accepted —
        // the same "no error means success" mistake, one layer down.
        const { data: stored, error: writeError } = await supabase
          .from('profiles').update({ invite_code: newCode })
          .eq('user_id', user.id).select('invite_code').maybeSingle()
        if (cancelled) return
        if (writeError || stored?.invite_code !== newCode) {
          console.error('Invite code write failed or stored nothing:', writeError)
          setInviteStatus('failed')
          return
        }
        setInviteCode(`TRK-${newCode}`)
        setInviteStatus('ready')
      })

    return () => { cancelled = true }
  }, [user])

  const greeting = timeOfDayGreeting()

  // Squad bands: one chip per band that any player is currently in, in that
  // band's own colour.
  //
  // This strip used to collapse seven bands into four glyphs, and both halves
  // of that were wrong:
  //
  //   good + steady  -> one green check, in Good's green. Tarek saw it on a
  //                     real phone: "1 of the 3 classified as good should have
  //                     been steady." The screen could not tell them apart.
  //   developing +
  //   difficult      -> one dash, coloured #60a5fa — which BANDS assigns to
  //                     STEADY. The two weakest bands rendered in a mid-band
  //                     blue, so a struggling squad read as an unremarkable one.
  //
  // It also counted ASSESSMENTS while sitting beside the player count and
  // calling itself "Squad bands". The busiest coach in the pilot database has
  // 52 assessments across 21 players, so the strip added up to 52 next to a
  // squad of 21. squadBands takes each player's latest assessment instead.
  const squadBandChips = squadAnalytics
    ? BANDS.map(b => ({ word: b.word, color: b.color, count: squadAnalytics.squadBands[b.word.toLowerCase()] || 0 }))
        .filter(c => c.count > 0)
    : []

  // Trend: last 5 assessments for mini-chart. An unrated assessment is dropped
  // rather than drawn at the midpoint — a bar the coach never earned.
  const trendAssessments = allAssessments.filter(a => a.coach_rating != null).slice(0, 5).reverse()
  const trendHeights = trendAssessments.map(a => {
    const r = Number(a.coach_rating)
    return Math.max(20, Math.min(100, ((r - 2) / 8) * 100))
  })

  // Initials helper
  const getInitials = (name: string) => {
    const parts = name.trim().split(/\s+/)
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    return (parts[0]?.[0] || '?').toUpperCase()
  }

  // Max band count for bar chart scaling
  const maxBandCount = squadAnalytics
    ? Math.max(1, ...Object.values(squadAnalytics.bandDistribution))
    : 1

  return (
    <MobileShell>
      <div className="pt-3 pb-4">
        {/* TRAK header row */}
        <div className="flex items-center justify-between mb-1">
          <span
            className="text-[11px] font-medium tracking-[0.14em] uppercase"
            style={{ fontFamily: "'DM Mono', monospace", color: 'rgba(255,255,255,0.2)' }}
          >
            TRAK
          </span>
        </div>

        {/* A failed load must not be reported as a season with nothing in it.
            Shown above the stats rather than replacing them, so anything that
            DID load still reaches the coach — partial truth beats a blank
            screen, and beats a confident zero. */}
        {loadFailed && (
          <div className="mb-4">
            <LoadError what="your squad" />
          </div>
        )}

        {/* Identity section */}
        <div className="py-2.5 pb-4">
          <p className="text-xs" style={{ color: 'rgba(255,255,255,0.22)' }}>{greeting}</p>
          <p
            className="text-[28px] leading-tight"
            style={{
              fontFamily: "'DM Sans', sans-serif",
              fontWeight: 300,
              letterSpacing: '-0.03em',
              color: 'rgba(255,255,255,0.88)',
            }}
          >
            {profile?.full_name || 'Coach'}
          </p>
          <div className="flex items-center gap-1.5 mt-2.5 flex-wrap">
            <span
              className="inline-flex items-center gap-1 h-5 px-2.5 rounded-full border border-white/[0.07] text-[8px] font-medium tracking-[0.06em] uppercase"
              style={{
                fontFamily: "'DM Mono', monospace",
                background: 'rgba(255,255,255,0.06)',
                color: 'rgba(255,255,255,0.45)',
              }}
            >
              <span className="w-1 h-1 rounded-full" style={{ background: '#C8F25A' }} />
              Active
            </span>
            {coachDetails?.coach_role && (
              <span
                className="h-5 px-2.5 rounded-full border border-white/[0.07] text-[8px] font-medium tracking-[0.06em] uppercase inline-flex items-center"
                style={{
                  fontFamily: "'DM Mono', monospace",
                  background: 'rgba(255,255,255,0.06)',
                  color: 'rgba(255,255,255,0.45)',
                }}
              >
                {coachDetails.coach_role}
              </span>
            )}
            {coachDetails?.current_club && coachDetails?.team && (
              <span
                className="h-5 px-2.5 rounded-full border border-white/[0.07] text-[8px] font-medium tracking-[0.06em] uppercase inline-flex items-center"
                style={{
                  fontFamily: "'DM Mono', monospace",
                  background: 'rgba(255,255,255,0.06)',
                  color: 'rgba(255,255,255,0.45)',
                }}
              >
                {coachDetails.current_club} {coachDetails.team}
              </span>
            )}
          </div>
        </div>

        {/* Hero card */}
        <div
          className="relative overflow-hidden rounded-[24px] border border-white/[0.07] p-5 my-[6px] mb-[14px]"
          style={{ background: 'linear-gradient(135deg, #101012 0%, #0f0f12 100%)' }}
        >
          {/* Radial glow ::after pseudo via div */}
          <div
            className="absolute -bottom-[60px] -right-[60px] w-[200px] h-[200px] rounded-full pointer-events-none"
            style={{ background: 'radial-gradient(circle, rgba(200,242,90,0.08) 0%, transparent 70%)' }}
          />

          <div className="flex items-start justify-between mb-4 relative z-10">
            {/* Left: player count */}
            <div>
              <MetadataLabel text="THIS SEASON" />
              <p
                className="text-[52px] leading-none mt-2"
                style={{
                  fontFamily: "'DM Sans', sans-serif",
                  fontWeight: 300,
                  letterSpacing: '-0.04em',
                  color: '#C8F25A',
                }}
              >
                {loadFailed && playerCount === 0 ? '—' : playerCount}
              </p>
              <p
                className="text-[9px] mt-1.5 tracking-[0.04em]"
                style={{ fontFamily: "'DM Mono', monospace", color: 'rgba(255,255,255,0.22)' }}
              >
                Players in squad
              </p>
            </div>

            {/* Right: assessments + trend chart */}
            <div className="text-right">
              <p
                className="text-[9px] font-medium tracking-[0.12em] uppercase mb-2"
                style={{ fontFamily: "'DM Mono', monospace", color: 'rgba(255,255,255,0.22)' }}
              >
                Assessments
              </p>
              {trendHeights.length > 0 && (
                <div className="flex items-end gap-[3px] h-8 justify-end">
                  {trendHeights.map((h, i) => (
                    <div
                      key={i}
                      className="w-2.5 rounded-t"
                      style={{
                        height: `${h}%`,
                        background:
                          i >= trendHeights.length - 2
                            ? i === trendHeights.length - 1
                              ? '#C8F25A'
                              : 'rgba(200,242,90,0.35)'
                            : 'rgba(255,255,255,0.08)',
                      }}
                    />
                  ))}
                </div>
              )}
              <p
                className="text-[13px] font-medium mt-1.5"
                style={{ fontFamily: "'DM Sans', sans-serif", color: 'rgba(255,255,255,0.45)' }}
              >
                {loadFailed && allAssessments.length === 0 ? 'Not available' : `${allAssessments.length} total`}
              </p>
            </div>
          </div>

          {/* Band summary strip */}
          <div
            className="flex items-center justify-between px-3 py-2.5 rounded-[10px] relative z-10"
            style={{ background: 'rgba(0,0,0,0.3)' }}
          >
            <div className="flex items-center gap-[7px]">
              <div className="w-[5px] h-[5px] rounded-full" style={{ background: 'rgba(255,255,255,0.2)' }} />
              <span
                className="text-[9px] font-medium tracking-[0.08em] uppercase"
                style={{ fontFamily: "'DM Mono', monospace", color: 'rgba(255,255,255,0.22)' }}
              >
                Squad bands
              </span>
            </div>
            <div className="flex items-center gap-2.5 overflow-x-auto no-scrollbar">
              {analyticsFailed ? (
                <span
                  className="text-[10px]"
                  style={{ fontFamily: "'DM Mono', monospace", color: 'rgba(251,191,36,0.7)' }}
                >
                  Couldn't load
                </span>
              ) : squadBandChips.length === 0 ? (
                <span
                  className="text-[10px]"
                  style={{ fontFamily: "'DM Mono', monospace", color: 'rgba(255,255,255,0.25)' }}
                >
                  No assessments yet
                </span>
              ) : (
                squadBandChips.map(chip => (
                  // The word, not a glyph. Four glyphs cannot name seven bands,
                  // and a coach reading a colour alone is reading the thing that
                  // was wrong here in the first place.
                  <span
                    key={chip.word}
                    className="inline-flex items-center gap-1 text-xs whitespace-nowrap flex-shrink-0"
                    style={{ fontFamily: "'DM Sans', sans-serif", color: chip.color }}
                  >
                    {chip.count}
                    <span className="text-[9px]" style={{ fontFamily: "'DM Mono', monospace" }}>
                      {chip.word}
                    </span>
                  </span>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Quick actions grid: 3 columns */}
        <div className="grid grid-cols-3 gap-2 mt-1">
          <button
            onClick={() => navigate('/coach/squad')}
            className="rounded-[10px] p-[11px_8px] text-center active:scale-95 transition-transform"
            style={{ background: 'rgba(0,0,0,0.35)' }}
          >
            <p
              className="text-[22px] leading-none"
              style={{
                fontFamily: "'DM Sans', sans-serif",
                fontWeight: 400,
                letterSpacing: '-0.02em',
                color: 'rgba(255,255,255,0.88)',
              }}
            >
              {playerCount}
            </p>
            <span
              className="text-[8px] font-medium tracking-[0.1em] uppercase mt-[5px] block"
              style={{ fontFamily: "'DM Mono', monospace", color: 'rgba(255,255,255,0.22)' }}
            >
              Squad
            </span>
          </button>
          <button
            onClick={() => navigate('/coach/sessions')}
            className="rounded-[10px] p-[11px_8px] text-center active:scale-95 transition-transform"
            style={{ background: 'rgba(0,0,0,0.35)' }}
          >
            <p
              className="text-[22px] leading-none"
              style={{
                fontFamily: "'DM Sans', sans-serif",
                fontWeight: 400,
                letterSpacing: '-0.02em',
                color: 'rgba(255,255,255,0.88)',
              }}
            >
              {sessionCount}
            </p>
            <span
              className="text-[8px] font-medium tracking-[0.1em] uppercase mt-[5px] block"
              style={{ fontFamily: "'DM Mono', monospace", color: 'rgba(255,255,255,0.22)' }}
            >
              Sessions
            </span>
          </button>
          <button
            onClick={() => {
              // Only a verified code may be copied. While the read is pending
              // the placeholder is on screen and copying it hands a player a
              // code that matches nothing.
              if (inviteStatus !== 'ready') {
                toast.error(
                  inviteStatus === 'loading'
                    ? 'Still loading your invite code — one moment.'
                    : "Couldn't load your invite code — reload and try again.",
                )
                return
              }
              navigator.clipboard.writeText(inviteCode)
              toast.success('Code copied!')
            }}
            className="rounded-[10px] p-[11px_8px] text-center border active:scale-95 transition-transform"
            style={{
              background: 'rgba(200,242,90,0.06)',
              borderColor: 'rgba(200,242,90,0.2)',
              boxShadow: '0 0 20px rgba(200,242,90,0.05)',
            }}
          >
            <p
              className="text-[13px] font-semibold leading-none mb-0.5"
              style={{
                fontFamily: "'DM Mono', monospace",
                letterSpacing: '0.04em',
                color: '#C8F25A',
              }}
            >
              {inviteStatus === 'ready' ? inviteCode
                : inviteStatus === 'loading' ? '···'
                : 'Unavailable'}
            </p>
            <span
              className="text-[8px] font-medium tracking-[0.1em] uppercase mt-[5px] block"
              style={{ fontFamily: "'DM Mono', monospace", color: 'rgba(255,255,255,0.22)' }}
            >
              Tap to copy
            </span>
          </button>
        </div>

        {/* Empty squad callout */}
        {playerCount === 0 && (
          <button
            onClick={() => navigate('/coach/squad/add')}
            className="w-full mt-3 rounded-[14px] border p-4 text-left active:scale-[0.98] transition-transform"
            style={{ background: '#101012', borderColor: 'rgba(255,255,255,0.07)' }}
          >
            <p className="text-[13px] font-medium text-white/70" style={{ fontFamily: "'DM Sans', sans-serif" }}>
              Add players to your squad
            </p>
            <p className="text-[10px] mt-0.5 text-white/35" style={{ fontFamily: "'DM Mono', monospace" }}>
              Once you've added players you can assess them, log matches, and track progress →
            </p>
          </button>
        )}

        {/* Quick Assess CTA */}
        {playerCount > 0 && (
          <button
            onClick={() => navigate('/coach/quick-assess')}
            className="w-full mt-3 relative overflow-hidden rounded-[14px] border p-4 text-left active:scale-[0.98] transition-transform"
            style={{
              background: 'rgba(200,242,90,0.06)',
              borderColor: 'rgba(200,242,90,0.2)',
              boxShadow: '0 0 28px rgba(200,242,90,0.06)',
            }}
          >
            <div
              className="absolute -bottom-[40px] -right-[40px] w-[140px] h-[140px] rounded-full pointer-events-none"
              style={{ background: 'radial-gradient(circle, rgba(200,242,90,0.1) 0%, transparent 70%)' }}
            />
            <div className="relative z-10">
              <div className="flex items-center gap-2 mb-1">
                <Zap size={16} color="#C8F25A" fill="#C8F25A" strokeWidth={1.5} />
                <span
                  className="text-[14px] font-semibold"
                  style={{ color: '#C8F25A', fontFamily: "'DM Sans', sans-serif" }}
                >
                  Quick Assess
                </span>
              </div>
              <p
                className="text-[11px] mt-1"
                style={{ fontFamily: "'DM Mono', monospace", color: 'rgba(255,255,255,0.3)' }}
              >
                Swipe through your squad and rate each player fast
              </p>
            </div>
          </button>
        )}

        {/* AI Tools */}
        <div className="grid grid-cols-2 gap-2 mt-3">
          <button
            onClick={() => navigate('/coach/schedule')}
            className="rounded-[14px] border p-3.5 text-left active:scale-[0.98] transition-transform"
            style={{ background: '#101012', borderColor: 'rgba(255,255,255,0.07)' }}
          >
            <p className="text-[13px] font-medium" style={{ color: 'rgba(255,255,255,0.88)' }}>Smart Calendar</p>
            <p className="text-[10px] mt-0.5" style={{ color: 'rgba(255,255,255,0.4)' }}>Paste a schedule, parse to events</p>
          </button>
          <button
            onClick={() => navigate('/coach/assistant')}
            className="rounded-[14px] border p-3.5 text-left active:scale-[0.98] transition-transform"
            style={{ background: '#101012', borderColor: 'rgba(255,255,255,0.07)' }}
          >
            <p className="text-[13px] font-medium" style={{ color: 'rgba(255,255,255,0.88)' }}>Coach Assistant</p>
            <p className="text-[10px] mt-0.5" style={{ color: 'rgba(255,255,255,0.4)' }}>Drills & session ideas</p>
          </button>
        </div>

        {/* Recent Assessments */}
        {assessments.length > 0 && (
          <div className="mt-5">
            <MetadataLabel text="RECENT ASSESSMENTS" />
            <div className="mt-2.5">
              {assessments.map(a => {
                const playerName = a.squad_players?.player_name || 'Player'
                const initials = getInitials(playerName)
                const formattedDate = new Date(a.created_at).toLocaleDateString('en-GB', {
                  day: 'numeric',
                  month: 'short',
                })
                return (
                  <div
                    key={a.id}
                    className="flex items-center gap-3 rounded-[14px] border border-white/[0.07] p-[13px_14px] mb-2 cursor-pointer active:scale-[0.99] transition-transform"
                    style={{ background: '#101012' }}
                    {...openable(`Open assessment for ${playerName}, ${formattedDate}`,
                      () => navigate(`/coach/assess?assessment=${a.id}`))}
                  >
                    {/* Initials avatar */}
                    <div
                      className="w-9 h-9 rounded-[11px] border border-white/[0.07] flex items-center justify-center text-xs font-semibold flex-shrink-0"
                      style={{ background: '#202024', color: 'rgba(255,255,255,0.45)' }}
                    >
                      {initials}
                    </div>
                    {/* Name + metadata */}
                    <div className="flex-1 min-w-0">
                      <p
                        className="text-[13px] font-medium truncate"
                        style={{ color: 'rgba(255,255,255,0.88)' }}
                      >
                        {playerName}
                      </p>
                      <p
                        className="text-[9px] mt-[3px] tracking-[0.04em]"
                        style={{ fontFamily: "'DM Mono', monospace", color: 'rgba(255,255,255,0.22)' }}
                      >
                        {formattedDate} · {a.appearance || 'Assessment'}
                      </p>
                    </div>
                    {/* Band pill. No `|| 5` fallback: showing "Mixed" for an
                        assessment whose rating we do not have is an opinion
                        about a child that no coach recorded. */}
                    <div className="flex-shrink-0">
                      {a.coach_rating != null && <BandPill band={scoreToBand(Number(a.coach_rating))} />}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Squad Overview */}
        {squadAnalytics && squadAnalytics.totalAssessments > 0 && (
          <div className="mt-5">
            <span
              className="text-[9px] font-medium tracking-[0.12em] uppercase block mb-3"
              style={{ fontFamily: "'DM Mono', monospace", color: 'rgba(255,255,255,0.22)' }}
            >
              Squad Overview
            </span>

            {/* Band Distribution Bar Chart */}
            <div
              className="rounded-[18px] border border-white/[0.07] p-4 mb-3"
              style={{ background: '#101012' }}
            >
              <span
                className="text-[9px] font-medium tracking-[0.08em] uppercase block mb-3"
                style={{ fontFamily: "'DM Mono', monospace", color: 'rgba(255,255,255,0.3)' }}
              >
                Band Distribution · all assessments
              </span>
              <div className="flex flex-col gap-[7px]">
                {BANDS.map(b => {
                  const bandKey = b.word.toLowerCase()
                  const count = squadAnalytics.bandDistribution[bandKey] || 0
                  const widthPct = maxBandCount > 0 ? (count / maxBandCount) * 100 : 0
                  return (
                    <div key={bandKey} className="flex items-center gap-2">
                      <span
                        className="text-[10px] w-[90px] flex-shrink-0 text-right"
                        style={{
                          fontFamily: "'DM Mono', monospace",
                          color: BAND_COLORS[bandKey] || 'rgba(255,255,255,0.4)',
                        }}
                      >
                        {b.word}
                      </span>
                      <div
                        className="flex-1 h-[14px] rounded-[4px] overflow-hidden"
                        style={{ background: 'rgba(255,255,255,0.04)' }}
                      >
                        {count > 0 && (
                          <div
                            className="h-full rounded-[4px] transition-all duration-500"
                            style={{
                              width: `${widthPct}%`,
                              minWidth: '4px',
                              background: BAND_COLORS[bandKey] || 'rgba(255,255,255,0.4)',
                              opacity: 0.7,
                            }}
                          />
                        )}
                      </div>
                      <span
                        className="text-[10px] w-[24px] text-right flex-shrink-0"
                        style={{
                          fontFamily: "'DM Mono', monospace",
                          color: count > 0 ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.15)',
                        }}
                      >
                        {count}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Most Improved */}
            {squadAnalytics.mostImproved && (
              <div
                className="rounded-[18px] border border-white/[0.07] p-4 mb-3"
                style={{ background: '#101012' }}
              >
                <span
                  className="text-[9px] font-medium tracking-[0.08em] uppercase block mb-2"
                  style={{ fontFamily: "'DM Mono', monospace", color: 'rgba(255,255,255,0.3)' }}
                >
                  Most Improved
                </span>
                <div className="flex items-center justify-between">
                  <span
                    className="text-[14px] font-medium"
                    style={{ fontFamily: "'DM Sans', sans-serif", color: 'rgba(255,255,255,0.88)' }}
                  >
                    {squadAnalytics.mostImproved.name}
                  </span>
                  <span
                    className="text-[13px] font-semibold"
                    style={{ fontFamily: "'DM Mono', monospace", color: '#4ade80' }}
                  >
                    ↑ +{squadAnalytics.mostImproved.improvement.toFixed(1)}
                  </span>
                </div>
              </div>
            )}

            {/* Needs Attention — max 3, only players with prior history */}
            {squadAnalytics.needsAttention.length > 0 && (
              <div
                className="rounded-[18px] border border-white/[0.07] p-4"
                style={{ background: '#101012' }}
              >
                <span
                  className="text-[9px] font-medium tracking-[0.08em] uppercase block mb-2.5"
                  style={{ fontFamily: "'DM Mono', monospace", color: 'rgba(255,255,255,0.3)' }}
                >
                  Needs Attention
                </span>
                <div className="flex flex-col gap-2">
                  {squadAnalytics.needsAttention.map(item => (
                    <div
                      key={item.playerId}
                      className="rounded-[10px] py-2.5 px-3"
                      style={{
                        background: 'rgba(251,146,60,0.06)',
                        borderLeft: '3px solid #fb923c',
                      }}
                    >
                      <p
                        className="text-[13px] font-medium"
                        style={{ fontFamily: "'DM Sans', sans-serif", color: 'rgba(255,255,255,0.78)' }}
                      >
                        {item.name}
                      </p>
                      <p
                        className="text-[10px] mt-[2px]"
                        style={{ fontFamily: "'DM Mono', monospace", color: 'rgba(255,255,255,0.3)' }}
                      >
                        {item.reason}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

          </div>
        )}
      </div>
      <NavBar role="coach" activeTab={location.pathname} onNavigate={navigate} />
    </MobileShell>
  )
}
