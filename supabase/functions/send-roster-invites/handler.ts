// TRAK-11 phase 3 (J2/J3): the two roster invitations. The operator, holding
// the service key, invites a roster child's guardians (the loader calls this
// after each admission). A guardian, with their own session, has the child
// invited once they have consented. Who may be emailed is decided in SQL by
// roster_invite_targets(); this file authenticates, delivers, records and
// reports. Responses and logs carry no email addresses.
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

export const json = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
});

interface DeliveryError { message: string; code?: string; status?: number }
interface Result<T> { data: T; error: DeliveryError | null }
export interface RosterInviteTarget { kind: 'guardian' | 'child'; email: string; first_name: string | null; academy: string | null }
export interface RosterInviteCaller { id: string; email?: string; email_confirmed_at?: string }
export interface RosterInviteDependencies {
  siteUrl: string;
  /** Every value of SUPABASE_SECRET_KEYS: the operator's key is one of them. */
  secretKeys: string[];
  getCaller(jwt: string): Promise<Result<RosterInviteCaller | null>>;
  /** onlyUninvited (operator only, TRAK-91): leave out targets already invited. */
  getTargets(rosterChildId: string, guardianId: string | null, onlyUninvited: boolean): Promise<Result<RosterInviteTarget[] | null>>;
  markSent(rosterChildId: string, target: RosterInviteTarget): Promise<{ error: DeliveryError | null }>;
  sendInvite(email: string, redirectTo: string, data: Record<string, string | null>): Promise<{ error: DeliveryError | null }>;
  /** TRAK-118: data is this child's, for the Magic Link template to name, as the invitation does. */
  sendMagicLink(email: string, redirectTo: string, data: Record<string, string | null>): Promise<{ error: DeliveryError | null }>;
  /** TRAK-97: has this guardian address had an invitation for another of their roster children within the window? */
  recentGuardianInvite(rosterChildId: string, email: string): Promise<Result<boolean>>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Constant-time comparison, so the service key can't be guessed byte by byte. */
export function sameSecret(a: string, b: string): boolean {
  if (!a || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** The key values of SUPABASE_SECRET_KEYS / SUPABASE_PUBLISHABLE_KEYS, a JSON object keyed by name. */
export function keyValues(raw: string | undefined): string[] {
  try {
    const keys: unknown = JSON.parse(raw ?? '');
    if (!keys || typeof keys !== 'object' || Array.isArray(keys)) return [];
    return Object.values(keys).filter((k): k is string => typeof k === 'string' && k.length > 0);
  } catch {
    return [];
  }
}

// TRAK-97 (1 Oct TRAK-24 run): Supabase keeps one pending token per user, so a
// second /invite to the same guardian (the loader sends one per child) kills
// the first email's link: 403 "One-time token not found". So while another of
// this guardian's roster rows was invited within a link's lifetime, this
// child's row is marked invited and no second email goes: the guardian's
// consent screen lists every child. One hour is Supabase's default email link
// lifetime. A deliberate resend after that, for an expired link, still goes.
export const GUARDIAN_INVITE_WINDOW_MS = 60 * 60 * 1000;

/** True when a roster row of another child, for this guardian address, was invited within windowMs of now. */
export function invitedElsewhereWithin(
  rows: { roster_child_id: string; invited_at: string | null }[], rosterChildId: string, now: number, windowMs: number,
): boolean {
  return rows.some(row => {
    if (row.roster_child_id === rosterChildId || !row.invited_at) return false;
    const at = Date.parse(row.invited_at);
    return Number.isFinite(at) && at >= now - windowMs;
  });
}

const alreadyRegistered = (e: DeliveryError) => e.code === 'email_exists' || e.code === 'user_already_exists' ||
  /already.*registered|already.*exists|already been registered/i.test(e.message);

export async function handleRosterInviteRequest(req: Request, deps: RosterInviteDependencies): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ sent: 0, error: 'Use POST', reason: 'method_not_allowed' }, 405);

  try {
    // TRAK-9 (30 Sep TRAK-24 run): the operator sends a secret key on the
    // apikey header, the way Supabase's new keys are meant to be used; the
    // byte match against the legacy SUPABASE_SERVICE_ROLE_KEY refused the real
    // key and sent nothing. The gateway can't verify secret keys, so
    // verify_jwt is off for this function and everyone else must bring a user
    // session on Authorization, which Auth verifies in getCaller.
    const apikey = req.headers.get('apikey')?.trim() ?? '';
    const isOperator = apikey.length > 0 && deps.secretKeys.some(key => sameSecret(apikey, key));
    let guardianId: string | null = null;
    if (!isOperator) {
      const token = req.headers.get('Authorization')?.match(/^Bearer\s+(\S+)$/i)?.[1];
      if (!token) return json({ sent: 0, error: 'Not authenticated' }, 401);
      const { data: caller, error } = await deps.getCaller(token);
      if (error || !caller) return json({ sent: 0, error: 'Not authenticated' }, 401);
      if (!caller.email?.trim() || !caller.email_confirmed_at) {
        return json({ sent: 0, error: 'Verify your email first', reason: 'email_unverified' }, 403);
      }
      guardianId = caller.id;
    }

    // TRAK-91: the operator may add only_uninvited: true (load-roster
    // --reinvite), so a guardian who already has an invitation isn't sent
    // another. A guardian's own call stays { roster_child_id } only.
    let rosterChildId: string;
    let onlyUninvited = false;
    try {
      const body: unknown = JSON.parse(await req.text());
      const keys = body && typeof body === 'object' && !Array.isArray(body) ? Object.keys(body) : [];
      const { roster_child_id: id, only_uninvited: only } = (body ?? {}) as { roster_child_id?: unknown; only_uninvited?: unknown };
      const allowed = isOperator ? ['roster_child_id', 'only_uninvited'] : ['roster_child_id'];
      if (!keys.includes('roster_child_id') || keys.some(k => !allowed.includes(k))
        || typeof id !== 'string' || !UUID.test(id) || (only !== undefined && typeof only !== 'boolean')) throw new Error('Invalid body');
      rosterChildId = id;
      onlyUninvited = only === true;
    } catch {
      return json({ sent: 0, error: 'Send { roster_child_id } only', reason: 'invalid_request' }, 400);
    }

    const { data: targets, error: targetError } = await deps.getTargets(rosterChildId, guardianId, onlyUninvited);
    if (targetError) {
      if (targetError.code === '42501') return json({ sent: 0, reason: targetError.message }, 403);
      if (targetError.code === 'P0002') return json({ sent: 0, reason: 'no_roster_child' }, 404);
      return json({ sent: 0, error: 'Could not look up the roster' }, 500);
    }
    if (!targets?.length) return json({ sent: 0, failed: 0, results: [], reason: 'nothing_to_send' });

    const site = deps.siteUrl.replace(/\/+$/, '');
    const results: Record<string, unknown>[] = [];
    for (const target of targets) {
      const role = target.kind === 'child' ? 'player' : 'parent';
      const redirectTo = `${site}/onboarding/${role}`;
      if (target.kind === 'guardian') {
        const pending = await deps.recentGuardianInvite(rosterChildId, target.email);
        // Unsure whether a fresh link exists: send nothing rather than risk killing it.
        if (pending.error) { results.push({ kind: target.kind, sent: false, reason: 'delivery_failed' }); continue; }
        if (pending.data) {
          await deps.markSent(rosterChildId, target);
          results.push({ kind: target.kind, sent: false, reason: 'guardian_invite_pending' });
          continue;
        }
      }
      let via: 'invite' | 'magic_link' | null = 'invite';
      const data = { invited_as: role, child_first_name: target.first_name, academy_name: target.academy };
      const { error: inviteError } = await deps.sendInvite(target.email, redirectTo, data);
      if (inviteError) {
        via = alreadyRegistered(inviteError) && !(await deps.sendMagicLink(target.email, redirectTo, data)).error ? 'magic_link' : null;
      }
      if (!via) { results.push({ kind: target.kind, sent: false, reason: 'delivery_failed' }); continue; }
      // The email went; a failed count is not worth failing the delivery over.
      await deps.markSent(rosterChildId, target);
      results.push({ kind: target.kind, sent: true, via });
    }
    const sent = results.filter(r => r.sent).length;
    // A guardian with a fresh invitation (TRAK-97) is neither sent nor failed.
    const failed = results.filter(r => !r.sent && r.reason !== 'guardian_invite_pending').length;
    return json({ sent, failed, results }, failed ? 502 : 200);
  } catch {
    return json({ sent: 0, error: 'Could not send the invitations' }, 500);
  }
}
