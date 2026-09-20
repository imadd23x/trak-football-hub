import { OwnAvatar } from '@/components/profile/OwnAvatar'
import { useEffect, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { ChevronRight, Settings as SettingsIcon, BookOpen } from 'lucide-react'
import { supabase } from '@/integrations/supabase/client'
import { useAuth } from '@/contexts/AuthContext'
import { MobileShell, NavBar, TrakCard, MetadataLabel, InviteCodeDisplay } from '@/components/trak'
import { IconProfile } from '@/components/icons/TrakIcons'
import { formatCoachCode, generateCode } from '@/lib/invite-codes'

export default function CoachProfilePage() {
  const { user, profile } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [details, setDetails] = useState<any>(null)
  const [inviteCode, setInviteCode] = useState('')

  useEffect(() => {
    if (!user) return
    supabase.from('coach_details').select('*').eq('user_id', user.id).maybeSingle().then(({ data }) => {
      setDetails(data)
    })
    // The real invite code lives on profiles.invite_code — it's what
    // get_coach_id_by_invite_code matches when players link up.
    supabase.from('profiles').select('invite_code').eq('user_id', user.id).maybeSingle()
      .then(async ({ data }) => {
        if (data?.invite_code) {
          setInviteCode(formatCoachCode(data.invite_code))
        } else {
          // Self-heal: generate and persist one (same pattern as CoachHomePage)
          const newCode = generateCode()
          const { error } = await supabase.from('profiles').update({ invite_code: newCode }).eq('user_id', user.id)
          if (!error) setInviteCode(formatCoachCode(newCode))
        }
      })
  }, [user])

  return (
    <MobileShell>
      <div className="flex items-center justify-between pt-3 pb-2 border-b border-white/[0.07]">
        <span className="text-[16px] font-medium text-white/88" style={{ fontFamily: "'DM Sans', sans-serif" }}>Profile</span>
      </div>

      <div className="pt-3.5 pb-4 space-y-2.5">
        {/* Avatar + Identity */}
        <div className="text-center mb-6">
          <div className="w-[72px] h-[72px] rounded-[22px] overflow-hidden bg-[#202024] border border-[rgba(200,242,90,0.18)] mx-auto mb-3 flex items-center justify-center">
            <OwnAvatar reference={profile?.avatar_url} fallback={<IconProfile size={32} color="#C8F25A" />} />
          </div>
          <p className="text-[20px] font-semibold text-white/88 tracking-tight" style={{ fontFamily: "'DM Sans', sans-serif", letterSpacing: '-0.02em' }}>
            {profile?.full_name || 'Coach'}
          </p>
          <div className="flex justify-center gap-1.5 mt-2 flex-wrap">
            {details?.coach_role && (
              <span className="h-5 px-2.5 rounded-full bg-white/[0.06] border border-white/[0.07] text-[8px] font-medium tracking-[0.06em] uppercase text-white/45 inline-flex items-center"
                style={{ fontFamily: "'DM Mono', monospace" }}>{details.coach_role}</span>
            )}
            {details?.current_club && (
              <span className="h-5 px-2.5 rounded-full bg-white/[0.06] border border-white/[0.07] text-[8px] font-medium tracking-[0.06em] uppercase text-white/45 inline-flex items-center"
                style={{ fontFamily: "'DM Mono', monospace" }}>{details.current_club}{details.team ? ` · ${details.team}` : ''}</span>
            )}
          </div>
        </div>

        {/* Invite code */}
        <TrakCard>
          <InviteCodeDisplay code={inviteCode} label="YOUR INVITE CODE" />
          <p className="text-[11px] text-white/45 text-center mt-2" style={{ fontFamily: "'DM Sans', sans-serif" }}>
            Share this code with your players so they can connect with you.
          </p>
        </TrakCard>

        {/* Coach manual */}
        <button
          onClick={() => navigate('/coach/manual')}
          className="w-full flex items-center justify-between rounded-[18px] p-4 border border-white/[0.07] bg-[#101012] text-left hover:bg-[#141416] transition-colors"
        >
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center"
              style={{ background: 'rgba(200,242,90,0.08)', border: '1px solid rgba(200,242,90,0.18)' }}>
              <BookOpen size={16} className="text-[#C8F25A]" strokeWidth={1.5} />
            </div>
            <div>
              <MetadataLabel text="COACH MANUAL" />
              <p className="text-[12px] text-white/55 mt-1" style={{ fontFamily: "'DM Sans', sans-serif" }}>
                How to use TRAK with your squad
              </p>
            </div>
          </div>
          <ChevronRight size={18} className="text-white/40" />
        </button>

        {/* Settings entry */}
        <button
          onClick={() => navigate('/settings')}
          className="w-full flex items-center justify-between rounded-[18px] p-4 border border-white/[0.07] bg-[#101012] text-left hover:bg-[#141416] transition-colors"
        >
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-white/[0.04] flex items-center justify-center">
              <SettingsIcon size={16} className="text-white/55" />
            </div>
            <div>
              <MetadataLabel text="SETTINGS" />
              <p className="text-[12px] text-white/55 mt-1" style={{ fontFamily: "'DM Sans', sans-serif" }}>
                Account, notifications, privacy
              </p>
            </div>
          </div>
          <ChevronRight size={18} className="text-white/40" />
        </button>
      </div>
      <NavBar role="coach" activeTab={location.pathname} onNavigate={navigate} />
    </MobileShell>
  )
}
