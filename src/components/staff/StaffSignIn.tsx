import { useLocation } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useState, type FormEvent } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import { staffError } from '@/lib/staff-invites';

export function StaffSignIn() {
  const { signIn } = useAuth(); const location = useLocation();
  const [notice, setNotice] = useState('');
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (busy) return; setBusy(true); setError('');
    try { const result = await signIn(email.trim(), password); if (result.error) throw result.error; }
    catch (cause) { setError(staffError(cause)); } finally { setBusy(false); }
  };
  const emailLink = async () => {
    if (busy) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setError('Enter your email address first.'); return; }
    setBusy(true); setError(''); setNotice('');
    try {
      const redirect = new URL(location.pathname + location.search, window.location.origin);
      const result = await supabase.auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: false, emailRedirectTo: redirect.toString() } });
      if (result.error) throw result.error;
      setNotice('If this account can sign in by email, a link has been requested. Check your inbox.');
    } catch (cause) { setError(staffError(cause)); } finally { setBusy(false); }
  };
  return <form onSubmit={submit} className="space-y-4">
    <p className="text-muted-foreground">Open the activation link in your email, or sign in with the account that received it.</p>
    <label className="block space-y-2"><span>Email</span><Input className="h-11" type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} disabled={busy} /></label>
    <label className="block space-y-2"><span>Password</span><PasswordInput label="Password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} disabled={busy} /></label>
    {notice && <p role="status" className="text-muted-foreground">{notice}</p>}
    {error && <p role="alert" className="text-destructive">{error}</p>}
    <Button type="submit" className="h-11 w-full" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</Button>
    <Button type="button" variant="outline" className="h-11 w-full" disabled={busy} onClick={() => void emailLink()}>Email me a sign-in link</Button>
  </form>;
}
