import { MobileShell } from '@/components/trak/MobileShell';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import { StaffSignIn } from '@/components/staff/StaffSignIn';
import { activateStaff, loadStaffActivation, staffError, type StaffActivation } from '@/lib/staff-invites';
import { PASSWORD_HINT } from '@/lib/password';

export default function StaffActivationPage() {
  const { user } = useAuth(); const [params] = useSearchParams(); const token = params.get('token') ?? '';
  return <StaffActivation key={`${user?.id ?? 'anonymous'}:${token}`} token={token} newAccount={params.get('flow') === 'new'} />;
}
function StaffActivation({ token, newAccount }: { token: string; newAccount: boolean }) {
  const { user, profile, loading, signOut, refreshProfile } = useAuth(); const navigate = useNavigate();
  const userId = user?.id;
  const [invitation, setInvitation] = useState<StaffActivation | null>(null); const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0); const [busy, setBusy] = useState(false);
  const [name, setName] = useState(profile?.full_name ?? ''); const [password, setPassword] = useState(''); const [confirmation, setConfirmation] = useState('');
  const [activated, setActivated] = useState<'coach' | 'club' | null>(null);
  const alive = useRef(true); const locked = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    let cancelled = false; setInvitation(null); setError('');
    if (!userId || loading || token.length !== 72) return;
    void loadStaffActivation(userId, token).then(result => { if (!cancelled) setInvitation(result); })
      .catch(cause => { if (!cancelled) setError(staffError(cause)); });
    return () => { cancelled = true; };
  }, [userId, loading, token, attempt]);
  useEffect(() => { if (activated && profile?.role === activated) navigate(`/${activated}/home`, { replace: true }); }, [activated, profile?.role, navigate]);
  const needsPassword = newAccount && !profile && invitation?.state === 'pending';
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (!user || locked.current) return;
    if (needsPassword && password !== confirmation) { setError('Passwords do not match.'); return; }
    locked.current = true; setBusy(true); setError('');
    try {
      const result = await activateStaff(user.id, token, profile?.full_name || name, () => alive.current, needsPassword ? password : undefined);
      if (!alive.current) return; setActivated(result.role); setPassword(''); setConfirmation(''); await refreshProfile();
    } catch (cause) { if (alive.current) setError(staffError(cause)); }
    finally { if (alive.current) { locked.current = false; setBusy(false); } }
  };
  const switchAccount = async () => {
    if (locked.current) return; locked.current = true; setBusy(true);
    try { const result = await signOut(); if (result.error) throw result.error; }
    catch (cause) { if (alive.current) setError(staffError(cause)); }
    finally { if (alive.current) { locked.current = false; setBusy(false); } }
  };
  return <MobileShell><main className="py-12 space-y-6 text-foreground">
    <Link to="/" className="text-primary inline-flex min-h-11 items-center">Trak Football</Link>
    <h1 className="text-2xl">Activate your staff account</h1>
    {token.length !== 72 ? <p role="alert">This invitation link is incomplete. Open the link in your email or ask for a replacement.</p>
      : loading ? <p role="status">Checking your account…</p> : !user ? <StaffSignIn /> : <>
        <p className="text-sm text-muted-foreground break-all">Signed in as {user.email}</p>
        {error && <div role="alert" className="space-y-3"><p className="text-destructive">{error}</p><Button variant="outline" onClick={() => setAttempt(value => value + 1)} disabled={busy}>Retry invitation</Button></div>}
        {activated ? <div className="space-y-3"><p role="status">Your academy access is activated. Loading your account…</p><Button onClick={() => void refreshProfile()}>Refresh account</Button></div>
          : invitation ? <form onSubmit={submit} className="space-y-4">
            <p>Join <strong>{invitation.academy_name}</strong> as {invitation.role === 'club' ? 'an academy administrator' : 'a coach'}.</p>
            <label className="block space-y-2"><span>Full name</span><Input className="h-11" autoComplete="name" maxLength={200} required readOnly={!!profile} value={profile?.full_name ?? name} onChange={e => setName(e.target.value)} disabled={busy} /></label>
            {needsPassword && <>
              <label className="block space-y-2"><span>New password</span><PasswordInput label="New password" autoComplete="new-password" required value={password} onChange={e => setPassword(e.target.value)} disabled={busy} /></label>
              <p className="text-sm text-muted-foreground">{PASSWORD_HINT}</p>
              <label className="block space-y-2"><span>Confirm password</span><PasswordInput label="Confirm password" autoComplete="new-password" required value={confirmation} onChange={e => setConfirmation(e.target.value)} disabled={busy} /></label>
            </>}
            <Button type="submit" className="w-full h-11" disabled={busy}>{busy ? 'Activating…' : invitation.state === 'accepted' ? 'Continue to your academy' : 'Activate access'}</Button>
          </form> : !error && <p role="status">Checking the invitation…</p>}
        <Button variant="outline" className="w-full h-11" disabled={busy} onClick={() => void switchAccount()}>Sign out to use another account</Button>
      </>}
  </main></MobileShell>;
}
