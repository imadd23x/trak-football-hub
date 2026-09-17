import { useEffect, useState } from 'react'
import { supabase } from '@/integrations/supabase/client'
import { useAuth } from '@/contexts/AuthContext'
import { MetadataLabel } from '@/components/trak'
import { toast } from 'sonner'
import { trackEvent } from '@/lib/telemetry'

/**
 * Lets a player connect to a coach AFTER signup.
 *
 * The coach code field used to exist in exactly one place — step 3 of
 * onboarding — and nowhere else. A player who tapped past it (or signed up
 * before their coach had handed the code out, which is the normal order in a
 * pilot) had no way to link, ever: no UI on the profile, none in Settings, and
 * Settings actively told them to "share your invite code", which players do not
 * have. The only remedy was deleting the account and starting again.
 *
 * The server side already existed — link_player_to_coach has been in the
 * migrations since 20260611000001 and was improved again in 20260901000006 to
 * claim the coach's existing roster row rather than duplicate it.
 */
export function CoachLinkCard() {
  const { user } = useAuth()
  const [linked, setLinked] = useState<{ coachName: string | null } | null>(null)
  const [checking, setChecking] = useState(true)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => { if (user) checkLink() }, [user])

  async function checkLink() {
    if (!user) return
    setChecking(true)
    const { data, error } = await supabase
      .from('squad_players')
      .select('id, coach_user_id')
      .eq('linked_player_id', user.id)
      .limit(1)
      .maybeSingle()

    // A failed read must not render as "not connected" — that is the same
    // false-negative that made the parent screens tell people to redo a step
    // they had already completed.
    if (error) { setChecking(false); return }
    if (!data) { setLinked(null); setChecking(false); return }

    let coachName: string | null = null
    if (data.coach_user_id) {
      const { data: profile } = await supabase
        .from('profiles').select('full_name').eq('user_id', data.coach_user_id).maybeSingle()
      coachName = profile?.full_name ?? null
    }
    setLinked({ coachName })
    setChecking(false)
  }

  async function handleConnect() {
    const value = code.trim().toUpperCase()
    if (!value) { toast.error('Enter the code your coach gave you'); return }
    setBusy(true)
    // Not in the generated types — the function exists in the migrations but the
    // committed types.ts omits it, same as provision_my_profile.
    const { error } = await (supabase as any).rpc('link_player_to_coach', { p_code: value })
    setBusy(false)

    if (error) {
      // The server raises 'Invalid coach code' for a bad code; anything else is
      // a real failure and shouldn't be reported to a teenager as a typo.
      const msg = String(error.message || '')
      if (/invalid coach code/i.test(msg)) {
        toast.error("That code wasn't recognised — check it with your coach")
      } else {
        toast.error("Couldn't connect right now. Check your signal and try again")
      }
      return
    }

    trackEvent('player_linked_coach', { actor: 'player', via: 'profile' })
    toast.success('Connected to your coach')
    setCode('')
    checkLink()
  }

  if (checking) return null

  if (linked) {
    return (
      <div className="rounded-[18px] p-4 border border-white/[0.07] bg-[#101012]">
        <MetadataLabel text="YOUR COACH" />
        <p className="mt-2 text-[14px] text-white/80">
          {linked.coachName ?? 'Connected'}
        </p>
        <p className="mt-1 text-[11px] text-white/35">
          Your matches and assessments come from your coach.
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-[18px] p-4 border" style={{ borderColor: 'rgba(200,242,90,0.2)', background: 'rgba(200,242,90,0.05)' }}>
      <MetadataLabel text="CONNECT TO YOUR COACH" />
      <p className="mt-2 text-[12px] text-white/55 leading-relaxed">
        You're not connected to a coach yet, so there's nothing to show on your card.
        Ask your coach for their code — it looks like <span className="text-white/80">TRK-AB2K</span>.
      </p>
      <div className="flex gap-2 mt-3">
        <input
          value={code}
          onChange={e => setCode(e.target.value.toUpperCase())}
          placeholder="TRK-XXXX"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          className="flex-1 px-3 py-2.5 rounded-[10px] bg-[#0A0A0B] border border-white/[0.07] text-[14px] text-white/88 placeholder-white/20 outline-none focus:border-[#C8F25A]/40"
        />
        <button
          onClick={handleConnect}
          disabled={busy || !code.trim()}
          className="shrink-0 px-4 rounded-[10px] text-[13px] font-medium disabled:opacity-40"
          style={{ background: '#C8F25A', color: '#0A0A0B' }}
        >
          {busy ? 'Connecting…' : 'Connect'}
        </button>
      </div>
    </div>
  )
}
