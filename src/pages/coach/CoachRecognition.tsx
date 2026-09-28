import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/integrations/supabase/client'
import { useAuth } from '@/contexts/AuthContext'
import { scoreToBand } from '@/lib/rating-engine'
import { BANDS } from '@/lib/types'
import { useParked } from '@/components/trak/parked'

type SquadPlayer = {
  id: string
  player_name: string
  position: string | null
  latestBand?: string
  latestBandColor?: string
}

type AwardType = 'player_of_week' | 'player_of_month' | 'player_of_season'

const AWARD_CONFIG: Record<AwardType, { label: string; desc: string; color: string; cooldownDays: number }> = {
  player_of_week:   { label: 'Player of the Week',   desc: 'Recognise one player whose performance stood out this week.',                                   color: '#C8F25A',    cooldownDays: 0   },
  player_of_month:  { label: 'Player of the Month',  desc: 'Awarded once per month to recognise sustained performance across multiple matches.',             color: '#86efac',    cooldownDays: 30  },
  player_of_season: { label: 'Player of the Season', desc: 'The highest honour. Awarded once at the end of the season to one outstanding player.',          color: '#fbbf24',    cooldownDays: 365 },
}

function initials(name: string) {
  return name.split(' ').map(w => w[0] || '').join('').toUpperCase().slice(0, 2)
}

export default function CoachRecognition() {
  // TRAK-85: parked, so actions say "Coming soon" and send nothing.
  const { parked, comingSoon } = useParked()
  const navigate = useNavigate()
  const { user, profile } = useAuth()

  const [players, setPlayers] = useState<SquadPlayer[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [activeAward, setActiveAward] = useState<AwardType>('player_of_week')
  const [cooldowns, setCooldowns] = useState<Record<AwardType, Date | null>>({
    player_of_week: null,
    player_of_month: null,
    player_of_season: null,
  })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!user) return
    loadData()
  }, [user])

  const loadData = async () => {
    // Fetch squad players + their latest assessment band
    const { data: squadData } = await supabase
      .from('squad_players')
      .select('id, player_name, position')
      .eq('coach_user_id', user!.id)
      .order('player_name')

    if (!squadData) return

    // Fetch latest assessment per player to get their band
    const squadIds = squadData.map(p => p.id)
    const { data: assessments } = await supabase
      .from('coach_assessments')
      .select('squad_player_id, work_rate, tactical, attitude, technical, physical, coachability')
      .in('squad_player_id', squadIds)
      .order('created_at', { ascending: false })

    // Build map: squadPlayerId → latest assessment
    const latestAssessment: Record<string, NonNullable<typeof assessments>[0]> = {}
    for (const a of assessments ?? []) {
      if (!latestAssessment[a.squad_player_id]) latestAssessment[a.squad_player_id] = a
    }

    const enriched: SquadPlayer[] = squadData.map(p => {
      const a = latestAssessment[p.id]
      if (!a) return { ...p }
      const scores = [a.work_rate, a.tactical, a.attitude, a.technical, a.physical, a.coachability].filter(Boolean) as number[]
      const avg = scores.length > 0 ? scores.reduce((s, n) => s + n, 0) / scores.length : 6
      const bandKey = scoreToBand(avg)
      const bandCfg = BANDS.find(b => b.word.toLowerCase() === bandKey) || BANDS[4]
      return { ...p, latestBand: bandCfg.word, latestBandColor: bandCfg.color }
    })
    setPlayers(enriched)

    // Fetch most recent award of each type to compute cooldowns
    const { data: recentAwards } = await supabase
      .from('recognition_awards')
      .select('award_type, created_at')
      .eq('coach_user_id', user!.id)
      .in('award_type', ['player_of_week', 'player_of_month', 'player_of_season'])
      .order('created_at', { ascending: false })

    const lastAward: Record<AwardType, Date | null> = {
      player_of_week: null,
      player_of_month: null,
      player_of_season: null,
    }
    for (const aw of recentAwards ?? []) {
      const t = aw.award_type as AwardType
      if (!lastAward[t] && aw.created_at) lastAward[t] = new Date(aw.created_at)
    }
    setCooldowns(lastAward)
  }

  const isLocked = (type: AwardType): boolean => {
    const last = cooldowns[type]
    const cooldown = AWARD_CONFIG[type].cooldownDays
    if (!last || cooldown === 0) return false
    const daysSince = (Date.now() - last.getTime()) / 86400000
    return daysSince < cooldown
  }

  const unlockText = (type: AwardType): string => {
    const last = cooldowns[type]
    const cooldown = AWARD_CONFIG[type].cooldownDays
    if (!last) return ''
    const daysLeft = Math.ceil(cooldown - (Date.now() - last.getTime()) / 86400000)
    return daysLeft > 0 ? `Unlocks in ${daysLeft} day${daysLeft !== 1 ? 's' : ''}` : ''
  }

  const handleAward = async () => {
    if (parked) return comingSoon()
    if (!selectedId || !user || saving) return
    const player = players.find(p => p.id === selectedId)
    if (!player) return
    setSaving(true)

    const { error } = await supabase.from('recognition_awards').insert({
      coach_user_id: user.id,
      coach_name_snapshot: profile?.full_name || null,
      squad_player_id: selectedId,
      award_type: activeAward,
      awarded_for: new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }),
    })

    if (error) {
      toast.error('Could not save award')
    } else {
      toast.success(`${AWARD_CONFIG[activeAward].label} awarded`, {
        description: `${player.player_name} — recognition added to their passport`,
      })
      setTimeout(() => navigate('/coach/home'), 700)
    }
    setSaving(false)
  }

  return (
    <div className="min-h-screen" style={{ background: '#0A0A0B', fontFamily: "'DM Sans', sans-serif" }}>
      <div className="mx-auto max-w-[430px] px-5 pt-5 pb-12">
        {/* Header */}
        <div className="relative flex items-center justify-center mb-2 h-10">
          <button onClick={() => navigate(-1)} className="absolute left-0 flex items-center justify-center"
            style={{ width: 36, height: 36, borderRadius: 999, background: '#101012', border: '1px solid rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.88)' }}>
            <ArrowLeft size={16} />
          </button>
          <h1 style={{ fontSize: 17, fontWeight: 400, color: 'rgba(255,255,255,0.88)' }}>Give Recognition</h1>
        </div>
        <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.45)', textAlign: 'center', marginTop: 8, marginBottom: 24 }}>
          Recognition is permanent — it lives on a player's passport forever.
        </p>

        {/* Award type tabs */}
        <div className="flex gap-2 mb-5">
          {(Object.entries(AWARD_CONFIG) as [AwardType, typeof AWARD_CONFIG[AwardType]][]).map(([type, cfg]) => {
            const locked = isLocked(type)
            const active = activeAward === type
            return (
              <button key={type} onClick={() => { if (!locked) setActiveAward(type) }}
                className="flex-1 py-2 rounded-[10px] text-[11px] font-medium transition-all"
                style={{
                  background: active ? `${cfg.color}18` : '#101012',
                  border: `1px solid ${active ? cfg.color + '50' : 'rgba(255,255,255,0.07)'}`,
                  color: locked ? 'rgba(255,255,255,0.3)' : active ? cfg.color : 'rgba(255,255,255,0.55)',
                  cursor: locked ? 'not-allowed' : 'pointer',
                  fontFamily: "'DM Mono', monospace",
                  letterSpacing: '0.06em',
                  fontSize: 9,
                  textTransform: 'uppercase',
                  opacity: locked ? 0.5 : 1,
                }}>
                {cfg.label.split(' ').slice(-1)[0]}
                {locked && <span className="block text-[8px] mt-0.5">{unlockText(type)}</span>}
              </button>
            )
          })}
        </div>

        {/* Active award section */}
        {(() => {
          const cfg = AWARD_CONFIG[activeAward]
          const locked = isLocked(activeAward)
          return (
            <section className="p-5 mb-4" style={{ background: `${cfg.color}0D`, border: `1px solid ${cfg.color}2E`, borderRadius: 18, opacity: locked ? 0.5 : 1 }}>
              <Label color={cfg.color}>{cfg.label}</Label>
              <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.45)', marginTop: 8 }}>{cfg.desc}</p>
              {locked ? (
                <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', marginTop: 16 }}>{unlockText(activeAward)}</p>
              ) : (
                <>
                  <div className="mt-4 space-y-2">
                    {players.length === 0 ? (
                      <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.35)' }}>No squad players yet. Add players from the Squad tab.</p>
                    ) : (
                      players.map(p => {
                        const sel = selectedId === p.id
                        return (
                          <button key={p.id} onClick={() => setSelectedId(sel ? null : p.id)}
                            className="w-full flex items-center gap-3 p-3 text-left transition"
                            style={{ background: sel ? `${cfg.color}14` : '#101012', border: `1px solid ${sel ? cfg.color : 'rgba(255,255,255,0.07)'}`, borderRadius: 14 }}>
                            <div className="flex items-center justify-center shrink-0"
                              style={{ width: 40, height: 40, borderRadius: 8, background: '#0A0A0B', border: '1px solid rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.88)', fontSize: 13 }}>
                              {initials(p.player_name)}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.88)' }}>{p.player_name}</div>
                              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)' }}>{p.position || '—'}</div>
                            </div>
                            {p.latestBand && (
                              <span className="px-2.5 py-1 rounded-full text-[11px]"
                                style={{ color: p.latestBandColor, background: `${p.latestBandColor}1F`, border: `1px solid ${p.latestBandColor}40` }}>
                                {p.latestBand}
                              </span>
                            )}
                          </button>
                        )
                      })
                    )}
                  </div>
                  {players.length > 0 && (
                    <button onClick={handleAward} disabled={!selectedId || saving}
                      className="mt-5 w-full py-3 rounded-lg transition"
                      style={{ background: selectedId ? cfg.color : `${cfg.color}33`, color: '#000', fontSize: 14, fontWeight: 500, opacity: (selectedId && !saving) ? 1 : 0.5, cursor: selectedId ? 'pointer' : 'not-allowed' }}>
                      {saving ? 'Saving…' : `Award ${cfg.label}`}
                    </button>
                  )}
                </>
              )}
            </section>
          )
        })()}
      </div>
    </div>
  )
}

function Label({ children, color = 'rgba(255,255,255,0.22)' }: { children: React.ReactNode; color?: string }) {
  return (
    <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.12em', color }}>
      {children}
    </div>
  )
}
