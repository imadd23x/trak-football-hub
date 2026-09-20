import { z } from 'zod';
import { supabase, SUPABASE_ANON_KEY, SUPABASE_FUNCTIONS_URL } from '@/integrations/supabase/client';
import { createOnboardingSession } from './onboarding-session';
import { validatePassword } from './password';

const role = z.enum(['coach', 'club']);
const timestamp = z.string().refine(value => Number.isFinite(Date.parse(value)));
const invitation = z.object({
  id: z.string().uuid(), role, email: z.string().email(), organization_id: z.string().uuid().nullable(), academy_name: z.string(),
  state: z.enum(['pending', 'accepted', 'revoked']), expires_at: timestamp, created_at: timestamp,
  delivery_state: z.enum(['not_sent', 'sending', 'sent', 'failed']),
});
const contextSchema = z.object({ can_invite_academies: z.boolean(), academies: z.array(z.object({ id: z.string().uuid(), name: z.string() })), invitations: z.array(invitation) });
const activationSchema = z.object({ role, academy_name: z.string(), state: z.enum(['pending', 'accepted']), expires_at: timestamp });
export type StaffContext = z.infer<typeof contextSchema>;
export type StaffInvitation = z.infer<typeof invitation>;
export interface StaffRequest { request_id: string; role: 'coach' | 'club'; email: string; organization_id?: string; academy_name?: string }
export interface StaffSendResult { sent: boolean; reason?: string; message: string; invitation_id?: string }
const outcomeSchema = z.object({ sent: z.boolean(), reason: z.string().optional(), message: z.string().optional(), invitation_id: z.string().uuid().optional() });

export function staffError(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error && error.code === '42501') {
    return 'This invitation is unavailable for your account. Check the signed-in email, or ask for a new invitation.';
  }
  if (error instanceof z.ZodError) return 'The invitation response was incomplete. Please retry.';
  return error instanceof Error ? error.message : 'Could not complete this request. Please retry.';
}
async function account(expectedId: string) {
  const result = await supabase.auth.getSession();
  if (result.error) throw result.error;
  const session = result.data.session;
  if (!session || session.user.id !== expectedId) throw new Error('Your account changed. Please try again.');
  const current = await createOnboardingSession(session);
  if (!current.user.email || !current.user.email_confirmed_at) throw new Error('Verify your email before continuing.');
  return { ...current, session };
}
export async function loadStaffContext(expectedId: string): Promise<StaffContext> {
  const current = await account(expectedId);
  const result = await current.client.rpc('staff_invitation_context');
  if (result.error) throw result.error;
  return contextSchema.parse(result.data);
}
export async function loadStaffActivation(expectedId: string, token: string) {
  const current = await account(expectedId);
  const result = await current.client.rpc('inspect_staff_invite', { p_token: token });
  if (result.error) throw result.error;
  return activationSchema.parse(result.data);
}
export type StaffActivation = Awaited<ReturnType<typeof loadStaffActivation>>;

export async function activateStaff(expectedId: string, token: string, fullName: string, isCurrent: () => boolean, password?: string) {
  const assertCurrent = () => { if (!isCurrent()) throw new Error('Your account changed. Please try again.'); };
  const current = await account(expectedId); assertCurrent();
  const inspected = await current.client.rpc('inspect_staff_invite', { p_token: token });
  if (inspected.error) throw inspected.error;
  activationSchema.parse(inspected.data); assertCurrent();
  if (!fullName.trim() || fullName.trim().length > 200) throw new Error('Enter your full name (up to 200 characters).');
  if (password !== undefined) {
    const existing = await current.client.from('profiles').select('role').eq('user_id', expectedId).maybeSingle();
    if (existing.error) throw existing.error; assertCurrent();
    // An existing profile never needs a password change to accept another invite.
    if (!existing.data) {
      const invalid = validatePassword(password); if (invalid) throw new Error(invalid);
      const response = await fetch(`${SUPABASE_FUNCTIONS_URL.replace(/\/functions\/v1$/, '')}/auth/v1/user`, {
        method: 'PUT', headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${current.session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (!response.ok) throw new Error('Could not save your password. Your academy activation has not completed. Please retry.');
      assertCurrent();
    }
  }
  const result = await current.client.rpc('accept_staff_invite', { p_token: token, p_full_name: fullName.trim() });
  if (result.error) throw result.error; assertCurrent();
  return z.object({ role, organization_id: z.string().uuid(), replayed: z.boolean() }).parse(result.data);
}
export async function sendStaffInvitation(expectedId: string, request: StaffRequest): Promise<StaffSendResult> {
  const current = await account(expectedId);
  const result = await current.client.functions.invoke('send-staff-invite', { body: request });
  let body: unknown = result.data;
  if (result.error && !body) {
    const response = (result.error as { context?: unknown }).context;
    if (response instanceof Response) { try { body = await response.json(); } catch { /* handled below */ } }
  }
  const parsed = outcomeSchema.safeParse(body);
  if (!parsed.success) throw new Error('The send result is unknown. Retry this same request to check its status.');
  return { ...parsed.data, message: parsed.data.message ?? 'Sending was not confirmed. Refresh the invitation status.' };
}
export async function revokeStaffInvitation(expectedId: string, invitationId: string): Promise<void> {
  const current = await account(expectedId);
  const { error } = await current.client.rpc('revoke_staff_invite', { p_invitation_id: invitationId });
  if (error) throw error;
}
