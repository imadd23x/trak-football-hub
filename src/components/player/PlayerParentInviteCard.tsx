import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/integrations/supabase/client'

interface PlayerParentInvite {
  id: string
  player_user_id: string
  parent_email: string
  invite_token: string
  status: string
  expires_at: string
}

interface DeliveryResult {
  sent?: boolean
  reason?: string
}

const NO_INVITES: PlayerParentInvite[] = []

function readInvites(value: unknown, playerId: string): PlayerParentInvite[] {
  if (!Array.isArray(value)) throw new Error('Could not read invitations')
  return value.map(row => {
    if (!row || typeof row !== 'object') throw new Error('Could not read invitations')
    const invite = row as Record<string, unknown>
    if (['id', 'player_user_id', 'parent_email', 'invite_token', 'status', 'expires_at']
      .some(key => typeof invite[key] !== 'string') || invite.player_user_id !== playerId) {
      throw new Error('Could not read invitations for this account')
    }
    return invite as unknown as PlayerParentInvite
  })
}

/** A key resets local notices and revealed links immediately on account change. */
export function PlayerParentInviteCard({ playerUserId, showWhenEmpty = false, hideWhenLinked = false }: { playerUserId: string; showWhenEmpty?: boolean; hideWhenLinked?: boolean }) {
  return <PlayerInvitations key={playerUserId} playerUserId={playerUserId} showWhenEmpty={showWhenEmpty} hideWhenLinked={hideWhenLinked} />
}

function PlayerInvitations({ playerUserId, showWhenEmpty, hideWhenLinked }: { playerUserId: string; showWhenEmpty: boolean; hideWhenLinked: boolean }) {
  const queryClient = useQueryClient()
  const mounted = useRef(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const rotationKey = ['player', playerUserId, 'parent-invite-rotations']
  // Keep uncertainty when navigating between the home and profile entry points.
  // A successful read of the unchanged token does not prove a timed-out write ended.
  const { data: blockedTokens } = useQuery<Record<string, string>>({
    queryKey: rotationKey, queryFn: () => ({}), initialData: {}, enabled: false, gcTime: Infinity,
  })
  const [revealed, setRevealed] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ id: string; text: string } | null>(null)
  const [now, setNow] = useState(Date.now)
  const query = useQuery({
    queryKey: ['player', playerUserId, 'parent-invites'],
    queryFn: async ({ signal }) => {
      const { data, error } = await supabase.rpc('get_player_invites_for_current_user').abortSignal(signal)
      if (error) throw error
      return readInvites(data, playerUserId)
    },
    staleTime: 0,
    retry: false,
    networkMode: 'always',
  })
  const invites = query.data ?? NO_INVITES

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  // Remove sharing at the expiry boundary even if this screen stays open.
  useEffect(() => {
    const expiries = invites.filter(invite => invite.status === 'pending')
      .map(invite => Date.parse(invite.expires_at)).filter(time => time > now)
    if (!expiries.length) return
    const timer = window.setTimeout(() => setNow(Date.now()), Math.min(Math.min(...expiries) - now + 1, 2_147_483_647))
    return () => window.clearTimeout(timer)
  }, [invites, now])

  const reconcileRotations = useCallback((latest: PlayerParentInvite[]) => {
    queryClient.setQueryData<Record<string, string>>(['player', playerUserId, 'parent-invite-rotations'], previous => {
      const next = { ...previous }
      for (const [id, oldToken] of Object.entries(next)) {
        const updated = latest.find(invite => invite.id === id)
        if (updated && (updated.status !== 'pending' || updated.invite_token !== oldToken)) delete next[id]
      }
      return next
    })
  }, [queryClient, playerUserId])

  useEffect(() => {
    if (!query.isError && !query.isFetching) reconcileRotations(invites)
  }, [invites, query.isError, query.isFetching, reconcileRotations])

  async function refresh() {
    setRevealed(null)
    try {
      const result = await query.refetch({ throwOnError: true })
      if (mounted.current) {
        reconcileRotations(result.data ?? NO_INVITES)
        setNotice(null)
        setNow(Date.now())
      }
    } catch { /* Query error stays visible, and stale tokens stay blocked. */ }
  }

  async function resend(invite: PlayerParentInvite) {
    // Read the shared guard synchronously as well as disabling the control:
    // it survives route remounts and closes the gap before React re-renders.
    if (busyId || invite.status !== 'pending'
      || queryClient.getQueryData<Record<string, string>>(rotationKey)?.[invite.id]) return
    setBusyId(invite.id)
    setNotice(null)
    setRevealed(null)
    // Rotation precedes email delivery. Hide the old token before starting.
    queryClient.setQueryData<Record<string, string>>(rotationKey, previous => ({ ...previous, [invite.id]: invite.invite_token }))
    let message = "Couldn't confirm email delivery. Check the invitation status below."
    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession()
      if (sessionError || sessionData.session?.user.id !== playerUserId) throw new Error('Account changed')
      const { data, error } = await supabase.functions.invoke<DeliveryResult>('send-parent-invite', {
        body: { invite_id: invite.id, resend: true },
        // Bind this action to its initiating player even if a shared phone signs in again.
        headers: { Authorization: `Bearer ${sessionData.session.access_token}` },
      })
      if (!error && data?.sent === true) message = 'Email sent. Ask your parent to check their inbox and spam folder.'
      else if (!error && data?.reason === 'already_accepted') message = 'This parent is already linked. No email was sent.'
    } catch { /* A failed response does not prove that token rotation failed. */ }
    finally {
      // Always reload, including HTTP errors and uncertain network outcomes.
      // Never offer the previous token as the recovery path after a failed reload.
      try {
        const result = await query.refetch({ throwOnError: true })
        const latest = result.data ?? NO_INVITES
        const updated = latest.find(row => row.id === invite.id)
        if (mounted.current) reconcileRotations(latest)
        if (!updated || (updated.status === 'pending' && updated.invite_token === invite.invite_token)) {
          message = "Couldn't confirm the updated link yet. Retry loading before sharing."
        }
      } catch {
        message = "Couldn't refresh the invitation after this attempt. Retry loading before sharing a link."
      }
      if (mounted.current) {
        setBusyId(null)
        setNotice({ id: invite.id, text: message })
        setNow(Date.now())
      }
    }
  }

  async function share(invite: PlayerParentInvite) {
    if (invite.status !== 'pending' || query.isError || query.isFetching || busyId === invite.id || blockedTokens[invite.id]) return
    if (Date.parse(invite.expires_at) <= Date.now() || !Number.isFinite(Date.parse(invite.expires_at))) {
      setNow(Date.now())
      return
    }
    const url = `${window.location.origin}/parent-invite?token=${encodeURIComponent(invite.invite_token)}`
    try {
      if (typeof navigator.share === 'function') {
        await navigator.share({ title: 'Trak', text: 'Follow my progress on Trak', url })
      } else {
        if (!navigator.clipboard) throw new Error('Clipboard unavailable')
        await navigator.clipboard.writeText(url)
        if (mounted.current) setNotice({ id: invite.id, text: 'Link copied — send it to your parent.' })
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return
      if (mounted.current) setRevealed(invite.id)
    }
  }

  if (!showWhenEmpty && !query.isPending && !query.isError && invites.length === 0) return null
  // Home only (TRAK-71): once a parent is linked there is nothing to act on here.
  if (hideWhenLinked && !query.isPending && !query.isError && invites.length > 0
    && invites.every(invite => invite.status === 'accepted')) return null
  return (
    <section aria-label="Parent invitations" className="rounded-xl border border-border bg-card p-4 my-4">
      <h2 className="text-sm font-medium text-foreground">Parent invitations</h2>
      <p className="text-sm text-muted-foreground mt-2">Contact your academy to add a guardian or correct their email.</p>
      {query.isPending && <p role="status" className="text-sm text-muted-foreground mt-2">Loading invitations…</p>}
      {(query.isError || (!busyId && Object.keys(blockedTokens).length > 0)) && <div role={query.isError ? 'alert' : 'status'} className="mt-2">
        <p className="text-sm text-muted-foreground">{query.isError
          ? "Couldn't load current invitations. Check your connection and retry."
          : 'Waiting for an updated invitation link. Sharing and resending are paused until its status is confirmed.'}</p>
        {Object.keys(blockedTokens).length > 0 && <p className="text-sm text-muted-foreground mt-2">
          Retry loading to check for an updated link. If it stays unconfirmed, ask your academy to check this invitation before trying again.
        </p>}
        <button disabled={!!busyId || query.isFetching} onClick={() => { void refresh() }}
          className="mt-2 min-h-11 rounded-lg border border-border px-3 text-sm text-foreground disabled:opacity-50">Retry loading</button>
      </div>}
      {invites.map(invite => {
        const valid = Number.isFinite(Date.parse(invite.expires_at)) && Date.parse(invite.expires_at) > now
        const accepted = invite.status === 'accepted'
        const pending = invite.status === 'pending'
        const canShare = pending && valid && !query.isError && !query.isFetching && busyId !== invite.id && !blockedTokens[invite.id]
        return <div key={invite.id} role="group" aria-label={invite.parent_email} className="mt-3 pt-3 border-t border-border">
          <p className="text-sm text-foreground break-all">{invite.parent_email}</p>
          <p className="text-xs text-muted-foreground mt-1">
            {accepted ? 'Parent linked' : !pending ? 'Invitation unavailable'
              : blockedTokens[invite.id] ? 'Resend unconfirmed — check its status before trying again.'
              : !valid ? 'Invitation expired — resend to create a new link.'
                : `Waiting to join · expires ${new Date(invite.expires_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`}
          </p>
          {pending && <div className="flex flex-wrap gap-2 mt-3">
            {valid && <button onClick={() => { void share(invite) }} disabled={!canShare}
              className="min-h-11 rounded-lg bg-primary/20 border border-primary/40 px-3 text-sm text-foreground disabled:opacity-50">Share link</button>}
            <button onClick={() => { void resend(invite) }} disabled={!!busyId || query.isFetching || query.isError || !!blockedTokens[invite.id]}
              className="min-h-11 rounded-lg border border-border px-3 text-sm text-foreground disabled:opacity-50">
              {busyId === invite.id ? 'Resending…' : 'Resend email'}
            </button>
          </div>}
          {notice?.id === invite.id && <p role="status" className="mt-2 text-sm text-muted-foreground">{notice.text}</p>}
          {revealed === invite.id && canShare && <label className="block mt-3 text-xs text-muted-foreground">
            Copy this link and send it to your parent
            <input readOnly value={`${window.location.origin}/parent-invite?token=${encodeURIComponent(invite.invite_token)}`}
              onFocus={event => event.target.select()} className="mt-1 w-full rounded-lg border border-border bg-background p-2 text-sm text-foreground" />
          </label>}
        </div>
      })}

    </section>
  )
}
