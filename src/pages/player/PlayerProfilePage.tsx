import { useEffect, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { supabase } from '@/integrations/supabase/client'
import { useAuth } from '@/contexts/AuthContext'
import { MobileShell, NavBar, MetadataLabel } from '@/components/trak'
import { IconPassport, IconHowItWorks } from '@/components/icons/TrakIcons'
import { ChevronRight, Settings as SettingsIcon } from 'lucide-react'
import { trackEvent } from '@/lib/telemetry'
import { bandForScore } from '@/lib/rating-engine'
import RatingTrendChart from '@/components/player/RatingTrendChart'
import { ParentInviteCard } from '@/components/player/ParentInviteCard'
import { PlayerConnections } from '@/components/player/PlayerConnections'

type TrendFilter = 'last5' | 'last10' | 'all'

export default function PlayerProfilePage() {
  const { user, profile } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [details, setDetails] = useState<any>(null)
  const [assessments, setAssessments] = useState<any[]>([])
  const assessment = assessments[0] ?? null
  const [matchHistory, setMatchHistory] = useState<{ created_at: string; computed_rating: number }[]>([])
  const [trendFilter, setTrendFilter] = useState<TrendFilter>('all')

  useEffect(() => {
    if (!user) return
    supabase.from('player_details').select('*').eq('user_id', user.id).maybeSingle().then(({ data }) => setDetails(data))
    supabase.from('matches').select('computed_rating, created_at').eq('user_id', user.id).order('created_at', { ascending: true }).then(({ data }) => {
      if (!data) return
      // TRAK-289: the rating trend reads rated matches only; a Games match has no rating.
      setMatchHistory(data.flatMap(m => m.computed_rating == null ? [] : [{ created_at: m.created_at ?? '', computed_rating: m.computed_rating }]))
    })
    // Coach assessments, newest first — via squad_players, since
    // coach_assessments.squad_player_id is a row ID, not a user ID.
    supabase.from('squad_players').select('id').eq('linked_player_id', user.id)
      .then(async ({ data: squadRows }) => {
        if (!squadRows?.length) return
        const ids = squadRows.map((r: any) => r.id)
        const { data } = await supabase.from('coach_assessments')
          .select('id, created_at, work_rate, tactical, attitude, technical, physical, coachability')
          .in('squad_player_id', ids)
          .order('created_at', { ascending: false })
          .limit(10)
        setAssessments(data ?? [])
      })
  }, [user])

  // Track chart view once we have enough data
  useEffect(() => {
    if (matchHistory.length >= 3) {
      trackEvent('chart_viewed', { type: 'trend' })
    }
  }, [matchHistory])

  const filteredMatches = (() => {
    if (trendFilter === 'last5') return matchHistory.slice(-5)
    if (trendFilter === 'last10') return matchHistory.slice(-10)
    return matchHistory
  })()

  const initials = profile?.full_name
    ? profile.full_name.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2)
    : '?'

  const assessmentCategories = assessment ? [
    { name: 'Work Rate', score: assessment.work_rate },
    { name: 'Tactical', score: assessment.tactical },
    { name: 'Attitude', score: assessment.attitude },
    { name: 'Technical', score: assessment.technical },
    { name: 'Physical', score: assessment.physical },
    { name: 'Coachability', score: assessment.coachability },
  ] : []

  const FILTER_OPTIONS: { key: TrendFilter; label: string }[] = [
    { key: 'last5', label: 'Last 5' },
    { key: 'last10', label: 'Last 10' },
    { key: 'all', label: 'All' },
  ]

  return (
    <MobileShell>
      <div className="flex items-center justify-between pt-3 pb-2 border-b border-line">
        <span className="text-[16px] font-medium text-ink" style={{ fontFamily: 'var(--t-font)' }}>Profile</span>
      </div>

      <div className="pt-3.5 pb-4 space-y-2.5">
        {/* Avatar + Identity */}
        <div className="text-center mb-6">
          <div className="w-[72px] h-[72px] rounded-[22px] overflow-hidden bg-raised border border-brand/[0.18] mx-auto mb-3 flex items-center justify-center">
            <span className="text-2xl font-semibold text-primary" aria-hidden="true">
              {(profile?.full_name || '?').charAt(0).toUpperCase()}
            </span>
          </div>
          <p className="text-[20px] font-semibold text-ink tracking-tight" style={{ fontFamily: 'var(--t-font)', letterSpacing: '-0.02em' }}>
            {profile?.full_name}
          </p>
          <div className="flex justify-center gap-1.5 mt-2 flex-wrap">
            {details?.position && (
              <span className="h-5 px-2.5 rounded-full bg-raised border border-line text-[8px] font-medium tracking-[0.06em] uppercase text-ink-3 inline-flex items-center"
                style={{ fontFamily: 'var(--t-font-mono)' }}>{details.position}</span>
            )}
            {details?.current_club && (
              <span className="h-5 px-2.5 rounded-full bg-raised border border-line text-[8px] font-medium tracking-[0.06em] uppercase text-ink-3 inline-flex items-center"
                style={{ fontFamily: 'var(--t-font-mono)' }}>{details.current_club} {details.age_group}</span>
            )}
            {details?.shirt_number && (
              <span className="h-5 px-2.5 rounded-full bg-raised border border-line text-[8px] font-medium tracking-[0.06em] uppercase text-ink-3 inline-flex items-center"
                style={{ fontFamily: 'var(--t-font-mono)' }}>#{details.shirt_number}</span>
            )}
          </div>
        </div>

        {/* Performance Trend */}
        <div className="rounded-[18px] p-4 border border-line bg-surface">
          <MetadataLabel text="PERFORMANCE TREND" />
          {matchHistory.length < 3 ? (
            <p className="text-[12px] text-ink-3 mt-4 text-center pb-2" style={{ fontFamily: 'var(--t-font)' }}>
              Log at least 3 matches to see your trend
            </p>
          ) : (
            <>
              <div className="mt-3">
                <RatingTrendChart matches={filteredMatches} />
              </div>
              <div className="flex gap-1.5 mt-3">
                {FILTER_OPTIONS.map((opt) => (
                  <button
                    key={opt.key}
                    onClick={() => setTrendFilter(opt.key)}
                    className="h-[26px] px-3 rounded-full text-[9px] font-medium tracking-[0.06em] uppercase transition-colors"
                    style={{
                      fontFamily: 'var(--t-font-mono)',
                      background: trendFilter === opt.key ? 'rgb(var(--t-brand) / 0.13)' : 'rgb(var(--t-raised))',
                      color: trendFilter === opt.key ? 'rgb(var(--t-brand))' : 'rgb(var(--t-ink-3))',
                      border: `1px solid ${trendFilter === opt.key ? 'rgb(var(--t-brand) / 0.25)' : 'rgb(var(--t-line))'}`,
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Coach Assessments: the six metrics in their band colours, on a light card (TRAK-229). */}
        {assessmentCategories.length > 0 && (
          <div className="rounded-[18px] p-4 border border-line bg-surface">
            <MetadataLabel text="COACH ASSESSMENTS" />
            <div className="mt-3 space-y-2">
              {assessmentCategories.map(cat => {
                const bandInfo = bandForScore(cat.score)
                const pct = (cat.score / 10) * 100
                return (
                  <div key={cat.name} className="flex items-center gap-2.5">
                    <span className="text-[11px] text-ink w-[110px] flex-shrink-0">{cat.name}</span>
                    <div className="flex-1 h-[5px] rounded-full bg-raised overflow-hidden">
                      <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: bandInfo.color }} />
                    </div>
                    <span className="text-[11px] font-semibold w-[68px] text-right flex-shrink-0" style={{ color: bandInfo.text }}>
                      {bandInfo.word}
                    </span>
                  </div>
                )
              })}
            </div>
              {assessments.length > 0 && (
                <ul className="mt-3 pt-3 border-t border-line space-y-1" aria-label="Assessment history">
                  {assessments.map(a => {
                    const band = bandForScore((a.work_rate + a.tactical + a.attitude + a.technical + a.physical + a.coachability) / 6)
                    return (
                      <li key={a.id}>
                        <button onClick={() => navigate(`/player/feedback/${a.id}`)}
                          className="w-full flex items-center justify-between py-2 text-left">
                          <span className="text-[12px] text-ink-2">
                            {new Date(a.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                          </span>
                          <span className="flex items-center gap-2 text-[11px] font-semibold" style={{ color: band.text }}>
                            {band.word}<ChevronRight size={14} className="text-ink-3" />
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
          </div>
        )}

        {/* My Passport */}
        <button
          onClick={() => navigate('/player/passport')}
          className="w-full flex items-center justify-between rounded-[18px] p-4 border border-line bg-surface text-left hover:bg-surface transition-colors"
        >
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center"
              style={{ background: 'rgb(var(--t-brand) / 0.08)', border: '1px solid rgb(var(--t-brand) / 0.2)' }}>
              <IconPassport size={16} color="rgb(var(--t-brand))" />
            </div>
            <div>
              <MetadataLabel text="MY PASSPORT" />
              <p className="text-[12px] text-ink-2 mt-1" style={{ fontFamily: 'var(--t-font)' }}>
                Coming soon
              </p>
            </div>
          </div>
          <ChevronRight size={18} className="text-ink-3" />
        </button>

        {/* Connections, moved here from Settings (TRAK-71) */}
        <PlayerConnections />

        {/* Parent access */}
        <ParentInviteCard />

        {/* How TRAK works link */}
        <button
          onClick={() => navigate('/how-it-works')}
          className="w-full flex items-center justify-between rounded-[18px] p-4 border border-line bg-surface text-left hover:bg-surface transition-colors"
        >
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center"
              style={{ background: 'rgb(var(--t-brand) / 0.08)', border: '1px solid rgb(var(--t-brand) / 0.18)' }}>
              <IconHowItWorks size={16} color="rgb(var(--t-brand))" />
            </div>
            <div>
              <MetadataLabel text="HOW TRAK WORKS" />
              <p className="text-[12px] text-ink-2 mt-1" style={{ fontFamily: 'var(--t-font)' }}>
                Performance bands & rating engine
              </p>
            </div>
          </div>
          <ChevronRight size={18} className="text-ink-3" />
        </button>

        {/* Settings entry */}
        <button
          onClick={() => navigate('/settings')}
          className="w-full flex items-center justify-between rounded-[18px] p-4 border border-line bg-surface text-left hover:bg-surface transition-colors"
        >
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-raised flex items-center justify-center">
              <SettingsIcon size={16} className="text-ink-2" />
            </div>
            <div>
              <MetadataLabel text="SETTINGS" />
              <p className="text-[12px] text-ink-2 mt-1" style={{ fontFamily: 'var(--t-font)' }}>
                Account, notifications, privacy
              </p>
            </div>
          </div>
          <ChevronRight size={18} className="text-ink-3" />
        </button>


      </div>
      <NavBar role="player" activeTab={location.pathname} onNavigate={navigate} />
    </MobileShell>
  )
}
