import { useEffect, useState } from 'react'
import { ClubShell, ClubHeader, ClubCard, SectionLabel } from '@/components/club/ClubShell'
import { supabase } from '@/integrations/supabase/client'
import { useAuth } from '@/contexts/AuthContext'
import { toast } from 'sonner'
import { UserMinus } from 'lucide-react'

type CoachRow = {
  userId: string
  name: string
  coachRole: string
  team: string
  currentClub: string
  inviteCode: string | null
  playerCount: number
  assessmentsThisMonth: number
  lastAssessmentDate: string | null
}

function initials(name: string) {
  return name.split(' ').map(w => w[0] || '').join('').toUpperCase().slice(0, 2)
}

export default function ClubCoaches() {
  const { user } = useAuth()
  const [coaches, setCoaches] = useState<CoachRow[]>([])
  const [loading, setLoading] = useState(true)
  const [clubName, setClubName] = useState('Academy')
  const [removing, setRemoving] = useState<string | null>(null)

  useEffect(() => { if (user) loadData() }, [user])

  const loadData = async () => {
    // Fetch org name
    const { data: org } = await supabase
      .from('organizations')
      .select('id, name')
      .eq('admin_user_id', user!.id)
      .maybeSingle()

    if (org?.name) setClubName(org.name)

    // Fetch coaches (RLS scoped to org)
    const { data: coachDetails } = await supabase
      .from('coach_details')
      .select('user_id, current_club, team, coach_role')

    if (!coachDetails || coachDetails.length === 0) { setLoading(false); return }

    const coachIds = coachDetails.map(c => c.user_id)

    // Profiles (names + invite codes)
    const { data: profiles } = await supabase
      .from('profiles')
      .select('user_id, full_name, invite_code')
      .in('user_id', coachIds)
    const profileMap: Record<string, { name: string; invite_code: string | null }> = {}
    for (const p of profiles ?? []) {
      profileMap[p.user_id] = { name: p.full_name || 'Coach', invite_code: p.invite_code }
    }

    // Squad player counts per coach
    const { data: squadPlayers } = await supabase
      .from('squad_players')
      .select('id, coach_user_id')
      .in('coach_user_id', coachIds)
    const playerCountMap: Record<string, number> = {}
    for (const sp of squadPlayers ?? []) {
      playerCountMap[sp.coach_user_id] = (playerCountMap[sp.coach_user_id] || 0) + 1
    }

    // Assessments this month per coach (via squad_players)
    const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString()
    const squadIds = (squadPlayers ?? []).map(s => s.id)
    const { data: assessments } = await supabase
      .from('coach_assessments')
      .select('squad_player_id, created_at')
      .in('squad_player_id', squadIds)
      .gte('created_at', monthAgo)
      .order('created_at', { ascending: false })

    // Build squad_player → coach map
    const spCoachMap: Record<string, string> = {}
    for (const sp of squadPlayers ?? []) { spCoachMap[sp.id] = sp.coach_user_id }

    // Count assessments + find last date per coach
    const monthCountMap: Record<string, number> = {}
    const lastDateMap: Record<string, string> = {}
    for (const a of assessments ?? []) {
      const coachId = spCoachMap[a.squad_player_id]
      if (!coachId) continue
      monthCountMap[coachId] = (monthCountMap[coachId] || 0) + 1
      if (!lastDateMap[coachId] && a.created_at) lastDateMap[coachId] = a.created_at
    }

    const rows: CoachRow[] = coachDetails.map(cd => ({
      userId: cd.user_id,
      name: profileMap[cd.user_id]?.name || 'Coach',
      coachRole: cd.coach_role || 'Coach',
      team: cd.team || '—',
      currentClub: cd.current_club || '—',
      inviteCode: profileMap[cd.user_id]?.invite_code ?? null,
      playerCount: playerCountMap[cd.user_id] || 0,
      assessmentsThisMonth: monthCountMap[cd.user_id] || 0,
      lastAssessmentDate: lastDateMap[cd.user_id] || null,
    }))

    setCoaches(rows)
    setLoading(false)
  }

  const copyCode = (code: string) => {
    navigator.clipboard.writeText(`TRK-${code}`)
    toast.success('Invite code copied')
  }

  const handleRemoveCoach = async (coachUserId: string, coachName: string) => {
    if (!confirm(`Remove ${coachName} from the academy? Their Trak account won't be affected — they just won't appear in your dashboard. Assessment history will be preserved.`)) return

    setRemoving(coachUserId)
    const { error } = await supabase.rpc('remove_coach_from_org', { p_coach_user_id: coachUserId })

    if (error) {
      toast.error('Failed to remove coach')
      console.error(error)
    } else {
      toast.success(`${coachName} removed from academy`)
      setCoaches(prev => prev.filter(c => c.userId !== coachUserId))
    }
    setRemoving(null)
  }

  return (
    <ClubShell>
      <ClubHeader club={clubName} coaches={coaches.length} />

      <SectionLabel>Connected Coaches</SectionLabel>
      <div className="mt-3 mb-6 space-y-3">
        {loading ? (
          <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 13, paddingTop: 8 }}>Loading…</div>
        ) : coaches.length === 0 ? (
          <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 13, paddingTop: 8 }}>No coaches connected yet. Share your academy code from your profile page.</div>
        ) : (
          coaches.map(c => (
            <ClubCard key={c.userId} className="p-4">
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center shrink-0"
                  style={{ width: 44, height: 44, borderRadius: 999, background: 'rgba(200,242,90,0.1)', color: '#C8F25A', fontSize: 14 }}>
                  {initials(c.name)}
                </div>
                <div className="flex-1 min-w-0">
                  <div style={{ fontSize: 15, color: 'rgba(255,255,255,0.88)' }}>{c.name}</div>
                  <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)' }}>
                    {c.coachRole} · {c.team}
                  </div>
                </div>
                {c.inviteCode && (
                  <button
                    onClick={() => copyCode(c.inviteCode!)}
                    className="px-2 py-1 rounded-[8px] transition-colors"
                    style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: '#C8F25A', background: 'rgba(200,242,90,0.08)', border: '1px solid rgba(200,242,90,0.2)' }}>
                    TRK-{c.inviteCode}
                  </button>
                )}
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2">
                <Stat label="Players" value={c.playerCount} />
                <Stat label="This Month" value={c.assessmentsThisMonth} />
                <Stat label="Last Active" value={c.lastAssessmentDate
                  ? new Date(c.lastAssessmentDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
                  : '—'} />
              </div>
              {/* Remove from academy */}
              <button
                onClick={() => handleRemoveCoach(c.userId, c.name)}
                disabled={removing === c.userId}
                className="mt-3 w-full flex items-center justify-center gap-2 py-2 rounded-[10px] transition-colors"
                style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.3)', fontSize: 12 }}
              >
                <UserMinus size={13} />
                {removing === c.userId ? 'Removing…' : 'Remove from academy'}
              </button>
            </ClubCard>
          ))
        )}
      </div>

      <div className="px-4 py-3" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, color: 'rgba(255,255,255,0.45)', fontSize: 12, lineHeight: 1.5 }}>
        Tap a coach's invite code to copy it. Share codes with players to link them to their coach.
      </div>
    </ClubShell>
  )
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="px-3 py-2" style={{ background: '#0A0A0B', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12 }}>
      <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.22)' }}>
        {label}
      </div>
      <div style={{ fontSize: 16, color: 'rgba(255,255,255,0.88)', marginTop: 2 }}>{value}</div>
    </div>
  )
}
