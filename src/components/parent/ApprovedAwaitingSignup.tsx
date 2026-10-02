import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useParentChildren } from '@/contexts/ParentChildrenContext'
import { useApprovedAwaitingSignup } from '@/hooks/useParentData'
import { Button } from '@/components/ui/button'
import { ParentLoadError } from '@/components/parent/ParentFamily'
import { consentRequest, withdrawRosterConsent } from '@/lib/parent-consent-withdrawal'

/* TRAK-98 (G6): a guardian approves a rostered child before the child has an
   account. Until the child signs up there is no player_parent_links row, so
   the family list can't show them. These show the guardian every child they
   approved who is still waiting, and let them withdraw that approval
   (withdraw_roster_consent). A consent withdrawn now stays withdrawn when the
   child later signs up, so no coach can record about them. */

/** Home: who is approved and still waiting to sign up. */
export function ApprovedAwaitingList() {
  const query = useApprovedAwaitingSignup()
  if (query.isError) return <ParentLoadError message="Couldn't check the children you've approved." onRetry={() => { void query.refetch() }} />
  const children = query.data ?? []
  if (!children.length) return null
  return (
    <section aria-label="Approved, waiting to sign up" className="rounded-xl border border-border bg-card p-4 mb-4 space-y-1">
      {children.map(child => (
        <p key={child.roster_child_id} className="text-sm text-foreground">Approved. Waiting for {child.first_name} to sign up.</p>
      ))}
      <p className="text-xs text-muted-foreground pt-1">You can withdraw an approval from Profile at any time.</p>
    </section>
  )
}

type State = 'active' | 'confirm' | 'writing' | 'done' | 'write-error'

function RosterChildConsent({ parentId, rosterChildId, name, onWithdrawn }: {
  parentId: string; rosterChildId: string; name: string; onWithdrawn: (id: string, name: string) => void
}) {
  const cache = useQueryClient()
  const [state, setState] = useState<State>('active')
  const current = useRef<AbortController | null>(null)
  const mounted = useRef(true)
  useEffect(() => () => { mounted.current = false; current.current?.abort() }, [])

  const withdraw = async () => {
    if (state !== 'confirm') return
    const request = new AbortController()
    current.current = request
    setState('writing')
    try {
      await consentRequest(request, () => withdrawRosterConsent(parentId, rosterChildId, request.signal))
      if (!mounted.current) return
      setState('done')
      onWithdrawn(rosterChildId, name)
    } catch {
      if (mounted.current) setState('write-error')
    } finally {
      // A lost response can still have committed: re-read both lists either way.
      void cache.invalidateQueries({ queryKey: ['parent', parentId, 'approved-awaiting'] })
      void cache.invalidateQueries({ queryKey: ['parent', parentId, 'roster-awaiting-consent'] })
    }
  }

  return <section aria-label={`Consent for ${name}`} className="rounded-xl border border-border bg-card p-4 space-y-3">
    <h2 className="text-base font-medium text-foreground">Consent for {name}</h2>
    {state === 'active' && <>
      <p className="text-sm text-muted-foreground">You approved {name}. They haven't set up their Trak account yet.</p>
      <Button variant="outline" className="min-h-11 h-auto whitespace-normal" onClick={() => setState('confirm')}>Withdraw consent for {name}</Button>
    </>}
    {(state === 'confirm' || state === 'writing') && <>
      <p className="text-sm text-foreground">Withdraw your approval for {name}? They can still set up their account, but their coach can't record anything about them until a guardian approves again. It does not withdraw another guardian's approval.</p>
      <div className="flex flex-col gap-2">
        <Button variant="outline" className="min-h-11 h-auto whitespace-normal border-destructive hover:bg-destructive/10" disabled={state === 'writing'} onClick={() => { void withdraw() }}>
          {state === 'writing' ? 'Withdrawing…' : `Confirm withdrawal for ${name}`}
        </Button>
        <Button variant="outline" className="min-h-11" disabled={state === 'writing'} onClick={() => setState('active')}>Keep consent</Button>
      </div>
    </>}
    {state === 'done' && <p role="status" className="text-sm text-foreground">Your consent for {name} has been withdrawn.</p>}
    {state === 'write-error' && <>
      <p role="alert" className="text-sm text-foreground">Couldn't confirm whether your consent was withdrawn. Check your connection, then check again before retrying.</p>
      <Button variant="outline" className="min-h-11" onClick={() => setState('active')}>Check again</Button>
    </>}
  </section>
}

/** Profile: one withdrawal per approved child who has no account yet. */
export function RosterConsentWithdrawals() {
  const { parentId } = useParentChildren()
  const query = useApprovedAwaitingSignup()
  // Keep a withdrawn child on screen with its confirmation after the list re-reads.
  const [withdrawn, setWithdrawn] = useState<Record<string, string>>({})
  if (!parentId) return null
  if (query.isError) return <ParentLoadError message="Couldn't check the children you've approved." onRetry={() => { void query.refetch() }} />
  const rows = (query.data ?? []).map(child => ({ id: child.roster_child_id, name: child.first_name }))
  for (const [id, name] of Object.entries(withdrawn)) if (!rows.some(row => row.id === id)) rows.push({ id, name })
  if (!rows.length) return null
  return <div className="space-y-2.5">
    {rows.map(row => <RosterChildConsent key={`${parentId}:${row.id}`} parentId={parentId} rosterChildId={row.id} name={row.name}
      onWithdrawn={(id, name) => setWithdrawn(previous => ({ ...previous, [id]: name }))} />)}
  </div>
}
