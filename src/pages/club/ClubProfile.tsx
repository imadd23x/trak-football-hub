import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronRight, Settings as SettingsIcon, Copy, Check } from 'lucide-react'
import { ClubShell, ClubCard, SectionLabel } from '@/components/club/ClubShell'
import { useAuth } from '@/contexts/AuthContext'
import { supabase } from '@/integrations/supabase/client'
import { IconHowItWorks } from '@/components/icons/TrakIcons'
import { toast } from 'sonner'

export default function ClubProfile() {
  const { user, profile } = useAuth()
  const navigate = useNavigate()

  const [orgName, setOrgName] = useState<string | null>(null)
  const [joinCode, setJoinCode] = useState<string | null>(null)
  const [coachCount, setCoachCount] = useState(0)
  const [playerCount, setPlayerCount] = useState(0)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (user) loadOrg()
  }, [user])

  const loadOrg = async () => {
    const { data: org } = await supabase
      .from('organizations')
      .select('id, name, join_code')
      .eq('admin_user_id', user!.id)
      .maybeSingle()

    if (!org) return

    setOrgName(org.name)
    setJoinCode(org.join_code)

    // Count coaches in this org
    const { data: coaches } = await supabase
      .from('coach_details')
      .select('user_id')
    setCoachCount(coaches?.length ?? 0)

    // Count players across those coaches
    if (coaches && coaches.length > 0) {
      const coachIds = coaches.map(c => c.user_id)
      const { data: squad } = await supabase
        .from('squad_players')
        .select('id')
        .in('coach_user_id', coachIds)
      setPlayerCount(squad?.length ?? 0)
    }
  }

  const copyCode = () => {
    if (!joinCode) return
    navigator.clipboard.writeText(`TRK-${joinCode}`)
    setCopied(true)
    toast.success('Academy code copied')
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <ClubShell>
      {/* Identity */}
      <div className="text-center mb-8 pt-2">
        <div
          className="w-[72px] h-[72px] rounded-[22px] mx-auto mb-4 overflow-hidden flex items-center justify-center"
          style={{ background: 'rgba(200,242,90,0.08)', border: '1px solid rgba(200,242,90,0.18)' }}
        >
          <span className="text-2xl font-semibold text-primary" aria-hidden="true">
              {(profile?.full_name || '?').charAt(0).toUpperCase()}
            </span>
        </div>
        <p
          style={{
            fontFamily: "'DM Sans', sans-serif",
            fontSize: 20,
            fontWeight: 400,
            letterSpacing: '-0.02em',
            color: 'rgba(255,255,255,0.88)',
          }}
        >
          {profile?.full_name || '—'}
        </p>
        <span
          className="inline-flex items-center mt-2 h-5 px-2.5 rounded-full"
          style={{
            fontFamily: "'DM Mono', monospace",
            fontSize: 8,
            fontWeight: 500,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: '#C8F25A',
            background: 'rgba(200,242,90,0.08)',
            border: '1px solid rgba(200,242,90,0.2)',
          }}
        >
          Administrator
        </span>
      </div>

      {/* Academy Info Card */}
      {orgName && (
        <ClubCard className="p-5 mb-5">
          <SectionLabel>Academy</SectionLabel>
          <div className="mt-2" style={{ fontSize: 20, fontWeight: 400, color: 'rgba(255,255,255,0.88)' }}>
            {orgName}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="px-3 py-2" style={{ background: '#0A0A0B', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12 }}>
              <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.22)' }}>
                Coaches
              </div>
              <div style={{ fontSize: 18, color: 'rgba(255,255,255,0.88)', marginTop: 2 }}>{coachCount}</div>
            </div>
            <div className="px-3 py-2" style={{ background: '#0A0A0B', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12 }}>
              <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.22)' }}>
                Players
              </div>
              <div style={{ fontSize: 18, color: 'rgba(255,255,255,0.88)', marginTop: 2 }}>{playerCount}</div>
            </div>
          </div>
        </ClubCard>
      )}

      {/* Academy code. Since TRAK-12 (#151) it no longer lets a coach join. */}
      {joinCode && (
        <ClubCard className="p-5 mb-5">
          <SectionLabel>Academy Code</SectionLabel>
          <p className="mt-1" style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', lineHeight: 1.5 }}>
            Trak adds coaches to your academy. Quote this code when you ask Trak to add one.
          </p>
          <button
            onClick={copyCode}
            className="mt-3 w-full flex items-center justify-between px-4 py-3 rounded-[12px] transition-colors"
            style={{ background: 'rgba(200,242,90,0.06)', border: '1px solid rgba(200,242,90,0.2)' }}
          >
            <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 18, fontWeight: 500, color: '#C8F25A', letterSpacing: '0.08em' }}>
              TRK-{joinCode}
            </span>
            {copied
              ? <Check size={18} style={{ color: '#C8F25A' }} />
              : <Copy size={18} style={{ color: 'rgba(200,242,90,0.5)' }} />
            }
          </button>
        </ClubCard>
      )}

      {/* Nav rows */}
      <div className="space-y-2.5 mb-8">
        <button
          onClick={() => navigate('/how-it-works')}
          className="w-full flex items-center justify-between rounded-[18px] p-4 text-left transition-colors"
          style={{ background: '#101012', border: '1px solid rgba(255,255,255,0.07)' }}
        >
          <div className="flex items-center gap-3">
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center"
              style={{ background: 'rgba(200,242,90,0.08)', border: '1px solid rgba(200,242,90,0.18)' }}
            >
              <IconHowItWorks size={16} color="#C8F25A" />
            </div>
            <div>
              <SectionLabel>HOW TRAK WORKS</SectionLabel>
              <p className="text-[12px] text-white/55 mt-1" style={{ fontFamily: "'DM Sans', sans-serif" }}>
                Performance bands &amp; rating engine
              </p>
            </div>
          </div>
          <ChevronRight size={18} className="text-white/40" />
        </button>

        <button
          onClick={() => navigate('/settings')}
          className="w-full flex items-center justify-between rounded-[18px] p-4 text-left transition-colors"
          style={{ background: '#101012', border: '1px solid rgba(255,255,255,0.07)' }}
        >
          <div className="flex items-center gap-3">
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}
            >
              <SettingsIcon size={16} className="text-white/55" />
            </div>
            <div>
              <SectionLabel>SETTINGS</SectionLabel>
              <p className="text-[12px] text-white/55 mt-1" style={{ fontFamily: "'DM Sans', sans-serif" }}>
                Account, password, access
              </p>
            </div>
          </div>
          <ChevronRight size={18} className="text-white/40" />
        </button>
      </div>

    </ClubShell>
  )
}
