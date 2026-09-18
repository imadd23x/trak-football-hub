export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

interface DeliveryError { message: string; code?: string; status?: number }
interface Result<T> { data: T; error: DeliveryError | null }
export interface DeliveryInvite {
  id: string;
  invite_token: string;
  parent_email: string;
  status: string;
  expires_at: string;
  player_user_id?: string;
}
export interface DeliveryCaller { id: string; email?: string; email_confirmed_at?: string }
export interface InviteDeliveryDependencies {
  siteUrl: string;
  getCaller(jwt: string): Promise<Result<DeliveryCaller | null>>;
  getRole(jwt: string, userId: string): Promise<Result<string | null>>;
  listInvites(jwt: string): Promise<Result<DeliveryInvite[] | null>>;
  resendInvite(jwt: string, inviteId: string): Promise<Result<DeliveryInvite[] | null>>;
  sendInvite(email: string, redirectTo: string): Promise<{ error: DeliveryError | null }>;
  sendMagicLink(email: string, redirectTo: string): Promise<{ error: DeliveryError | null }>;
  now?: () => number;
}

export const json = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
});

const active = (invite: DeliveryInvite, now: number) =>
  invite.status === 'pending' && Date.parse(invite.expires_at) > now;

/** Real request flow, with external clients injected so auth/RPC/email failures
 * can be tested without a Deno runtime or sending any email. */
export async function handleInviteRequest(req: Request, deps: InviteDeliveryDependencies): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ sent: false, error: 'Use POST', reason: 'method_not_allowed' }, 405);

  try {
    const jwt = req.headers.get('Authorization')?.match(/^Bearer\s+(\S+)$/i)?.[1];
    if (!jwt) return json({ sent: false, error: 'Not authenticated' }, 401);
    const { data: caller, error: callerError } = await deps.getCaller(jwt);
    if (callerError || !caller) return json({ sent: false, error: 'Not authenticated' }, 401);
    if (!caller.email?.trim() || !caller.email_confirmed_at) {
      return json({ sent: false, error: 'Verify your email before sending an invitation', reason: 'email_unverified' }, 403);
    }
    const { data: role, error: roleError } = await deps.getRole(jwt, caller.id);
    if (roleError) return json({ sent: false, error: 'Could not verify your player account', detail: roleError.message }, 500);
    if (role !== 'player') return json({ sent: false, error: 'Only players can send parent invitations', reason: 'player_required' }, 403);

    let body: { invite_id?: string; resend?: boolean };
    try {
      const text = await req.text();
      const value: unknown = text.trim() ? JSON.parse(text) : {};
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid body');
      const input = value as Record<string, unknown>;
      if (Object.keys(input).some(key => key !== 'invite_id' && key !== 'resend') ||
          (input.invite_id !== undefined && (typeof input.invite_id !== 'string' ||
            !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.invite_id))) ||
          (input.resend !== undefined && typeof input.resend !== 'boolean') ||
          (input.resend === true && !input.invite_id)) throw new Error('Invalid body');
      body = input as typeof body;
    } catch {
      return json({ sent: false, error: 'Use an invitation ID and a boolean resend flag; resend requires an ID', reason: 'invalid_request' }, 400);
    }

    // This is a caller-authenticated RPC, never a service-role table lookup.
    // Ignore all foreign-owner rows even if a future RPC regression returns one.
    const { data: rows, error: lookupError } = await deps.listInvites(jwt);
    if (lookupError) return json({ sent: false, error: 'Could not look up the invitation', detail: lookupError.message }, 500);
    const own = (rows ?? []).filter(invite => invite.player_user_id === caller.id);
    const now = deps.now ?? Date.now;
    let invite = body.invite_id
      ? own.find(row => row.id === body.invite_id)
      : own.find(row => active(row, now()));
    if (!invite) {
      if (!body.invite_id && own.some(row => row.status === 'pending')) {
        return json({ sent: false, reason: 'invite_expired', detail: 'This invitation expired. Resend it to create a new seven-day link.' }, 409);
      }
      if (!body.invite_id && own.some(row => row.status === 'accepted')) return json({ sent: false, reason: 'already_accepted' });
      return json({ sent: false, reason: 'no_invite' }, 404);
    }
    if (invite.status === 'accepted') return json({ sent: false, reason: 'already_accepted' });
    if (invite.status !== 'pending') return json({ sent: false, reason: 'invite_unavailable' }, 409);

    if (body.resend) {
      const { data: renewed, error: resendError } = await deps.resendInvite(jwt, invite.id);
      if (resendError) return json({ sent: false, reason: 'resend_rejected', detail: resendError.message }, resendError.code === '42501' ? 403 : 500);
      const refreshed = renewed?.find(row => row.id === invite?.id);
      if (!refreshed) return json({ sent: false, reason: 'resend_rejected', detail: 'The invitation could not be renewed' }, 500);
      invite = refreshed;
      // Acceptance may have raced the initial lookup. The locked resend RPC
      // returns accepted without reopening the invitation in that case.
      if (invite.status === 'accepted') return json({ sent: false, reason: 'already_accepted' });
    }
    if (!active(invite, now())) return json({ sent: false, reason: 'invite_expired', detail: 'Resend this invitation to renew it before emailing.' }, 409);

    // Tokenless email recovery is intentional: Auth redirects may omit tokens.
    // The database matches the verified recipient email, including other children.
    const redirectTo = `${deps.siteUrl.replace(/\/+$/, '')}/parent-invite`;
    const { error: inviteError } = await deps.sendInvite(invite.parent_email, redirectTo);
    if (!inviteError) return json({ sent: true, via: 'invite', redirectTo });

    const existingAccount = inviteError.code === 'email_exists' || inviteError.code === 'user_already_exists' ||
      /already.*registered|already.*exists|already been registered/i.test(inviteError.message);
    if (!existingAccount) return json({ sent: false, reason: 'invite_rejected', detail: inviteError.message, redirectTo }, 502);

    // The first provider request may be slow. Do not start a second delivery
    // from that old snapshot after acceptance, expiry or another resend. This
    // fresh caller-scoped check cannot cancel email already dispatched, nor
    // make the database check and external provider request atomic.
    const { data: currentRows, error: currentError } = await deps.listInvites(jwt);
    if (currentError) return json({ sent: false, reason: 'invite_lookup_failed', detail: currentError.message }, 500);
    const current = currentRows?.find(row => row.id === invite.id && row.player_user_id === caller.id);
    if (!current) return json({ sent: false, reason: 'no_invite' }, 404);
    if (current.status === 'accepted') return json({ sent: false, reason: 'already_accepted' });
    if (current.status !== 'pending') return json({ sent: false, reason: 'invite_unavailable' }, 409);
    if (!active(current, now())) return json({ sent: false, reason: 'invite_expired', detail: 'Resend this invitation to renew it before emailing.' }, 409);
    if (current.invite_token !== invite.invite_token || current.parent_email !== invite.parent_email ||
        Date.parse(current.expires_at) !== Date.parse(invite.expires_at)) {
      return json({ sent: false, reason: 'invite_changed', detail: 'The invitation changed while sending. Refresh its status before retrying.' }, 409);
    }

    const { error: magicError } = await deps.sendMagicLink(current.parent_email, redirectTo);
    if (magicError) return json({ sent: false, reason: 'magic_link_rejected', detail: magicError.message, redirectTo }, 502);
    return json({ sent: true, via: 'magic_link', reason: 'already_registered', redirectTo });
  } catch (error) {
    return json({ sent: false, error: 'Could not send the email', detail: error instanceof Error ? error.message : String(error) }, 500);
  }
}
