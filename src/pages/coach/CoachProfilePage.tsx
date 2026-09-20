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
  // InviteCodeDisplay always renders a working Copy button, so an unverified
  // code must not be handed to it at all. It is a shared component and this is
  // a coach-page concern, so the gate lives here rather than in its props.
  const [inviteStatus, setInviteStatus] = useState<'loading' | 'ready' | 'failed'>('loading')

  // Academy membership. `orgName` is null while unknown; `orgStatus` separates
  // "not in an academy" from "we could not find out", because the join form
  // below is shown for the first and must not be shown for the second — a coach
  // who is already in an academy should never be invited to join one.
  const [orgName, setOrgName] = useState<string | null>(null)
  const [orgStatus, setOrgStatus] = useState<'loading' | 'none' | 'joined' | 'failed'>('loading')
  const [joinCode, setJoinCode] = useState('')
  const [joining, setJoining] = useState(false)
  const [joinError, setJoinError] = useState<string | null>(null)

  const loadOrg = async (uid: string) => {
    const { data, error } = await supabase
      .from('coach_details').select('organization_id').eq('user_id', uid).maybeSingle()
    if (error) {
      console.error('Academy read failed:', error)
      setOrgStatus('failed')
      return
    }
    const orgId = (data as { organization_id?: string | null } | null)?.organization_id
    if (!orgId) {
      setOrgName(null)
      setOrgStatus('none')
      return
    }
    // "Coaches can read own org" makes the name readable once linked. A failure
    // here does not undo the membership, so the card still says joined.
    const { data: org } = await supabase
      .from('organizations').select('name').eq('id', orgId).maybeSingle()
    setOrgName((org as { name?: string } | null)?.name ?? null)
    setOrgStatus('joined')
  }

  useEffect(() => {
    if (!user) return
    // The error was discarded here, so a failed read rendered as a coach with
    // no club, team or role — indistinguishable from a blank profile.
    supabase.from('coach_details').select('*').eq('user_id', user.id).maybeSingle().then(({ data, error }) => {
      if (error) {
        console.error('Coach details read failed:', error)
        return
      }
      setDetails(data)
    })
    void loadOrg(user.id)
    // The real invite code lives on profiles.invite_code — it's what
    // get_coach_id_by_invite_code matches when players link up.
    supabase.from('profiles').select('invite_code').eq('user_id', user.id).maybeSingle()
      .then(async ({ data, error }) => {
        // The read's error was discarded here too, so a failed read looked
        // exactly like "no code yet" and the self-heal below overwrote the
        // coach's real invite code — the code players type to join. This page
        // and CoachHomePage each rotated it independently, so an offline
        // moment on either one invalidated every code already handed out.
        if (error) {
          console.error('Invite code read failed:', error)
          setInviteStatus('failed')
          return
        }

        if (data?.invite_code) {
          setInviteCode(formatCoachCode(data.invite_code))
          setInviteStatus('ready')
          return
        }

        // Self-heal, now only when the read actually succeeded and found none.
        const newCode = generateCode()
        // select() back: a zero-row update returns no error, and showing the
        // generated code then promises a player something never stored.
        const { data: stored, error: writeError } = await supabase
          .from('profiles').update({ invite_code: newCode })
          .eq('user_id', user.id).select('invite_code').maybeSingle()
        if (writeError || stored?.invite_code !== newCode) {
          console.error('Invite code write failed or stored nothing:', writeError)
          setInviteStatus('failed')
          return
        }
        setInviteCode(formatCoachCode(newCode))
        setInviteStatus('ready')
      })
  }, [user])

  const handleJoinAcademy = async () => {
    if (!user || joining) return
    const code = joinCode.trim()
    if (!code) return
    setJoining(true)
    setJoinError(null)

    const { data: returnedOrgId, error } = await supabase
      .rpc('join_organization' as any, { p_code: code.replace(/^TRK-/i, '') })

    if (error) {
      // The RPC raises 'Invalid academy code' for an unknown code. Anything
      // else is a genuine failure and should not be reported as a typo.
      setJoinError(
        /invalid academy code/i.test(error.message)
          ? "That academy code wasn't recognised. Check it with your academy."
          : 'Could not join just now. Nothing has changed — try again.',
      )
      setJoining(false)
      return
    }

    // Read back, because the RPC cannot tell you it did nothing.
    //
    //   UPDATE public.coach_details SET organization_id = v_org_id
    //   WHERE user_id = auth.uid();
    //   RETURN v_org_id;
    //
    // A coach with no coach_details row updates zero rows and still gets the
    // organisation's id back. Trusting the return value would show "joined"
    // over a database that never recorded it — the same shape as everything
    // else fixed on this branch, this time in a function I did not write.
    const { data: check, error: checkError } = await supabase
      .from('coach_details').select('organization_id').eq('user_id', user.id).maybeSingle()
    const storedOrgId = (check as { organization_id?: string | null } | null)?.organization_id

    if (checkError || !storedOrgId || storedOrgId !== returnedOrgId) {
      console.error('join_organization returned an id but stored nothing', { returnedOrgId, storedOrgId, checkError })
      setJoinError('The academy did not save. Nothing has changed — please tell your academy admin.')
      setJoining(false)
      return
    }

    setJoinCode('')
    setJoining(false)
    await loadOrg(user.id)
  }

  return (
    <MobileShell>
      <div className="flex items-center justify-between pt-3 pb-2 border-b border-white/[0.07]">
        <span className="text-[16px] font-medium text-white/88" style={{ fontFamily: "'DM Sans', sans-serif" }}>Profile</span>
      </div>

      <div className="pt-3.5 pb-4 space-y-2.5">
        {/* Avatar + Identity */}
        <div className="text-center mb-6">
          <div className="w-[72px] h-[72px] rounded-[22px] overflow-hidden bg-[#202024] border border-[rgba(200,242,90,0.18)] mx-auto mb-3 flex items-center justify-center">
            {profile?.avatar_url
              ? <img src={profile.avatar_url} alt="Profile" className="w-full h-full object-cover" />
              : <IconProfile size={32} color="#C8F25A" />
            }
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
          {inviteStatus === 'ready' ? (
            <InviteCodeDisplay code={inviteCode} label="YOUR INVITE CODE" />
          ) : (
            <div className="flex flex-col items-center gap-2 py-6">
              <span
                className="text-[9px] font-medium tracking-[0.12em] uppercase text-[rgba(255,255,255,0.45)]"
                style={{ fontFamily: "'DM Mono', monospace" }}
              >
                YOUR INVITE CODE
              </span>
              <p className="text-[32px] tracking-wider text-[rgba(255,255,255,0.3)]"
                 style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 300 }}>
                {inviteStatus === 'loading' ? '···' : 'Unavailable'}
              </p>
              {inviteStatus === 'failed' && (
                <span className="text-[11px] text-white/35">Reload to try again.</span>
              )}
            </div>
          )}
          <p className="text-[11px] text-white/45 text-center mt-2" style={{ fontFamily: "'DM Sans', sans-serif" }}>
            Share this code with your players so they can connect with you.
          </p>
        </TrakCard>

        {/* Academy.
            Signup already tells a coach "you can join your academy later from
            your profile" when their code is unrecognised — and when they give
            no code at all, nothing is said and nothing is offered. Until now
            that promise had no implementation anywhere in the app:
            join_organization() has existed since 20260608000001 and was granted
            to authenticated, and no screen called it.
            A coach outside an academy is invisible to the academy dashboard,
            and so is every player they add. */}
        <TrakCard>
          <MetadataLabel text="ACADEMY" />
          {orgStatus === 'loading' ? (
            <p className="text-[13px] text-white/35 mt-2" style={{ fontFamily: "'DM Sans', sans-serif" }}>···</p>
          ) : orgStatus === 'failed' ? (
            // Not offered the join form: we do not know that they are unlinked,
            // and inviting a coach who already has an academy to join one is
            // its own kind of wrong.
            <p className="text-[12px] text-white/45 mt-2" style={{ fontFamily: "'DM Sans', sans-serif" }}>
              Couldn't check your academy just now. Reload to try again.
            </p>
          ) : orgStatus === 'joined' ? (
            <p className="text-[15px] text-white/[0.88] mt-2" style={{ fontFamily: "'DM Sans', sans-serif" }}>
              {orgName ?? 'Linked to your academy'}
            </p>
          ) : (
            <div className="mt-2">
              <p className="text-[12px] text-white/45 mb-3 leading-relaxed" style={{ fontFamily: "'DM Sans', sans-serif" }}>
                You aren't linked to an academy. Your squad is yours alone — an
                academy can't see your players, and you won't appear on its
                dashboard. Enter your academy's code to join.
              </p>
              <div className="flex gap-2">
                <input
                  value={joinCode}
                  onChange={e => { setJoinCode(e.target.value); setJoinError(null) }}
                  placeholder="TRK-XXXX"
                  autoCapitalize="characters"
                  autoCorrect="off"
                  spellCheck={false}
                  className="flex-1 min-w-0 h-10 px-3 rounded-[10px] bg-white/[0.04] border border-white/[0.09] text-[13px] text-white/[0.88] placeholder:text-white/25 outline-none focus:border-[rgba(200,242,90,0.35)]"
                  style={{ fontFamily: "'DM Mono', monospace" }}
                />
                <button
                  onClick={handleJoinAcademy}
                  disabled={joining || !joinCode.trim()}
                  className="h-10 px-4 rounded-[10px] text-[13px] font-medium text-black disabled:opacity-40 flex-shrink-0"
                  style={{ background: '#C8F25A', fontFamily: "'DM Sans', sans-serif" }}
                >
                  {joining ? 'Joining…' : 'Join'}
                </button>
              </div>
              {joinError && (
                <p className="text-[11px] mt-2" style={{ color: 'rgb(251,191,36)', fontFamily: "'DM Sans', sans-serif" }}>
                  {joinError}
                </p>
              )}
            </div>
          )}
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
