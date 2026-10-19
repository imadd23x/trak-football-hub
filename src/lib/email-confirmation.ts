import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ANON_KEY, SUPABASE_FUNCTIONS_URL } from '@/integrations/supabase/client';

type ConfirmationType = 'signup' | 'email' | 'email_change';
export type ConfirmationResult = 'confirmed' | 'other-email';
export class ConfirmationProblem extends Error {
  constructor(message: string, readonly retryable: boolean) { super(message); }
}
let nextOperation = 0;

function confirmationInput(search: string): { token_hash: string; type: ConfirmationType } {
  const params = new URLSearchParams(search);
  const token = params.get('token_hash')?.trim();
  const type = params.get('type') ?? 'signup';
  if (!token || params.getAll('token_hash').length !== 1 || params.getAll('type').length > 1
    || !['signup', 'email', 'email_change'].includes(type)) {
    throw new ConfirmationProblem('This confirmation link is incomplete or is for a different action. Open the confirmation email again.', false);
  }
  return { token_hash: token, type: type as ConfirmationType };
}

function verificationProblem(error: unknown): ConfirmationProblem {
  const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : null;
  const message = error instanceof Error ? error.message : '';
  if (code === 'otp_expired' || /expired|already been used/i.test(message)) {
    return new ConfirmationProblem('This confirmation link has expired or has already been used. If you confirmed earlier, go to sign in. Otherwise request a new confirmation link.', false);
  }
  return new ConfirmationProblem('We could not finish checking this confirmation link. Try again. If the link was already confirmed, go to sign in.', true);
}

/** One email-link operation; never reads, persists or replaces the app session. */
export function createEmailConfirmation(search: string) {
  let client: SupabaseClient | undefined;
  let verified = false;
  let needsCleanup = false;
  let result: ConfirmationResult | undefined;
  let pending: Promise<ConfirmationResult> | undefined;
  let controller: AbortController | undefined;

  async function run(): Promise<ConfirmationResult> {
    if (result) return result;
    const input = confirmationInput(search);
    controller = new AbortController();
    // Covers response-body parsing and cleanup, not just receipt of headers.
    const timeout = setTimeout(() => controller?.abort(), 20_000);
    try {
      client ??= createClient(SUPABASE_FUNCTIONS_URL.replace(/\/functions\/v1$/, ''), SUPABASE_ANON_KEY, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false,
          storageKey: `trak-email-confirmation-${++nextOperation}` },
        global: { fetch: (input, init) => fetch(input, { ...init, signal: controller?.signal }) },
      });
      if (!verified) {
        try {
          await client.auth.initialize();
          // The SDK installs a visibility listener even when refresh is off.
          // This short-lived operation must not leave a browser listener behind.
          await client.auth.stopAutoRefresh();
          const { data, error } = await client.auth.verifyOtp(input);
          if (error) throw error;
          // Secure email changes may require a second email before Auth returns
          // a user/session. Do not turn that first-step acknowledgement into success.
          if (!data.user?.id && !data.session) {
            if (input.type === 'email_change') return result = 'other-email';
            throw new Error('Confirmation response did not identify a user.');
          }
          verified = true;
          needsCleanup = !!data.session;
        } catch (error) { throw verificationProblem(error); }
      }
      if (needsCleanup) {
        try {
          const { error } = await client.auth.signOut({ scope: 'local' });
          if (error) throw error;
          needsCleanup = false;
        } catch {
          throw new ConfirmationProblem('Your email is confirmed. We could not complete the final step. Try again to continue.', true);
        }
      }
      return result = 'confirmed';
    } finally { clearTimeout(timeout); }
  }

  return {
    confirm(): Promise<ConfirmationResult> {
      // StrictMode and rapid retries must share the one-use verification.
      pending ??= run().finally(() => { pending = undefined; });
      return pending;
    },
  };
}
