import { useEffect, useState } from 'react'
import { ClubShell, ClubCard, SectionLabel } from '@/components/club/ClubShell'
import { LoadError } from '@/components/trak/LoadError'
import { AcademyDashboardHeader } from './AcademyDashboardHeader'
import { supabase } from '@/integrations/supabase/client'
import { useAuth } from '@/contexts/AuthContext'
import { scoreToBand } from '@/lib/rating-engine'
import { BANDS } from '@/lib/types'

type CoachRow = {
  userId: string
  name: string
  team: string
  currentClub: string
  coachRole: string
  playerCount: number
  assessmentsThisWeek: number
  bandDist: Record<string, number>
}

function getBandColor(bandKey: string) {
  const cfg = BANDS.find(b => b.word.toLowerCase() === bandKey)
  return cfg?.color ?? 'rgba(255,255,255,0.4)'
}

export default function ClubHome() {
  const { user } = useAuth()
  const [coaches, setCoaches] = useState<CoachRow[]>([])
  const [totalPlayers, setTotalPlayers] = useState(0)
  const [assessmentsThisWeek, setAssessmentsThisWeek] = useState(0)
  const [clubName, setClubName] = useState('Academy')
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [retry, setRetry] = useState(0)
  const [ownerId, setOwnerId] = useState<string>()
  const userId = user?.id

  useEffect(() => {
    const controller = new AbortController()
    const { signal } = controller
    setOwnerId(userId)
    setCoaches([])
    setTotalPlayers(0)
    setAssessmentsThisWeek(0)
    setClubName('Academy')
    setLoading(true)
    setLoadFailed(false)
    if (!userId) return () => controller.abort()

    const loadData = async () => {
      // 1. Fetch org name from organizations table
      const { data: org, error: orgError } = await supabase
        .from('organizations')
        .select('id, name')
        .eq('admin_user_id', userId)
        .abortSignal(signal)
        .maybeSingle()

      if (signal.aborted) return
      if (orgError) throw orgError
      if (!org) throw new Error('Academy not available')
      if (org?.name) setClubName(org.name)

      // 2. Fetch coaches in this org
      const { data: coachDetails, error: coachError } = await supabase
        .from('coach_details')
        .select('user_id, current_club, team, coach_role')
        .abortSignal(signal)

      if (signal.aborted) return
      if (coachError) throw coachError
      if (!coachDetails || coachDetails.length === 0) { setLoading(false); return }

      const coachIds = coachDetails.map(c => c.user_id)

      // 3. Fetch profiles for coach names
      const { data: profiles, error: profileError } = await supabase
        .from('profiles')
        .select('user_id, full_name')
        .in('user_id', coachIds)
        .abortSignal(signal)
      if (signal.aborted) return
      if (profileError) throw profileError

      const nameMap: Record<string, string> = {}
      for (const p of profiles ?? []) { nameMap[p.user_id] = p.full_name || 'Coach' }

      // 4. Fetch all squad_players across all coaches
      const { data: squadPlayers, error: squadError } = await supabase
        .from('squad_players')
        .select('id, coach_user_id, linked_player_id')
        .in('coach_user_id', coachIds)
        .abortSignal(signal)
      if (signal.aborted) return
      if (squadError) throw squadError

      // 5. Fetch all assessments (for band distribution + this-week count)
      const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString()
      const squadIds = (squadPlayers ?? []).map(s => s.id)
      const { data: assessments, error: assessmentError } = squadIds.length > 0 ? await supabase
        .from('coach_assessments')
        .select('squad_player_id, work_rate, tactical, attitude, technical, physical, coachability, created_at')
        .in('squad_player_id', squadIds)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .abortSignal(signal)
        : { data: null, error: null }
      if (signal.aborted) return
      if (assessmentError) throw assessmentError

      // Build map: squad_player_id → latest assessment
      const latestAssessment: Record<string, NonNullable<typeof assessments>[0]> = {}
      for (const a of assessments ?? []) {
        if (!latestAssessment[a.squad_player_id]) latestAssessment[a.squad_player_id] = a
      }

      // Weekly count
      const weekCount = (assessments ?? []).filter(a => (a.created_at ?? '') >= weekAgo).length
      setAssessmentsThisWeek(weekCount)

      // Total players on the academy roster.
      // Must count squad rows, not linked accounts — the per-squad counts below
      // use mySquad.length, so counting only signed-up players made the headline
      // contradict the sum of the squads beneath it.
      setTotalPlayers((squadPlayers ?? []).length)

      // Build per-coach data
      const rows: CoachRow[] = coachDetails.map(cd => {
        const mySquad = (squadPlayers ?? []).filter(s => s.coach_user_id === cd.user_id)
        const mySquadIds = new Set(mySquad.map(s => s.id))

        const myWeekAssessments = (assessments ?? []).filter(a => mySquadIds.has(a.squad_player_id) && (a.created_at ?? '') >= weekAgo).length

        // Band distribution from latest assessment per player
        const bandDist: Record<string, number> = {}
        for (const sp of mySquad) {
          const a = latestAssessment[sp.id]
          if (!a) continue
          const scores = [a.work_rate, a.tactical, a.attitude, a.technical, a.physical, a.coachability]
            .filter((score): score is number => score != null)
          if (scores.length === 0) continue
          const avg = scores.reduce((s, n) => s + n, 0) / scores.length
          const band = scoreToBand(avg)
          bandDist[band] = (bandDist[band] || 0) + 1
        }

        return {
          userId: cd.user_id,
          name: nameMap[cd.user_id] || 'Coach',
          team: cd.team || '—',
          currentClub: cd.current_club || '—',
          coachRole: cd.coach_role || 'Coach',
          playerCount: mySquad.length,
          assessmentsThisWeek: myWeekAssessments,
          bandDist,
        }
      })

      setCoaches(rows)
      setLoading(false)
    }

    void loadData().catch(() => {
      if (signal.aborted) return
      setLoadFailed(true)
      setLoading(false)
    })
    return () => controller.abort()
  }, [userId, retry])

  // Hide the previous account's state even before effect cleanup runs.
  const currentAccount = ownerId === userId
  const pending = !currentAccount || loading
  const failed = currentAccount && loadFailed
  const ready = !pending && !failed

  // Top 3 bands for display
  const TOP_BANDS = ['exceptional', 'standout', 'good', 'steady']

  return (
    <ClubShell>
      <AcademyDashboardHeader club={currentAccount ? clubName : 'Academy'} coaches={ready ? coaches.length : null} />

      {/* Academy-wide stats */}
      <ClubCard className="p-5 mb-5">
        <SectionLabel>Total Players</SectionLabel>
        <div className="mt-3 flex items-end justify-between">
          <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 300, fontSize: 64, lineHeight: 1, color: '#C8F25A' }}>
            {ready ? totalPlayers : '—'}
          </div>
        </div>
        <div className="mt-4 flex items-center justify-between px-4 py-3"
          style={{ background: '#0A0A0B', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12 }}>
          <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: 13 }}>Assessments this week</span>
          <span style={{ color: 'rgba(255,255,255,0.88)', fontSize: 16 }}>{ready ? assessmentsThisWeek : '—'}</span>
        </div>
      </ClubCard>

      <SectionLabel>Squads</SectionLabel>
      <div className="mt-3 space-y-3">
        {failed ? (
          <div className="[&_button]:min-h-11">
            <LoadError what="your academy overview" onRetry={() => setRetry(value => value + 1)} />
          </div>
        ) : pending ? (
          <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 13, paddingTop: 8 }}>Loading…</div>
        ) : coaches.length === 0 ? (
          <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 13, paddingTop: 8 }}>No coaches connected yet. Share your academy code with coaches to get started.</div>
        ) : (
          coaches.map(c => (
            <ClubCard key={c.userId} className="p-4">
              <div className="flex items-start justify-between">
                <div>
                  <div style={{ fontSize: 18, color: 'rgba(255,255,255,0.88)' }}>{c.team || 'Squad'}</div>
                  <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.45)' }}>{c.name} · {c.coachRole}</div>
                </div>
                <div className="text-right">
                  <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.88)' }}>{c.playerCount} players</div>
                  <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)' }}>{c.assessmentsThisWeek} assessed this week</div>
                </div>
              </div>
              {Object.keys(c.bandDist).length > 0 && (
                <div className="mt-3 flex gap-2 flex-wrap">
                  {TOP_BANDS.filter(b => c.bandDist[b]).map(b => (
                    <BandTag key={b} color={getBandColor(b)} letter={b[0].toUpperCase()} count={c.bandDist[b]} />
                  ))}
                </div>
              )}
            </ClubCard>
          ))
        )}
      </div>

      <div className="mt-6 px-4 py-3" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, color: 'rgba(255,255,255,0.45)', fontSize: 12, lineHeight: 1.5 }}>
        Read-only view. Performance data belongs to players and coaches. Club administrators can monitor activity but cannot edit player or coach records.
      </div>
    </ClubShell>
  )
}

function BandTag({ color, letter, count }: { color: string; letter: string; count: number }) {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full" style={{ color, background: `${color}1F`, border: `1px solid ${color}40`, fontSize: 11 }}>
      <span style={{ fontWeight: 500 }}>{letter}</span>
      <span style={{ opacity: 0.85 }}>{count}</span>
    </span>
  )
}
