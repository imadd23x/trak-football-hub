import { useEffect, useState } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import { supabase } from '@/integrations/supabase/client'
import { useAuth } from '@/contexts/AuthContext'
import { MobileShell, BandPill, MetadataLabel, NavBar, LoadError } from '@/components/trak'
import { scoreToBand } from '@/lib/rating-engine'
import { parentMatchHref } from '@/lib/parent-data'
import { useReviews } from '@/lib/games/reviews'
import { ChevronLeft } from 'lucide-react'

/* Also the parent's match detail (TRAK-73): `role` picks the nav and the way
   back, and `limitedFor` says whether a child's match shows only what the
   parent already saw on their list (score, opponent, competition, venue, band). */
export default function PlayerMatchDetail({ role = 'player', limitedFor, playerUserId }: {
  role?: 'player' | 'parent'
  limitedFor?: (childId: string) => boolean
  playerUserId?: string
}) {
  const matchesPath = `/${role}/matches`
  const { id } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const ownerId = role === 'parent' ? playerUserId : user?.id
  // TRAK-289: a Games match has no rating; its coach's review is on the match's event page.
  const reviews = useReviews(ownerId)
  const [reloadKey, setReloadKey] = useState(0)
  const [result, setResult] = useState<{
    id: string
    user: typeof user
    reloadKey: number
    ownerId: string
    match: any
    failed: boolean
  } | null>(null)

  useEffect(() => {
    let cancelled = false
    setResult(null)
    if (!id || !user || !ownerId) return
    supabase.from('matches').select('*').eq('id', id).eq('user_id', ownerId).maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return
        setResult({ id, user, reloadKey, ownerId, match: data, failed: Boolean(error) })
      })
    return () => { cancelled = true }
  }, [id, user, reloadKey, ownerId])

  // Bind the displayed result to its request as well as cancelling old writes.
  // A new route or Auth refresh must hide the prior match before its effect runs.
  const currentResult = result && result.id === id && result.user === user && result.reloadKey === reloadKey && result.ownerId === ownerId
    ? result : null

  if (!currentResult) return (
    <MobileShell>
      <div className="flex items-center justify-center h-[60vh]" role="status" aria-label="Loading match">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    </MobileShell>
  )

  const match = currentResult.match
  if (currentResult.failed || !match) return (
    <MobileShell>
      <div className="pt-12 pb-4 space-y-4">
        {currentResult.failed ? (
          <LoadError what="this match" onRetry={() => setReloadKey(k => k + 1)} />
        ) : (
          <p className="text-center text-[13px] text-ink-2" role="status">This match is unavailable.</p>
        )}
        <button onClick={() => navigate(matchesPath)}
          className="flex items-center gap-2 mx-auto px-4 py-2 rounded-[10px] text-[12px] text-ink-2 border border-line">
          <ChevronLeft size={14} />
          Back to matches
        </button>
      </div>
      <NavBar role={role} activeTab={matchesPath} onNavigate={navigate} />
    </MobileShell>
  )

  const limited = limitedFor?.(match.user_id) ?? false
  const band = match.computed_rating == null ? null : scoreToBand(match.computed_rating)
  const reviewEvent = match.session_id ? reviews.data?.bySession.get(match.session_id) : undefined
  const resultLabel = match.team_score > match.opponent_score ? 'W'
    : match.team_score < match.opponent_score ? 'L' : 'D'
  const resultColor = resultLabel === 'W' ? 'rgb(var(--t-success))' : resultLabel === 'L' ? 'rgb(var(--t-danger))' : 'rgb(var(--t-info))'
  const formattedDate = new Date(match.created_at).toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'long', year: 'numeric',
  })

  return (
    <MobileShell>
      <div className="pt-6 pb-24 space-y-3">
        {/* Back */}
        <button onClick={() => navigate(-1)}
          className="flex items-center justify-center w-[34px] h-[34px] rounded-[10px] bg-raised border border-line mb-2">
          <ChevronLeft size={16} className="text-ink-2" />
        </button>

        {/* Hero card: result + band */}
        <div className="relative rounded-[24px] p-5 overflow-hidden"
          style={{ background: 'linear-gradient(135deg, rgb(var(--t-surface)) 0%, rgb(var(--t-surface)) 100%)', border: '1px solid rgb(var(--t-line))' }}>
          <div className="absolute -bottom-[60px] -right-[60px] w-[200px] h-[200px] rounded-full pointer-events-none"
            style={{ background: 'radial-gradient(circle, rgb(var(--t-brand) / 0.08) 0%, transparent 70%)' }} />
          <div className="relative z-10">
            <MetadataLabel text={formattedDate} />
            <div className="flex items-start justify-between mt-2">
              <div>
                <div className="flex items-baseline gap-3">
                  <span className="text-[48px] font-light text-ink leading-none"
                    style={{ fontFamily: 'var(--t-font)', letterSpacing: '-0.04em' }}>
                    {match.team_score}–{match.opponent_score}
                  </span>
                  <span className="text-[20px] font-semibold" style={{ color: resultColor }}>{resultLabel}</span>
                </div>
                {match.opponent && (
                  <p className="text-[11px] text-ink-3 mt-1" style={{ fontFamily: 'var(--t-font-mono)' }}>
                    vs {match.opponent}
                  </p>
                )}
              </div>
              {band && <BandPill band={band} />}
            </div>
          </div>
        </div>

        {reviewEvent && <Link to={`/${role}/event/${reviewEvent}`}
          className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-primary">
          See the coach’s review</Link>}

        {/* Match info */}
        <div className="rounded-[18px] p-4 space-y-3"
          style={{ background: 'rgb(var(--t-surface))', border: '1px solid rgb(var(--t-line))' }}>
          <MetadataLabel text="MATCH INFO" />
          {[
            { label: 'Competition', value: match.competition },
            { label: 'Venue', value: match.venue },
            ...(limited ? [] : [
              { label: 'Position', value: match.position },
              { label: 'Age Group', value: match.age_group },
              // TRAK-198: a quick-logged match has no minutes recorded; no row, never "0'".
              ...(match.minutes_played == null ? [] : [{ label: 'Minutes', value: `${match.minutes_played}'` }]),
            ]),
          ].map(row => (
            <div key={row.label} className="flex items-center justify-between">
              <span className="text-[11px] text-ink-3" style={{ fontFamily: 'var(--t-font-mono)' }}>
                {row.label}
              </span>
              <span className="text-[13px] text-ink">{row.value || '—'}</span>
            </div>
          ))}
        </div>

        {/* Goal contributions */}
        {!limited && <div className="grid grid-cols-2 gap-2">
          {[
            { label: 'Goals', value: match.goals ?? 0 },
            { label: 'Assists', value: match.assists ?? 0 },
          ].map(stat => (
            <div key={stat.label} className="rounded-[14px] py-4 px-3 text-center"
              style={{ background: 'rgb(var(--t-surface))', border: '1px solid rgb(var(--t-line))' }}>
              <p className="text-[28px] font-light text-ink leading-none"
                style={{ fontFamily: 'var(--t-font)', letterSpacing: '-0.03em' }}>{stat.value}</p>
              <span className="text-[9px] text-ink-3 mt-1.5 block"
                style={{ fontFamily: 'var(--t-font-mono)' }}>{stat.label}</span>
            </div>
          ))}
        </div>}

        {role === 'parent' && !reviewEvent && (match.session_id
          ? <Link to={parentMatchHref(match)} state={{ matchId: match.id, childId: ownerId }}
              className="inline-flex min-h-11 items-center text-sm text-primary focus-visible:ring-2 focus-visible:ring-primary">Coach assessment</Link>
          : <p className="text-sm text-muted-foreground">No assessment link is available for this match.</p>)}

      </div>
      <NavBar role={role} activeTab={matchesPath} onNavigate={navigate} />
    </MobileShell>
  )
}
