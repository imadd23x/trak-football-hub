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
export function CoachLinkCard({ hideWhenLinked = false }: { hideWhenLinked?: boolean } = {}) {
  const { user } = useAuth()
  const [linked, setLinked] = useState<{ coachName: string | null } | null>(null)
  const [checking, setChecking] = useState(true)
  const [lookupFailed, setLookupFailed] = useState(false)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => { if (user) checkLink() }, [user])

  async function checkLink() {
    if (!user) return
    setChecking(true)
    setLookupFailed(false)

    // Only an *active* relationship counts as connected. A row whose coach has
    // left the academy (status 'coach_departed') or whose coach_user_id has
    // been nulled by the ON DELETE SET NULL on squad_players is preserved
    // history, not a live link — and since K2 those rows are genuinely
    // invisible to the old coach, so showing "Connected" would strand the
    // player with no way to enter a replacement code.
    const { data, error } = await supabase
      .from('squad_players')
      .select('id, coach_user_id, status')
      .eq('linked_player_id', user.id)
      .neq('status', 'coach_departed')
      .not('coach_user_id', 'is', null)
      .limit(1)
      .maybeSingle()

    // A failed read must not render as "not connected". That is the same
    // false-negative that made the parent screens tell people to redo a step
    // they had already completed — and here it would invite a player who is
    // already linked to re-enter a code they do not have.
    if (error) { setChecking(false); setLookupFailed(true); return }
    if (!data) { setChecking(false); setLinked(null); return }

    // The link is already established at this point, so say so before going to
    // fetch the coach's name. Clearing `checking` first left a window where
    // `linked` was still null and the card rendered the code prompt to a player
    // who is connected — brief on a fast network, indefinite on a slow one.
    setLinked({ coachName: null })
    setChecking(false)

    if (data.coach_user_id) {
      const { data: profile } = await supabase
        .from('profiles').select('full_name').eq('user_id', data.coach_user_id).maybeSingle()
      setLinked({ coachName: profile?.full_name ?? null })
    }
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

  // Deliberately a local error rather than the shared LoadError component:
  // that lands in #18 and neither branch has merged, so adding a second
  // src/components/trak/LoadError.tsx here would guarantee a conflict on a
  // file that does not exist on main yet. Consolidate once #18 is in.
  if (lookupFailed) {
    return (
      <div className="rounded-[18px] p-4 border border-white/[0.07] bg-[#101012]" role="alert">
        <MetadataLabel text="YOUR COACH" />
        <p className="mt-2 text-[12px] text-white/55 leading-relaxed">
          We couldn't check whether you're connected to a coach. This isn't a change
          to your account — nothing has been lost.
        </p>
        <button
          onClick={checkLink}
          className="mt-3 px-4 py-2 rounded-[10px] text-[12px] text-white/70 border border-white/[0.07] active:bg-white/[0.04]"
          style={{ fontFamily: "'DM Mono', monospace" }}
        >
          Retry
        </button>
      </div>
    )
  }

  // On Profile, Connections already names the coach (TRAK-71).
  if (linked && hideWhenLinked) return null

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
