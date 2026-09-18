import type { Session } from '@supabase/supabase-js';
import { supabase, SUPABASE_ANON_KEY, SUPABASE_FUNCTIONS_URL } from '@/integrations/supabase/client';
import { createOnboardingSession, type OnboardingSession } from './onboarding-session';
import { validatePassword } from './password';

export interface ParentInvitation {
  invite_id: string;
  player_user_id: string;
  player_name: string;
  parent_email: string;
  expires_at: string;
}
interface ParentAccount extends OnboardingSession {
  session: Session;
  profile: { role: string; full_name: string } | null;
}
export type ParentInvitationState =
  | { kind: 'verify-email'; email: string }
  | { kind: 'wrong-role'; email: string }
  | { kind: 'ready'; account: ParentAccount; invites: ParentInvitation[]; tokenUnavailable: boolean };

const normalizeEmail = (value: string) => value.trim().toLowerCase();
const rpc = async (account: OnboardingSession, name: string, args?: Record<string, unknown>) => {
  // Generated function types predate the secure invitation RPCs.
  const { data, error } = await account.client.rpc(name as never, args as never);
  if (error) throw error;
  return data as unknown;
};

async function getAccount(expectedUserId: string): Promise<ParentAccount> {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  if (!data.session || data.session.user.id !== expectedUserId) throw new Error('Your account changed. Please try again.');
  const account = await createOnboardingSession(data.session);
  if (!account.user.email_confirmed_at || !account.user.email) {
    return { ...account, session: data.session, profile: null };
  }
  const { data: profile, error: profileError } = await account.client.from('profiles')
    .select('role, full_name').eq('user_id', account.user.id).maybeSingle();
  if (profileError) throw profileError;
  return { ...account, session: data.session, profile };
}

async function getInvites(account: ParentAccount): Promise<ParentInvitation[]> {
  const data = await rpc(account, 'get_my_pending_parent_invites');
  if (!Array.isArray(data)) throw new Error('Could not read your invitations. Please retry.');
  return (data as ParentInvitation[]).filter(invite =>
    typeof invite.invite_id === 'string' && typeof invite.player_name === 'string'
    && typeof invite.parent_email === 'string'
    && normalizeEmail(invite.parent_email) === normalizeEmail(account.user.email ?? '')
    && Date.parse(invite.expires_at) > Date.now(),
  );
}

export async function loadParentInvitations(expectedUserId: string, token: string | null): Promise<ParentInvitationState> {
  const account = await getAccount(expectedUserId);
  const email = account.user.email ?? '';
  if (!account.user.email_confirmed_at || !email) return { kind: 'verify-email', email };
  if (account.profile && account.profile.role !== 'parent') return { kind: 'wrong-role', email };
  const invites = await getInvites(account);
  let tokenUnavailable = false;
  if (token) {
    const validToken = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(token);
    const rows = validToken ? await rpc(account, 'get_parent_invite_by_token', { p_token: token }) : [];
    tokenUnavailable = !Array.isArray(rows) || !rows.some(row => invites.some(invite => invite.invite_id === row.id));
  }
  return { kind: 'ready', account, invites, tokenUnavailable };
}

export async function completeParentInvitation(
  expectedUserId: string,
  invite: ParentInvitation,
  isCurrent: () => boolean,
  setup?: { fullName: string; password: string },
): Promise<void> {
  // Re-check at submit time: a previous request may have finished setup, or the
  // browser may now belong to another account. All writes retain this JWT.
  const account = await getAccount(expectedUserId);
  const assertCurrent = () => { if (!isCurrent()) throw new Error('Your account changed. Please try again.'); };
  assertCurrent();
  if (!account.user.email_confirmed_at || !account.user.email) throw new Error('Verify your email before accepting an invitation.');
  if (account.profile && account.profile.role !== 'parent') throw new Error('Sign in with the parent account that received the invitation.');
  if (normalizeEmail(invite.parent_email) !== normalizeEmail(account.user.email)) throw new Error('This invitation is not available for your account.');

  if (!account.profile) {
    const pending = await getInvites(account);
    assertCurrent();
    if (!pending.some(row => row.invite_id === invite.invite_id)) throw new Error('This invitation is unavailable or expired. Ask for a new invitation.');
    if (!setup || setup.fullName.trim().length < 2 || setup.fullName.trim().length > 80) throw new Error('Enter your full name (2–80 characters).');
    const passwordError = validatePassword(setup.password);
    if (passwordError) throw new Error(passwordError);
    const pendingProfile = { role: 'parent', full_name: setup.fullName.trim(), nationality: null };
    const response = await fetch(`${SUPABASE_FUNCTIONS_URL.replace(/\/functions\/v1$/, '')}/auth/v1/user`, {
      method: 'PUT',
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${account.session.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: setup.password, data: { trak_onboarding: pendingProfile } }),
    });
    if (!response.ok) throw new Error('Could not save your account details. Please retry.');
    assertCurrent();
    // Provisioning connects all active invitations for this verified address.
    await rpc(account, 'provision_my_profile', { p: pendingProfile });
    assertCurrent();
    try { await account.clearPendingProfile(); } catch { /* idempotent repair on next sign-in */ }
  }
  assertCurrent();
  // This also acknowledges a retry after provisioning already linked the child.
  await rpc(account, 'accept_parent_invite', { p_invite_id: invite.invite_id });
  assertCurrent();
}
