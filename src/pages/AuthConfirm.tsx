import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ConfirmationProblem, createEmailConfirmation, type ConfirmationResult } from '@/lib/email-confirmation';

type Status = { kind: 'pending' } | { kind: 'done'; result: ConfirmationResult }
  | { kind: 'error'; problem: ConfirmationProblem };

function ConfirmationAttempt({ search }: { search: string }) {
  const [operation] = useState(() => createEmailConfirmation(search));
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<Status>({ kind: 'pending' });
  useEffect(() => {
    let active = true;
    setStatus({ kind: 'pending' });
    void operation.confirm().then(result => {
      if (active) setStatus({ kind: 'done', result });
    }, error => {
      if (active) setStatus({ kind: 'error', problem: error instanceof ConfirmationProblem ? error
        : new ConfirmationProblem('We could not finish confirming your email. Try again.', true) });
    });
    // The isolated operation still cleans up if the user leaves this page.
    return () => { active = false; };
  }, [attempt, operation]);

  const actionClass = 'inline-flex min-h-11 items-center justify-center rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary';
  return <main className="app-container flex min-h-screen flex-col items-center justify-center px-6 py-12 text-center">
    {status.kind === 'pending' && <div role="status">
      <h1 className="mb-3 text-2xl text-foreground">Confirming your email…</h1>
      <p className="text-sm text-muted-foreground">One moment.</p>
    </div>}
    {status.kind === 'error' && <>
      <h1 className="mb-3 text-2xl text-foreground">Confirmation needs attention</h1>
      <p role="alert" className="mb-6 max-w-[320px] text-sm text-muted-foreground">{status.problem.message}</p>
      {status.problem.retryable && <button type="button" onClick={() => setAttempt(value => value + 1)} className={actionClass}>Try again</button>}
      <Link to="/" replace className="mt-4 inline-flex min-h-11 items-center text-sm font-semibold text-primary underline">Go to sign in</Link>
    </>}
    {status.kind === 'done' && <>
      <h1 className="mb-3 text-2xl text-foreground">{status.result === 'confirmed' ? 'Email confirmed' : 'Check your other inbox'}</h1>
      <p role="status" className="mb-6 max-w-[320px] text-sm text-muted-foreground">
        {status.result === 'confirmed' ? 'You can now continue to sign in. Choose the account you want to use.'
          : 'This confirmation step is complete. Follow the link sent to your other email address to finish changing your email.'}
      </p>
      <Link to={status.result === 'confirmed' ? '/?confirmed=1' : '/'} replace className={actionClass}>Continue to sign in</Link>
    </>}
  </main>;
}

export default function AuthConfirm() {
  const [params] = useSearchParams();
  const search = params.toString();
  // A different emailed link gets a separate operation and cannot inherit an
  // earlier verification result. Neither operation can change the app session.
  return <ConfirmationAttempt key={search} search={search} />;
}
