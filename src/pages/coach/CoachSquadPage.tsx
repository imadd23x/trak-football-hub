import { useEffect, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { supabase } from '@/integrations/supabase/client'
import { useAuth } from '@/contexts/AuthContext'
import { MobileShell, NavBar, BandPill } from '@/components/trak'
import { scoreToBand } from '@/lib/rating-engine'
import { Plus, WifiOff } from 'lucide-react'

const POSITIONS = ['All', 'Goalkeeper', 'Defender', 'Midfielder', 'Attacker'] as const

export default function CoachSquadPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [players, setPlayers] = useState<any[]>([])
  const [assessments, setAssessments] = useState<Record<string, number>>({})
  const [posFilter, setPosFilter] = useState<string>('All')
  const [ageFilter, setAgeFilter] = useState<string>('All')
  const [loadFailed, setLoadFailed] = useState(false)
  const [retry, setRetry] = useState(0)

  // Age group label: prefer the age_group text column ('U12'), fall back to legacy integer age
  const ageLabel = (p: any): string | null => p.age_group ?? (p.age != null ? String(p.age) : null)

  // Derive age groups present in the squad (sorted)
  const ageGroups = Array.from(
    new Set(players.map(ageLabel).filter(Boolean))
  ).sort() as string[]

  useEffect(() => {
    if (!user) return
    let cancelled = false
    setLoadFailed(false)

    // Fetch squad players.
    // The error must be checked: falling through to `data || []` renders a
    // failed read as an empty squad, so a coach offline with a full roster is
    // told to "Add your first player".
    supabase
      .from('squad_players')
      .select('*')
      .eq('coach_user_id', user.id)
      .order('player_name')
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) {
          setLoadFailed(true)
          return
        }
        setPlayers(data || [])
      })

    // Fetch latest assessment per player for band display.
    // A failure here is not fatal — the squad still renders, just without
    // bands — but it must not be mistaken for "nobody has been assessed".
    // No .eq('coach_user_id', ...): the band should show the academy's latest
    // assessment, not only this coach's. K7's migration adds the read policy
    // that makes that possible — dropping the filter alone would have changed
    // nothing, because "Coaches can select own assessments" was itself scoped
    // to auth.uid().
    //
    // RLS does the scoping now, which is the right place for it: a colleague's
    // assessment on a roster row in this academy is visible, another academy's
    // is not, and a departed coach sees neither.
    supabase
      .from('coach_assessments')
      .select('squad_player_id, coach_rating, created_at')
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (cancelled || error || !data) return
        const latest: Record<string, number> = {}
        for (const a of data) {
          if (a.squad_player_id && latest[a.squad_player_id] === undefined && a.coach_rating != null) {
            latest[a.squad_player_id] = Number(a.coach_rating)
          }
        }
        setAssessments(latest)
      })

    return () => { cancelled = true }
  }, [user, retry])

  const filtered = players.filter(p => {
    const posMatch = posFilter === 'All' || p.position?.toLowerCase() === posFilter.toLowerCase()
    const ageMatch = ageFilter === 'All' || ageLabel(p) === ageFilter
    return posMatch && ageMatch
  })

  const initials = (name: string) =>
    name
      .split(' ')
      .map((w) => w[0])
      .join('')
      .toUpperCase()
      .slice(0, 2)

  return (
    <MobileShell>
      {/* Topbar */}
      <div className="flex items-center justify-between px-5 py-[10px] border-b border-white/[0.07] shrink-0">
        <h1 className="text-[15px] font-semibold text-white/90">Squad</h1>
        <button
          onClick={() => navigate('/coach/squad/add')}
          className="flex items-center justify-center w-8 h-8 rounded-[9px] bg-[#C8F25A] active:scale-95 transition-transform"
        >
          <Plus size={16} className="text-black" strokeWidth={2.5} />
        </button>
      </div>

      {/* Filters */}
      <div className="px-5 pt-3 pb-2 space-y-2 shrink-0">
        {/* Age group row — only shown when coach has 2+ groups */}
        {ageGroups.length >= 2 && (
          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
            {['All', ...ageGroups].map(age => {
              const active = ageFilter === age
              return (
                <button
                  key={age}
                  onClick={() => setAgeFilter(age)}
                  className="inline-flex items-center h-6 px-2.5 rounded-[6px] text-[10px] font-semibold whitespace-nowrap transition-colors flex-shrink-0"
                  style={{
                    background: active ? 'rgba(200,242,90,0.12)' : 'rgba(255,255,255,0.05)',
                    color: active ? '#C8F25A' : 'rgba(255,255,255,0.4)',
                    border: `1px solid ${active ? 'rgba(200,242,90,0.25)' : 'transparent'}`,
                  }}
                >
                  {age}
                </button>
              )
            })}
          </div>
        )}

        {/* Position row */}
        <div className="flex items-center gap-2">
          {POSITIONS.map((pos) => {
            const active = posFilter === pos
            return (
              <button
                key={pos}
                onClick={() => setPosFilter(pos)}
                className="inline-flex items-center h-5 px-2 rounded-[5px] text-[9px] font-medium uppercase tracking-[0.05em] transition-colors"
                style={{
                  background: active ? 'rgba(251,191,36,0.12)' : 'rgba(255,255,255,0.06)',
                  color: active ? 'rgb(251,191,36)' : 'rgba(255,255,255,0.45)',
                }}
              >
                {pos}
              </button>
            )
          })}
        </div>
      </div>

      {/* Squad list */}
      <div className="flex-1 overflow-y-auto px-5 pb-24">
        {loadFailed ? (
          <div className="flex flex-col items-center text-center pt-14 px-6">
            <div
              className="w-14 h-14 rounded-[16px] flex items-center justify-center mb-4"
              style={{ background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.15)' }}
            >
              <WifiOff size={22} className="text-[rgb(251,191,36)]" strokeWidth={1.5} />
            </div>
            <p className="text-[15px] text-white/70 font-medium mb-1">Couldn't load your squad</p>
            <p className="text-[12px] text-white/35 leading-relaxed mb-5">
              {navigator.onLine
                ? "We couldn't reach Trak just now. Nothing has been lost — your squad is safe."
                : 'You appear to be offline. Nothing has been lost — your squad is safe.'}
            </p>
            <button
              onClick={() => setRetry(r => r + 1)}
              className="px-5 py-2.5 rounded-[10px] text-[13px] font-medium text-black"
              style={{ background: '#C8F25A' }}
            >
              Try again
            </button>
          </div>
        ) : filtered.length === 0 ? (
          players.length === 0 ? (
            <div className="flex flex-col items-center text-center pt-14 px-6">
              <div
                className="w-14 h-14 rounded-[16px] flex items-center justify-center mb-4"
                style={{ background: 'rgba(200,242,90,0.08)', border: '1px solid rgba(200,242,90,0.15)' }}
              >
                <Plus size={22} className="text-[#C8F25A]" strokeWidth={1.5} />
              </div>
              <p className="text-[15px] text-white/70 font-medium mb-1">Add your first player</p>
              <p className="text-[12px] text-white/35 leading-relaxed mb-5">
                Build your squad to start logging sessions, assessments and match ratings.
              </p>
              <button
                onClick={() => navigate('/coach/squad/add')}
                className="px-5 py-2.5 rounded-[10px] text-[13px] font-medium text-black"
                style={{ background: '#C8F25A' }}
              >
                Add player
              </button>
            </div>
          ) : (
            <div className="pt-8 text-center">
              <p className="text-[13px] text-white/45 mb-2">No players match that filter.</p>
              <button
                onClick={() => { setPosFilter('All'); setAgeFilter('All') }}
                className="text-[11px] text-[#C8F25A]"
              >
                Clear filters
              </button>
            </div>
          )
        ) : (
          <div className="space-y-0">
            {filtered.map((p, idx) => {
              const score =
                assessments[p.id] ?? p.overall_score ?? null
              return (
                <button
                  key={p.id}
                  onClick={() => navigate(`/coach/player/${p.id}`)}
                  className="w-full flex items-center gap-3 py-3 border-b border-white/[0.05] active:bg-white/[0.03] transition-colors"
                >
                  {/* Avatar */}
                  <div
                    className="w-9 h-9 rounded-[11px] bg-[#202024] flex items-center justify-center shrink-0"
                    style={{ border: '1px solid rgba(255,255,255,0.07)' }}
                  >
                    <span
                      className="text-[11px] font-semibold text-white/45"
                    >
                      {initials(p.player_name || '??')}
                    </span>
                  </div>

                  {/* Name + metadata */}
                  <div className="flex-1 min-w-0 text-left">
                    <p className="text-[13px] font-medium text-white/[0.88] truncate">
                      {p.player_name}
                    </p>
                    <p
                      className="text-[9px] text-white/[0.22] mt-0.5 truncate"
                      style={{ fontFamily: "'DM Mono', monospace" }}
                    >
                      {p.position || 'N/A'}
                      {p.shirt_number ? ` · #${p.shirt_number}` : ''}
                      {ageLabel(p) ? ` · ${ageLabel(p)}` : ''}
                    </p>
                  </div>

                  {/* Band pill */}
                  {score !== null && (
                    <BandPill band={scoreToBand(score)} />
                  )}
                </button>
              )
            })}
          </div>
        )}
      </div>

      <NavBar role="coach" activeTab={location.pathname} onNavigate={navigate} />
    </MobileShell>
  )
}
