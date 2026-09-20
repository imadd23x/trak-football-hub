import { MobileShell } from '@/components/trak/MobileShell';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { StaffSignIn } from '@/components/staff/StaffSignIn';
import { loadStaffContext, revokeStaffInvitation, sendStaffInvitation, staffError, type StaffContext, type StaffInvitation, type StaffRequest } from '@/lib/staff-invites';

export default function StaffInvitationsPage() {
  const { user } = useAuth(); return <StaffInvitations key={user?.id ?? 'anonymous'} />;
}
function StaffInvitations() {
  const { user, loading: authLoading, profile } = useAuth();
  const userId = user?.id;
  const [context, setContext] = useState<StaffContext | null>(null); const [error, setError] = useState('');
  const [notice, setNotice] = useState(''); const [busy, setBusy] = useState(false);
  const [role, setRole] = useState<'coach' | 'club'>('coach'); const [email, setEmail] = useState('');
  const [academy, setAcademy] = useState(''); const [organization, setOrganization] = useState('');
  const [pending, setPending] = useState<StaffRequest | null>(null); const [replacement, setReplacement] = useState<StaffInvitation | null>(null);
  const alive = useRef(true); const locked = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const refresh = useCallback(async () => {
    if (!userId) return;
    try { const value = await loadStaffContext(userId); if (alive.current) { setContext(value); setError(''); } }
    catch (cause) { if (alive.current) setError(staffError(cause)); }
  }, [userId]);
  useEffect(() => { if (!authLoading) void refresh(); }, [authLoading, refresh]);
  const send = async (request: StaffRequest) => {
    if (!user || locked.current) return;
    locked.current = true; setBusy(true); setPending(request); setError(''); setNotice(''); setReplacement(null);
    try {
      const result = await sendStaffInvitation(user.id, request);
      if (!alive.current) return;
      setNotice(result.message); await refresh();
    } catch (cause) { if (alive.current) setError(staffError(cause)); }
    finally { if (alive.current) { locked.current = false; setBusy(false); } }
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const effectiveRole = !context?.academies.length && context?.can_invite_academies ? 'club' : role;
    void send(pending ?? { request_id: crypto.randomUUID(), role: effectiveRole, email: email.trim().toLowerCase(),
      ...(effectiveRole === 'club' ? { academy_name: academy.trim() } : { organization_id: organization || context?.academies[0]?.id }) });
  };
  const replace = () => {
    if (!replacement) return;
    const request: StaffRequest = { request_id: crypto.randomUUID(), role: replacement.role, email: replacement.email,
      ...(replacement.role === 'club' ? { academy_name: replacement.academy_name } : { organization_id: replacement.organization_id ?? undefined }) };
    setRole(request.role); setEmail(request.email); setAcademy(request.academy_name ?? ''); setOrganization(request.organization_id ?? '');
    void send(request);
  };
  const revoke = async (id: string) => {
    if (!user || locked.current) return; locked.current = true; setBusy(true); setError('');
    try { await revokeStaffInvitation(user.id, id); if (alive.current) { setNotice('Invitation revoked. Its activation link no longer works.'); await refresh(); } }
    catch (cause) { if (alive.current) setError(staffError(cause)); }
    finally { if (alive.current) { locked.current = false; setBusy(false); } }
  };
  const canInvite = context && (context.can_invite_academies || context.academies.length > 0);
  const effectiveRole = !context?.academies.length && context?.can_invite_academies ? 'club' : role;
  return <MobileShell><main className="py-10 space-y-6 text-foreground">
    <Link className="inline-flex min-h-11 items-center text-primary" to={profile ? `/${profile.role}/home` : '/'}>Back to Trak</Link>
    <h1 className="text-2xl">Staff invitations</h1>
    {authLoading ? <p role="status">Checking your account…</p> : !user ? <StaffSignIn /> : <>
      <p className="text-sm text-muted-foreground break-all">Signed in as {user.email}</p>
      {error && <div role="alert" className="space-y-2"><p className="text-destructive">{error}</p><Button variant="outline" disabled={busy} onClick={() => void refresh()}>Refresh invitations</Button></div>}
      {notice && <p role="status" className="rounded-xl border border-border bg-card p-4">{notice}</p>}
      {!context ? !error && <p role="status">Loading invitations…</p> : !canInvite ? <p>Only academy administrators and authorised Trak owners can invite staff. Ask your academy administrator for access.</p> : <>
        <form onSubmit={submit} className="space-y-4">
          <p className="text-muted-foreground">Send a personal activation link. It expires after seven days.</p>
          {context.can_invite_academies && context.academies.length > 0 && <label className="block space-y-2"><span>Staff role</span>
            <select className="h-11 w-full rounded-md border border-input bg-background px-3" value={role} disabled={!!pending || busy} onChange={e => setRole(e.target.value as 'club' | 'coach')}><option value="coach">Coach</option><option value="club">Academy administrator</option></select></label>}
          <label className="block space-y-2"><span>Recipient email</span><Input className="h-11" type="email" autoComplete="off" maxLength={254} required value={email} disabled={!!pending || busy} onChange={e => setEmail(e.target.value)} /></label>
          {effectiveRole === 'club' ? <label className="block space-y-2"><span>Academy name</span><Input className="h-11" required maxLength={200} value={academy} disabled={!!pending || busy} onChange={e => setAcademy(e.target.value)} /></label>
            : <label className="block space-y-2"><span>Academy</span><select className="h-11 w-full rounded-md border border-input bg-background px-3" value={organization || context.academies[0]?.id} disabled={!!pending || busy} onChange={e => setOrganization(e.target.value)}>{context.academies.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
          <Button type="submit" className="w-full h-11" disabled={busy}>{busy ? 'Checking request…' : pending ? 'Check or retry this request' : 'Send invitation'}</Button>
          {pending && <Button type="button" variant="outline" className="w-full h-11" disabled={busy} onClick={() => { setPending(null); setEmail(''); setAcademy(''); setNotice(''); setError(''); }}>Start a different invitation</Button>}
        </form>
        {replacement && <section className="space-y-3 rounded-xl border border-border p-4" aria-label="Confirm replacement">
          <p>Send a replacement to <strong className="break-all">{replacement.email}</strong>? The previous activation link will stop working.</p>
          <Button className="w-full h-11" disabled={busy} onClick={replace}>Send replacement invitation</Button>
          <Button variant="outline" className="w-full h-11" onClick={() => setReplacement(null)} disabled={busy}>Cancel</Button>
        </section>}
        <section className="space-y-3" aria-label="Recent invitations"><h2 className="text-lg">Recent invitations</h2>
          {context.invitations.length === 0 && <p className="text-muted-foreground">No invitations yet.</p>}
          {context.invitations.map(invite => <article key={invite.id} className="rounded-xl border border-border bg-card p-4 space-y-2">
            <p className="break-all font-medium">{invite.email}</p><p className="text-sm text-muted-foreground">{invite.academy_name} · {invite.role === 'club' ? 'Administrator' : 'Coach'}</p>
            <p className="text-sm">{invite.state === 'pending' && Date.parse(invite.expires_at) <= Date.now() ? 'Expired' : invite.state === 'pending' ? 'Awaiting activation' : invite.state === 'accepted' ? 'Activated' : 'Revoked'}</p>
            <p className="text-sm text-muted-foreground">{({ not_sent: 'Email not sent', sending: 'Email sending unconfirmed', sent: 'Email accepted for sending', failed: 'Email send failed' })[invite.delivery_state]}</p>
            {invite.state !== 'accepted' && <Button variant="outline" className="min-h-11 w-full" disabled={busy} onClick={() => setReplacement(invite)}>Replace email invitation</Button>}
            {invite.state === 'pending' && <Button variant="ghost" className="min-h-11 w-full" disabled={busy} onClick={() => void revoke(invite.id)}>Revoke invitation</Button>}
          </article>)}
        </section>
      </>}
    </>}
  </main></MobileShell>;
}
