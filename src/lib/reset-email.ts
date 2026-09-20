import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { SUPABASE_ANON_KEY, SUPABASE_FUNCTIONS_URL } from '@/integrations/supabase/client';

export type ResetEmailRecipient = (isActive: () => boolean, signal: AbortSignal) => string | Promise<string>;
export const RESET_EMAIL_ACKNOWLEDGEMENT = 'If this email is registered, check your inbox and spam folder for a reset link.';
class ResetEmailProblem extends Error {}
const emailSchema = z.string().trim().email().max(254);
let nextRequest = 0;

/** Bound recipient verification and request acknowledgement to one UI operation. */
export async function requestResetEmail(recipient: ResetEmailRecipient, outer: AbortSignal): Promise<void> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  outer.addEventListener('abort', abort, { once: true });
  const isActive = () => !outer.aborted && !controller.signal.aborted;
  const assertActive = () => { if (!isActive()) throw new DOMException('Request cancelled', 'AbortError'); };
  let sent = false;
  let rejectCancelled!: (reason: Error) => void;
  const cancelled = new Promise<never>((_resolve, reject) => { rejectCancelled = reject; });
  const onAbort = () => rejectCancelled(new DOMException('Request cancelled', 'AbortError'));
  controller.signal.addEventListener('abort', onAbort, { once: true });
  if (outer.aborted) abort();
  const timer = setTimeout(abort, 20_000);
  try {
    await Promise.race([cancelled, (async () => {
      assertActive();
      const parsed = emailSchema.safeParse(await recipient(isActive, controller.signal));
      assertActive();
      if (!parsed.success) throw new ResetEmailProblem('Enter a valid email address first.');
      // Recovery requests do not need an authenticated session. A temporary
      // SDK client avoids shared-session locks/storage and makes fetch abortable.
      const client = createClient(SUPABASE_FUNCTIONS_URL.replace(/\/functions\/v1$/, ''), SUPABASE_ANON_KEY, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false,
          storageKey: `trak-reset-email-${++nextRequest}` },
        global: { fetch: (input, init) => { assertActive(); sent = true; return fetch(input, { ...init, signal: controller.signal }); } },
      });
      await client.auth.initialize();
      // This SDK installs a visibility listener even with auto-refresh off.
      await client.auth.stopAutoRefresh();
      assertActive();
      const { error } = await client.auth.resetPasswordForEmail(parsed.data, { redirectTo: `${window.location.origin}/reset-password` });
      assertActive();
      if (error) {
        if (error.status === 429) throw new ResetEmailProblem('Too many requests. Wait a little before trying again.');
        // Keep the same acknowledgement if a provider explicitly hides or
        // reports a missing account; never reveal membership from this control.
        if (error.code === 'user_not_found' || error.code === 'email_not_found') return;
        if (!error.status || error.status >= 500) throw error;
        throw new ResetEmailProblem('The reset request was not accepted. Check the email address and try again.');
      }
    })()]);
  } catch (error) {
    if (error instanceof ResetEmailProblem) throw error;
    throw new ResetEmailProblem(sent
      ? 'We could not confirm the reset request. Check your inbox and spam folder before trying again.'
      : 'We could not check your account. Check your connection and try again.');
  } finally {
    clearTimeout(timer); outer.removeEventListener('abort', abort); controller.signal.removeEventListener('abort', onAbort);
  }
}
