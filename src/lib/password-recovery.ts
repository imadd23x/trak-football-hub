import { supabase, SUPABASE_ANON_KEY, SUPABASE_FUNCTIONS_URL } from '@/integrations/supabase/client';
import { validatePassword } from './password';

export interface PasswordAccount { id: string; email: string | null }
type ProblemKind = 'session' | 'changed' | 'check' | 'rejected' | 'unknown';
export class PasswordRecoveryProblem extends Error {
  constructor(readonly kind: ProblemKind, message: string) { super(message); }
}
const userUrl = `${SUPABASE_FUNCTIONS_URL.replace(/\/functions\/v1$/, '')}/auth/v1/user`;
const sessionProblem = () => new PasswordRecoveryProblem('session', 'This reset link is missing or no longer available. Sign in again or request a new reset link.');
const changedProblem = () => new PasswordRecoveryProblem('changed', 'Your account changed. Check the account again before setting a password.');
const checkProblem = () => new PasswordRecoveryProblem('check', 'We could not check your account. Check your connection and try again.');
const unknownProblem = () => new PasswordRecoveryProblem('unknown', 'We could not confirm whether your password changed. Try signing in with the new password, or retry here.');

export function hasRecoveryLinkError(url: URL): boolean {
  const fragment = new URLSearchParams(url.hash.slice(1));
  return ['error', 'error_code', 'error_description'].some(key => url.searchParams.has(key) || fragment.has(key));
}

async function bounded<T>(outer: AbortSignal, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  outer.addEventListener('abort', abort, { once: true });
  if (outer.aborted) abort();
  const timer = setTimeout(abort, 20_000);
  try { return await run(controller.signal); }
  finally { clearTimeout(timer); outer.removeEventListener('abort', abort); }
}

// getSession has no AbortSignal parameter. Stop waiting on cancellation while
// still handling a late resolution/rejection; never proceed to a write from it.
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new DOMException('Request cancelled', 'AbortError'));
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    void promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}
const assertActive = (signal: AbortSignal) => { if (signal.aborted) throw new DOMException('Request cancelled', 'AbortError'); };
const headers = (accessToken: string) => ({ apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' });
function responseAccount(value: unknown): PasswordAccount | null {
  if (!value || typeof value !== 'object' || !('id' in value) || typeof value.id !== 'string') return null;
  return { id: value.id, email: 'email' in value && typeof value.email === 'string' ? value.email : null };
}
async function verifiedAccount(signal: AbortSignal, expectedId?: string) {
  const { data, error } = await abortable(supabase.auth.getSession(), signal);
  if (error) throw checkProblem();
  const session = data.session;
  if (!session) throw sessionProblem();
  if (expectedId && session.user.id !== expectedId) throw changedProblem();
  assertActive(signal);
  // Use the captured JWT for both verification and the eventual write, as in
  // the existing staff activation path. The SDK's shared updateUser method can
  // otherwise acquire a different browser session while awaiting its lock.
  const response = await fetch(userUrl, { headers: headers(session.access_token), signal });
  if (response.status === 401 || response.status === 403) throw sessionProblem();
  if (!response.ok) throw checkProblem();
  const account = responseAccount(await response.json());
  if (!account || account.id !== session.user.id) throw checkProblem();
  assertActive(signal);
  return { account, accessToken: session.access_token };
}

export async function checkPasswordAccount(signal: AbortSignal): Promise<PasswordAccount> {
  try { return await bounded(signal, async current => (await verifiedAccount(current)).account); }
  catch (error) { throw error instanceof PasswordRecoveryProblem ? error : checkProblem(); }
}

export async function saveNewPassword(expectedId: string, password: string, signal: AbortSignal, isCurrent: () => boolean): Promise<void> {
  const invalid = validatePassword(password);
  if (invalid) throw new PasswordRecoveryProblem('rejected', invalid);
  let sent = false;
  try {
    await bounded(signal, async current => {
      const { account, accessToken } = await verifiedAccount(current, expectedId);
      if (!isCurrent() || account.id !== expectedId) throw changedProblem();
      assertActive(current); sent = true;
      const response = await fetch(userUrl, { method: 'PUT', headers: headers(accessToken),
        body: JSON.stringify({ password }), signal: current });
      if (response.status >= 500) throw unknownProblem();
      const body: unknown = await response.json();
      const code = body && typeof body === 'object' && 'code' in body ? body.code : null;
      if (response.status === 401 || response.status === 403 || code === 'reauthentication_needed' || code === 'reauthentication_not_valid') throw sessionProblem();
      if (!response.ok) {
        if (response.status === 429) throw new PasswordRecoveryProblem('rejected', 'Too many attempts. Wait a moment, then try again.');
        if (code === 'same_password') throw new PasswordRecoveryProblem('rejected', 'This password is already set. You can sign in with it or choose a different password.');
        throw new PasswordRecoveryProblem('rejected', 'The password was not accepted. Try a different password, or request a new reset link.');
      }
      if (responseAccount(body)?.id !== expectedId) throw unknownProblem();
    });
  } catch (error) {
    throw error instanceof PasswordRecoveryProblem ? error : sent ? unknownProblem() : checkProblem();
  }
}
