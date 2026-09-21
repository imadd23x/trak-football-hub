import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { PASSWORD_HINT } from '@/lib/password';
import { completeParentInvitation, loadParentInvitations, type ParentInvitation, type ParentInvitationState } from '@/lib/parent-invites';

const messageOf = (error: unknown) => error instanceof Error ? error.message
  : (error as { message?: string })?.message || 'Please try again.';

export default function ParentOnboarding() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const navigate = useNavigate();
  const { user, loading: authLoading, refreshProfile, signIn, signOut } = useAuth();
  const userId = user?.id;
  const identity = `${userId ?? 'signed-out'}:${token ?? ''}`;
  const active = useRef(identity);
  active.current = identity;
  const mounted = useRef(false);
  const [resolution, setResolution] = useState<{ identity: string; value: ParentInvitationState } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [switchingAccount, setSwitchingAccount] = useState(false);
  const [email, setEmail] = useState('');
  const [newAccount, setNewAccount] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [signInMethod, setSignInMethod] = useState<'email' | 'password'>('email');
  const [signInPassword, setSignInPassword] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    setName(''); setPassword(''); setConfirmPassword(''); setEmail(''); setEmailSent(false); setSubmitting(false);
    setSignInPassword(''); setSignInMethod('email'); setNewAccount(false); setSwitchingAccount(false);
  }, [identity]);
  useEffect(() => {
    let cancelled = false;
    setResolution(null); setLoadError(null);
    if (!userId || authLoading) return;
    void loadParentInvitations(userId, token).then(value => {
      if (!cancelled) setResolution({ identity, value });
    }).catch(error => { if (!cancelled) setLoadError(messageOf(error)); });
    return () => { cancelled = true; };
  }, [userId, token, identity, authLoading, retry]);

  const state = resolution?.identity === identity ? resolution.value : null;
  const isCurrent = () => mounted.current && active.current === identity;
  const retryButton = <Button variant="outline" onClick={() => setRetry(value => value + 1)}>Retry</Button>;
  const switchAccount = <Button variant="outline" disabled={submitting || switchingAccount} onClick={() => {
    setSwitchingAccount(true);
    // AuthProvider keeps this public route open after a confirmed sign-out.
    // A failure leaves the current account here; it must not reveal a sign-in
    // form while that account is still authenticated on a shared device.
    void signOut().catch(error => {
      if (isCurrent()) toast.error(`Could not sign out. ${messageOf(error)}`);
    }).finally(() => { if (isCurrent()) setSwitchingAccount(false); });
  }}>{switchingAccount ? 'Signing out...' : 'Sign out to use another account'}</Button>;

  const requestSignIn = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    try {
      if (signInMethod === 'password') {
        const { error } = await signIn(email.trim(), signInPassword);
        if (error) throw error;
        return; // The authenticated account is resolved on this same route.
      }
      const redirect = new URL('/parent-invite', window.location.origin);
      if (token) redirect.searchParams.set('token', token);
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: { emailRedirectTo: redirect.toString(), shouldCreateUser: newAccount },
      });
      if (error) throw error;
      if (isCurrent()) setEmailSent(true);
    } catch (error) {
      if (isCurrent()) toast.error(`${signInMethod === 'password' ? 'Could not sign in.' : 'Could not send the sign-in link.'} ${messageOf(error)}`);
    }
    finally { if (isCurrent()) setSubmitting(false); }
  };

  const accept = async (invite: ParentInvitation, setup = false) => {
    if (!user || submitting || switchingAccount) return;
    if (setup && password !== confirmPassword) { toast.error('Passwords do not match'); return; }
    setSubmitting(true);
    try {
      await completeParentInvitation(user.id, invite, isCurrent, setup ? { fullName: name, password } : undefined);
      if (!isCurrent()) return;
      await refreshProfile();
      if (!isCurrent()) return;
      toast.success('Invitation accepted');
      navigate('/parent/consent', { replace: true });
    } catch (error) { if (isCurrent()) toast.error(messageOf(error)); }
    finally { if (isCurrent()) setSubmitting(false); }
  };

  return <div className="app-container px-6 py-8 min-h-screen">
    <h1 className="text-2xl text-foreground mb-4">Parent invitation</h1>
    {authLoading ? <p role="status">Loading...</p> : !user ? <>
      <p className="text-muted-foreground text-sm mb-6">Verify the email address that received your parent invitation to continue.</p>
      {emailSent ? <div role="status" className="space-y-4">
        <p>Check your inbox for a sign-in link. Open it on this device to continue.</p>
        <Button variant="outline" onClick={() => setEmailSent(false)}>Try another email</Button>
      </div> : <form onSubmit={requestSignIn} className="space-y-4">
        <label className="block text-sm">Your email address
          <Input type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} required className="mt-2" />
        </label>
        {signInMethod === 'password' ? <div className="block text-sm"><label htmlFor="parent-sign-in-password">Password</label>
          <PasswordInput id="parent-sign-in-password" label="Password" autoComplete="current-password" value={signInPassword} onChange={event => setSignInPassword(event.target.value)} required className="mt-2" />
        </div> : <label className="flex gap-3 items-center text-sm">
          <input type="checkbox" checked={newAccount} onChange={event => setNewAccount(event.target.checked)} />
          Create a new parent account
        </label>}
        <Button type="submit" disabled={submitting}>{signInMethod === 'password'
          ? submitting ? 'Signing in...' : 'Sign in'
          : submitting ? 'Sending...' : 'Send sign-in link'}</Button>
        <Button type="button" variant="outline" disabled={submitting} onClick={() => {
          setSignInMethod(method => method === 'email' ? 'password' : 'email');
          setSignInPassword(''); setNewAccount(false);
        }}>{signInMethod === 'email' ? 'Sign in with password' : 'Use an email sign-in link'}</Button>
      </form>}
    </> : loadError ? <div role="alert" className="space-y-4">
      <p>Could not load your invitations. {loadError}</p>{retryButton}{switchAccount}
    </div> : !state ? <p role="status">Loading...</p>
      : state.kind === 'wrong-role' ? <div role="alert" className="space-y-4">
        <p>This account is not a parent account. Sign in with the email address that received the invitation.</p>
        <p className="text-sm text-muted-foreground">Signed in as {state.email}</p>{switchAccount}
      </div> : state.kind === 'verify-email' ? <div className="space-y-4">
        <p>Verify your email before continuing. Open the verification or sign-in link in your inbox, then retry.</p>
        {retryButton}{switchAccount}
      </div> : <>
        <p className="text-sm text-muted-foreground mb-4">Signed in as {state.account.user.email}</p>
        {state.tokenUnavailable && <div className="mb-4 space-y-3">
          <p role="status" className="text-sm text-muted-foreground">This link is no longer active or is not available for this account. Any other active invitations for your email are listed below.</p>
          {state.invites.length > 0 && switchAccount}
        </div>}
        {!state.invites.length ? <div className="space-y-4">
          <h2 className="text-lg">No active invitations</h2>
          <p className="text-sm text-muted-foreground">The invitation may already be accepted or have expired. Ask the player to resend it, or sign in with the email that received it.</p>
          {state.account.profile?.role === 'parent' && <Button onClick={() => navigate('/parent/home', { replace: true })}>Go to parent home</Button>}
          {retryButton}{switchAccount}
        </div> : state.account.profile ? <div className="space-y-4">
          <p className="text-sm text-muted-foreground">Choose the child to connect to your parent account.</p>
          {state.invites.map(invite => <div key={invite.invite_id} className="rounded-lg border border-border p-4">
            <p className="text-foreground mb-3">{invite.player_name}</p>
            <Button disabled={submitting || switchingAccount} onClick={() => { void accept(invite); }}>Link {invite.player_name}</Button>
          </div>)}
        </div> : <form onSubmit={event => { event.preventDefault(); void accept(state.invites[0], true); }} className="space-y-4">
          <p className="text-sm text-muted-foreground">Set up your parent account to connect {state.invites.map(invite => invite.player_name).join(', ')}. This connects all active invitations sent to your verified email.</p>
          <Input aria-label="Full name" placeholder="Full name" autoComplete="name" value={name} onChange={event => setName(event.target.value)} required minLength={2} maxLength={80} />
          <PasswordInput label="New password" placeholder={PASSWORD_HINT} autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} required />
          <PasswordInput label="Confirm password" placeholder="Confirm password" autoComplete="new-password" value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} required />
          <Button type="submit" disabled={submitting || switchingAccount}>{submitting ? 'Saving...' : 'Set up parent account'}</Button>
        </form>}
      </>}
  </div>;
}
