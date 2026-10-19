import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { PasswordInput } from '@/components/ui/password-input';
import { validatePassword } from '@/lib/password';
import { checkPasswordAccount, hasRecoveryLinkError, PasswordRecoveryProblem, saveNewPassword, type PasswordAccount } from '@/lib/password-recovery';

type Status = { kind: 'checking' } | { kind: 'ready'; account: PasswordAccount }
  | { kind: 'unavailable'; problem: PasswordRecoveryProblem };

export default function ResetPassword() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<Status>({ kind: 'checking' });
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const mounted = useRef(false);
  const generation = useRef(0);
  const currentAccount = useRef<string | null | undefined>(undefined);
  const operation = useRef<AbortController | null>(null);
  const saving = useRef(false);

  useEffect(() => {
    mounted.current = true;
    const cancelPending = () => { generation.current++; operation.current?.abort(); saving.current = false; };
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted.current) return;
      const nextId = session?.user.id ?? null;
      if (currentAccount.current !== undefined && currentAccount.current !== nextId) {
        cancelPending();
        setPassword(''); setConfirm(''); setBusy(false); setError(null);
        setStatus({ kind: 'unavailable', problem: new PasswordRecoveryProblem('changed', 'Your account changed. Check the account again before setting a password.') });
      }
      currentAccount.current = nextId;
    });
    return () => { mounted.current = false; cancelPending(); subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    const version = ++generation.current;
    const controller = new AbortController(); operation.current?.abort(); operation.current = controller;
    setStatus({ kind: 'checking' }); setError(null); setPassword(''); setConfirm('');
    const isCurrent = () => mounted.current && version === generation.current && !controller.signal.aborted;
    if (hasRecoveryLinkError(new URL(window.location.href))) {
      setStatus({ kind: 'unavailable', problem: new PasswordRecoveryProblem('session', 'This reset link could not be verified. Request a new reset link from sign in.') });
      return () => controller.abort();
    }
    void checkPasswordAccount(controller.signal).then(account => {
      if (!isCurrent()) return;
      if (currentAccount.current !== undefined && currentAccount.current !== account.id) {
        setStatus({ kind: 'unavailable', problem: new PasswordRecoveryProblem('changed', 'Your account changed. Check the account again before setting a password.') }); return;
      }
      currentAccount.current = account.id;
      setStatus({ kind: 'ready', account });
    }, cause => {
      if (isCurrent()) setStatus({ kind: 'unavailable', problem: cause instanceof PasswordRecoveryProblem ? cause
        : new PasswordRecoveryProblem('check', 'We could not check your account. Try again.') });
    });
    return () => controller.abort();
  }, [attempt]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (saving.current || status.kind !== 'ready') return;
    const invalid = validatePassword(password);
    if (invalid || password !== confirm) { setError(invalid ?? 'Passwords do not match'); return; }
    const expectedId = status.account.id;
    const version = ++generation.current;
    const controller = new AbortController(); operation.current?.abort(); operation.current = controller;
    const isCurrent = () => mounted.current && version === generation.current && currentAccount.current === expectedId && !controller.signal.aborted;
    saving.current = true; setBusy(true); setError(null);
    try {
      await saveNewPassword(expectedId, password, controller.signal, isCurrent);
      if (!isCurrent()) return;
      setPassword(''); setConfirm(''); toast.success('Password updated'); navigate('/', { replace: true });
    } catch (cause) {
      if (!isCurrent()) return;
      const problem = cause instanceof PasswordRecoveryProblem ? cause
        : new PasswordRecoveryProblem('unknown', 'We could not confirm whether your password changed. Try signing in with the new password, or retry.');
      if (problem.kind === 'session' || problem.kind === 'changed') {
        setPassword(''); setConfirm(''); setStatus({ kind: 'unavailable', problem });
      } else setError(problem.message);
    } finally { if (isCurrent()) { saving.current = false; setBusy(false); } }
  }

  const buttonClass = 'min-h-11 w-full rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary';
  return <main className="app-container flex min-h-screen flex-col items-center justify-center px-6 py-12">
    <div className="mb-10 text-center"><p className="text-5xl font-light tracking-tight text-foreground">TRAK</p><p className="mt-1 italic tracking-widest text-primary">football</p></div>
    <section className="w-full" aria-labelledby="reset-heading">
      <h1 id="reset-heading" className="mb-3 text-2xl text-foreground">Set new password</h1>
      {status.kind === 'checking' && <p role="status" className="py-6 text-sm text-muted-foreground">Checking your reset link…</p>}
      {status.kind === 'unavailable' && <>
        <p role="alert" className="mb-5 text-sm text-muted-foreground">{status.problem.message}</p>
        {['check', 'changed'].includes(status.problem.kind) && <button type="button" className={buttonClass} onClick={() => setAttempt(value => value + 1)}>Check account again</button>}
      </>}
      {status.kind === 'ready' && <>
        <p className="mb-2 text-sm text-muted-foreground">Changing the password for</p>
        <p className="mb-5 break-all font-semibold text-foreground">{status.account.email ?? 'your verified account'}</p>
        <p id="password-rules" className="mb-6 text-sm text-muted-foreground">Use 8 or more characters, including an uppercase letter, a lowercase letter, a number and a symbol.</p>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4" aria-busy={busy}>
          <div className="space-y-2 text-sm"><label htmlFor="reset-new-password">New password</label><PasswordInput id="reset-new-password" label="New password" autoComplete="new-password" aria-describedby="password-rules" required value={password} onChange={event => setPassword(event.target.value)} disabled={busy} /></div>
          <div className="space-y-2 text-sm"><label htmlFor="reset-confirm-password">Confirm password</label><PasswordInput id="reset-confirm-password" label="Confirm password" autoComplete="new-password" required value={confirm} onChange={event => setConfirm(event.target.value)} disabled={busy} /></div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <button type="submit" className={buttonClass} disabled={busy}>{busy ? 'Updating…' : 'Update password'}</button>
        </form>
      </>}
      <Link to="/" replace className="mt-5 inline-flex min-h-11 items-center text-sm font-semibold text-primary underline">Go to sign in</Link>
    </section>
  </main>;
}
