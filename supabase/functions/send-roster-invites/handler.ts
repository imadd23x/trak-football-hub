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
  serviceRoleKey: string;
  getCaller(jwt: string): Promise<Result<RosterInviteCaller | null>>;
  getTargets(rosterChildId: string, guardianId: string | null): Promise<Result<RosterInviteTarget[] | null>>;
  markSent(rosterChildId: string, target: RosterInviteTarget): Promise<{ error: DeliveryError | null }>;
  sendInvite(email: string, redirectTo: string, data: Record<string, string | null>): Promise<{ error: DeliveryError | null }>;
  sendMagicLink(email: string, redirectTo: string): Promise<{ error: DeliveryError | null }>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Constant-time comparison, so the service key can't be guessed byte by byte. */
export function sameSecret(a: string, b: string): boolean {
  if (!a || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const alreadyRegistered = (e: DeliveryError) => e.code === 'email_exists' || e.code === 'user_already_exists' ||
  /already.*registered|already.*exists|already been registered/i.test(e.message);

export async function handleRosterInviteRequest(req: Request, deps: RosterInviteDependencies): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ sent: 0, error: 'Use POST', reason: 'method_not_allowed' }, 405);

  try {
    const token = req.headers.get('Authorization')?.match(/^Bearer\s+(\S+)$/i)?.[1];
    if (!token) return json({ sent: 0, error: 'Not authenticated' }, 401);

    // The operator holds the service key; anyone else must be a verified guardian.
    let guardianId: string | null = null;
    if (!sameSecret(token, deps.serviceRoleKey)) {
      const { data: caller, error } = await deps.getCaller(token);
      if (error || !caller) return json({ sent: 0, error: 'Not authenticated' }, 401);
      if (!caller.email?.trim() || !caller.email_confirmed_at) {
        return json({ sent: 0, error: 'Verify your email first', reason: 'email_unverified' }, 403);
      }
      guardianId = caller.id;
    }

    let rosterChildId: string;
    try {
      const body: unknown = JSON.parse(await req.text());
      const keys = body && typeof body === 'object' && !Array.isArray(body) ? Object.keys(body) : [];
      const id = (body as { roster_child_id?: unknown })?.roster_child_id;
      if (keys.length !== 1 || typeof id !== 'string' || !UUID.test(id)) throw new Error('Invalid body');
      rosterChildId = id;
    } catch {
      return json({ sent: 0, error: 'Send { roster_child_id } only', reason: 'invalid_request' }, 400);
    }

    const { data: targets, error: targetError } = await deps.getTargets(rosterChildId, guardianId);
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
      let via: 'invite' | 'magic_link' | null = 'invite';
      const { error: inviteError } = await deps.sendInvite(target.email, redirectTo,
        { invited_as: role, child_first_name: target.first_name, academy_name: target.academy });
      if (inviteError) {
        via = alreadyRegistered(inviteError) && !(await deps.sendMagicLink(target.email, redirectTo)).error ? 'magic_link' : null;
      }
      if (!via) { results.push({ kind: target.kind, sent: false, reason: 'delivery_failed' }); continue; }
      // The email went; a failed count is not worth failing the delivery over.
      await deps.markSent(rosterChildId, target);
      results.push({ kind: target.kind, sent: true, via });
    }
    const sent = results.filter(r => r.sent).length;
    const failed = results.length - sent;
    return json({ sent, failed, results }, failed ? 502 : 200);
  } catch {
    return json({ sent: 0, error: 'Could not send the invitations' }, 500);
  }
}
