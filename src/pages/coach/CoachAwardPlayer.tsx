import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/integrations/supabase/client'
import { useAuth } from '@/contexts/AuthContext'
import { MobileShell, NavBar, MetadataLabel } from '@/components/trak'
import { ChevronLeft, ChevronDown, Trophy, Medal, TrendingUp, Target, type LucideIcon } from 'lucide-react'
import { toast } from 'sonner'
import { useLocation } from 'react-router-dom'
import { useParked } from '@/components/trak/parked'

const AWARD_TYPES: { value: string; label: string; icon: LucideIcon }[] = [
  { value: 'player_of_week', label: 'Player of the Week', icon: Trophy },
  { value: 'player_of_month', label: 'Player of the Month', icon: Medal },
  { value: 'most_improved', label: 'Most Improved', icon: TrendingUp },
  { value: 'top_scorer', label: 'Top Scorer', icon: Target },
]

function OptPill({ label, icon: Icon, active, onClick }: { label: string; icon?: LucideIcon; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className="rounded-[10px] p-[11px_8px] text-center text-[13px] font-medium transition-colors inline-flex items-center justify-center gap-1.5"
      style={{
        background: active ? 'rgba(200,242,90,0.12)' : '#0d0d0f',
        border: active ? '1.5px solid #C8F25A' : '1.5px solid rgba(255,255,255,0.06)',
        color: active ? '#C8F25A' : 'rgba(255,255,255,0.55)',
      }}>
      {Icon && <Icon size={14} />}
      {label}
    </button>
  )
}

export default function CoachAwardPlayer() {
  // TRAK-85: parked, so actions say "Coming soon" and send nothing.
  const { parked, comingSoon } = useParked()
  const { user, profile } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const [players, setPlayers] = useState<any[]>([])
  const [playerId, setPlayerId] = useState((location.state as any)?.preselectedPlayerId || '')
  const [awardType, setAwardType] = useState('')
  const [awardedFor, setAwardedFor] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!user) return
    supabase.from('squad_players').select('*').eq('coach_user_id', user.id).order('player_name')
      .then(({ data }) => setPlayers(data || []))
  }, [user])

  const handleSave = async () => {
    if (parked) return comingSoon()
    if (!user || !playerId || !awardType || saving) return
    setSaving(true)
    const { error } = await supabase.from('recognition_awards').insert({
      coach_user_id: user.id,
      coach_name_snapshot: profile?.full_name || null,
      squad_player_id: playerId,
      award_type: awardType,
      awarded_for: awardedFor.trim() || null,
      note: note.trim() || null,
    })
    if (error) {
      toast.error('Failed to save award')
      setSaving(false)
    } else {
      toast.success('Award given!')
      navigate('/coach/squad')
    }
  }

  const selectedPlayer = players.find(p => p.id === playerId)
  const selectedAward = AWARD_TYPES.find(a => a.value === awardType)

  return (
    <MobileShell>
      <div className="pb-24 space-y-5">
        {/* Header */}
        <div className="flex items-center gap-3 pt-6">
          <button onClick={() => navigate(-1)}
            className="flex items-center justify-center w-[34px] h-[34px] rounded-[10px] bg-[#17171a] border border-white/[0.11]">
            <ChevronLeft size={16} className="text-white/70" />
          </button>
          <h1 className="flex-1 text-center text-[17px] font-semibold text-white/90 -ml-[34px]">
            Give Award
          </h1>
        </div>

        {/* Player selector */}
        <div className="space-y-1.5">
          <MetadataLabel text="PLAYER" />
          <div className="relative">
            <select value={playerId} onChange={e => setPlayerId(e.target.value)}
              className="w-full px-4 py-3 pr-10 rounded-[10px] bg-[#0d0d0f] border border-white/[0.07] text-sm text-white/88 outline-none appearance-none">
              <option value="">{selectedPlayer ? 'Change player...' : 'Select player...'}</option>
              {players.map(p => (
                <option key={p.id} value={p.id}>{p.player_name}</option>
              ))}
            </select>
            <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none" />
          </div>
        </div>

        {/* Player card */}
        {selectedPlayer && (
          <div className="flex items-center gap-3 p-3 rounded-[12px] bg-[#141416] border border-white/[0.06]">
            <div className="flex items-center justify-center w-[38px] h-[38px] rounded-full text-[13px] font-bold shrink-0"
              style={{ background: 'rgba(200,242,90,0.14)', color: '#C8F25A' }}>
              {selectedPlayer.player_name.split(' ').map((w: string) => w[0]).join('').toUpperCase().slice(0, 2)}
            </div>
            <div>
              <p className="text-[15px] font-medium text-white/90">{selectedPlayer.player_name}</p>
              <p className="text-[11px] text-white/40">
                {selectedPlayer.position?.toUpperCase() ?? 'Player'}
                {selectedPlayer.shirt_number ? ` · #${selectedPlayer.shirt_number}` : ''}
              </p>
            </div>
          </div>
        )}

        {/* Award type */}
        <div className="space-y-1.5">
          <MetadataLabel text="AWARD TYPE" />
          <div className="grid grid-cols-2 gap-2">
            {AWARD_TYPES.map(a => (
              <OptPill key={a.value} label={a.label} icon={a.icon} active={awardType === a.value}
                onClick={() => setAwardType(a.value)} />
            ))}
          </div>
        </div>

        {/* Selected award preview */}
        {selectedAward && (
          <div className="flex items-center gap-3 p-4 rounded-[14px]"
            style={{ background: 'rgba(200,242,90,0.06)', border: '1px solid rgba(200,242,90,0.18)' }}>
            <selectedAward.icon size={22} color="#C8F25A" />
            <p className="text-[14px] font-semibold text-[#C8F25A]">{selectedAward.label}</p>
          </div>
        )}

        {/* Awarded for (optional context) */}
        <div className="space-y-1.5">
          <MetadataLabel text="AWARDED FOR (OPTIONAL)" />
          <input
            type="text"
            value={awardedFor}
            onChange={e => setAwardedFor(e.target.value)}
            maxLength={60}
            placeholder='e.g. "Week of 14 Apr" or "April 2026"'
            className="w-full px-4 py-3 rounded-[10px] bg-[#0d0d0f] border border-white/[0.07] text-sm text-white/88 outline-none placeholder:text-white/20"
          />
        </div>

        {/* Note */}
        <div className="space-y-1.5">
          <div className="flex justify-between items-center">
            <MetadataLabel text="NOTE (OPTIONAL)" />
            <span className="text-[10px] text-white/25">{note.length}/150</span>
          </div>
          <textarea
            value={note}
            onChange={e => { if (e.target.value.length <= 150) setNote(e.target.value) }}
            maxLength={150}
            rows={2}
            placeholder="A short message to the player..."
            className="w-full px-4 py-3 rounded-[10px] bg-[#0d0d0f] border border-white/[0.07] text-sm text-white/88 outline-none resize-none placeholder:text-white/20"
          />
        </div>

        {/* Save */}
        <button onClick={handleSave} disabled={!playerId || !awardType || saving}
          className="w-full py-4 rounded-[10px] bg-[#C8F25A] text-black font-bold text-sm disabled:opacity-40 transition-opacity">
          {saving ? 'Saving...' : 'Give Award →'}
        </button>
      </div>

      <NavBar role="coach" activeTab="/coach/squad" onNavigate={p => navigate(p)} />
    </MobileShell>
  )
}
