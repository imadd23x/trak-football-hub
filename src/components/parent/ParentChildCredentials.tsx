import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useParentChildren } from '@/contexts/ParentChildrenContext'
import { Button } from '@/components/ui/button'
import { PasswordInput } from '@/components/ui/password-input'
import { MetadataLabel } from '@/components/trak'
import { fetchChildCredentials, resetChildPassword, type ChildCredential } from '@/lib/child-recovery'
import { PASSWORD_HINT, validatePassword } from '@/lib/password'

export function ParentChildCredentials() {
  const { parentId } = useParentChildren()
  const query = useQuery({
    queryKey: ['parent', parentId, 'child-credentials'],
    queryFn: ({ signal }) => fetchChildCredentials(parentId!, signal),
    enabled: !!parentId, staleTime: 0, retry: false, networkMode: 'always',
  })
  if (!parentId) return null
  if (query.isPending) return <p role="status" className="text-sm text-muted-foreground">Loading child logins…</p>
  if (query.isError) return <div className="p-4 border border-border rounded-xl">
    <p role="alert" className="text-sm text-destructive">Couldn't load child logins. Please try again.</p>
    <Button variant="outline" onClick={() => { void query.refetch() }}>Retry child logins</Button>
  </div>
  if (!query.data?.length) return null
  return <div className="space-y-3">
    <MetadataLabel text="CHILD LOGINS" />
    {query.data.map(child => <ChildPasswordCard key={`${parentId}:${child.roster_child_id}`} parentId={parentId} child={child} />)}
  </div>
}

function ChildPasswordCard({ parentId, child }: { parentId: string; child: ChildCredential }) {
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  // TRAK-104: the password changed but other devices may still be signed in.
  const [signOutFailed, setSignOutFailed] = useState(false)
  const request = useRef<AbortController | null>(null)
  useEffect(() => () => { request.current?.abort() }, [])
  const clearForm = () => { setPassword(''); setConfirm(''); setOpen(false) }
  const save = async () => {
    if (request.current) return
    const problem = validatePassword(password) || (password !== confirm ? 'Passwords do not match' : null)
    if (problem) { setError(problem); return }
    const controller = new AbortController(); request.current = controller
    setBusy(true); setError(null); setSaved(false); setSignOutFailed(false)
    try {
      const result = await resetChildPassword(parentId, child.roster_child_id, password, controller.signal)
      if (!controller.signal.aborted) {
        if (result === 'signed_out') { clearForm(); setSaved(true) } else setSignOutFailed(true)
      }
    } catch {
      if (!controller.signal.aborted) setError('Could not set the password. Check your guardian link and approval, then try again.')
    } finally {
      if (!controller.signal.aborted) { request.current = null; setBusy(false) }
    }
  }
  return <section aria-label={`${child.first_name}'s login`} className="rounded-xl border border-border p-4 space-y-3">
    <h2 className="text-base text-foreground">{child.first_name}'s login</h2>
    <p className="text-sm text-muted-foreground">Username: <strong className="text-foreground">{child.username}</strong></p>
    {saved && <p role="status" className="text-sm text-foreground">Password set for {child.first_name}. {child.first_name} is now signed out on every device.</p>}
    {signOutFailed && <p role="alert" className="text-sm text-destructive">{child.first_name}'s password changed, but we couldn't sign {child.first_name} out of other devices. Set the password again to retry.</p>}
    {open ? <>
      <PasswordInput label={`${child.first_name}'s new password`} autoComplete="new-password" placeholder={PASSWORD_HINT}
        value={password} disabled={busy} onChange={e => setPassword(e.target.value)} />
      <PasswordInput label={`Confirm ${child.first_name}'s password`} autoComplete="new-password"
        value={confirm} disabled={busy} onChange={e => setConfirm(e.target.value)} />
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <Button disabled={busy} onClick={() => { void save() }}>{busy ? 'Saving…' : 'Save new password'}</Button>
      <Button variant="ghost" disabled={busy} onClick={clearForm}>Cancel</Button>
    </> : <Button variant="outline" onClick={() => { setOpen(true); setError(null); setSaved(false); setSignOutFailed(false) }}>Set a new password</Button>}
  </section>
}
