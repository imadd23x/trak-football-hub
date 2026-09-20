import { corsHeaders, json } from '../send-parent-invite/handler.ts';

export interface StaffDeliveryError { message: string; code?: string; status?: number }
export interface StaffResult<T = unknown> { data: T; error: StaffDeliveryError | null }
export interface StaffInviteRequest {
  request_id: string;
  role: 'club' | 'coach';
  email: string;
  organization_id?: string;
  academy_name?: string;
}
export interface StaffDeliveryDependencies {
  siteUrl: string;
  getCaller(jwt: string): Promise<StaffResult<{ id: string; email?: string; email_confirmed_at?: string } | null>>;
  issue(jwt: string, request: StaffInviteRequest): Promise<StaffResult>;
  status(jwt: string, invitationId: string): Promise<StaffResult>;
  finish(invitationId: string, attemptId: string, outcome: 'sent' | 'failed'): Promise<{ error: StaffDeliveryError | null }>;
  sendInvite(email: string, redirectTo: string): Promise<{ error: StaffDeliveryError | null }>;
  sendMagicLink(email: string, redirectTo: string): Promise<{ error: StaffDeliveryError | null }>;
  now?: () => number;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid server response');
  return value as Record<string, unknown>;
};
const requiredString = (row: Record<string, unknown>, key: string): string => {
  if (typeof row[key] !== 'string' || !row[key]) throw new Error('Invalid server response');
  return row[key];
};
const unavailable = () => json({ sent: false, reason: 'invitation_unavailable', message: 'This invitation is unavailable. Refresh its status.' }, 409);
const uncertain = (invitationId?: string) => json({ sent: false, reason: 'delivery_unconfirmed', invitation_id: invitationId,
  message: 'Sending could not be confirmed. Check the invitation status before choosing to send a replacement.' }, 202);
const rejected = (error: StaffDeliveryError) => {
  if (error.code === '42501') return json({ sent: false, reason: 'not_authorized', message: 'You cannot send this invitation.' }, 403);
  if (error.code === '22023') return json({ sent: false, reason: 'invalid_request', message: 'Check the invitation details and try again.' }, 400);
  if (error.code === 'P0001' && error.message === 'Staff email limit reached') return json({ sent: false, reason: 'rate_limited',
    message: 'Please wait before sending another invitation. The daily allowance is 50 emails.' }, 429);
  return json({ sent: false, reason: 'request_failed', message: 'Could not prepare the invitation. Retry the same request to check its status.' }, 503);
};
function parseRequest(value: unknown): StaffInviteRequest {
  const data = record(value);
  if (Object.keys(data).some(key => !['request_id', 'role', 'email', 'organization_id', 'academy_name'].includes(key))
    || typeof data.request_id !== 'string' || !uuid.test(data.request_id)
    || (data.role !== 'coach' && data.role !== 'club') || typeof data.email !== 'string'
    || data.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email.trim())
    || (data.role === 'coach' && (typeof data.organization_id !== 'string' || !uuid.test(data.organization_id) || data.academy_name !== undefined))
    || (data.role === 'club' && (data.organization_id !== undefined || typeof data.academy_name !== 'string'
      || !data.academy_name.trim() || data.academy_name.trim().length > 200))) throw new Error('Invalid request');
  return { request_id: data.request_id, role: data.role, email: data.email.trim().toLowerCase(),
    ...(data.role === 'coach' ? { organization_id: data.organization_id as string } : { academy_name: (data.academy_name as string).trim() }) };
}

/** Retries check persisted status; only the first claim may contact Auth mail. */
export async function handleStaffInviteRequest(req: Request, deps: StaffDeliveryDependencies): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ sent: false, reason: 'method_not_allowed' }, 405);
  const jwt = req.headers.get('Authorization')?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!jwt) return json({ sent: false, reason: 'not_authenticated' }, 401);
  let invitationId: string | undefined;
  let dispatchStarted = false;
  try {
    const origin = new URL(deps.siteUrl);
    if ((origin.protocol !== 'https:' && !(origin.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(origin.hostname)))
      || origin.username || origin.password) throw new Error('Invalid site configuration');
    const { data: caller, error: authError } = await deps.getCaller(jwt);
    if (authError || !caller) return json({ sent: false, reason: 'not_authenticated' }, 401);
    if (!caller.email || !caller.email_confirmed_at) return json({ sent: false, reason: 'verify_email', message: 'Verify your email first.' }, 403);
    let request: StaffInviteRequest;
    try {
      const text = await req.text();
      if (text.length > 4096) throw new Error('Request too large');
      request = parseRequest(JSON.parse(text));
    } catch { return json({ sent: false, reason: 'invalid_request', message: 'Check the invitation details and try again.' }, 400); }
    const issued = await deps.issue(jwt, request);
    if (issued.error) return rejected(issued.error);
    const invite = record(issued.data);
    invitationId = requiredString(invite, 'invitation_id');
    if (!uuid.test(invitationId)) throw new Error('Invalid invitation ID');
    if (invite.replayed === true) {
      const result = await deps.status(jwt, invitationId);
      if (result.error) return rejected(result.error);
      const status = record(result.data);
      if (status.state !== 'pending' || !(Date.parse(requiredString(status, 'expires_at')) > (deps.now ?? Date.now)())) return unavailable();
      if (status.delivery_state === 'sent') return json({ sent: true, invitation_id: invitationId, replayed: true, message: 'The email provider accepted this invitation for sending.' });
      if (status.delivery_state === 'sending') return uncertain(invitationId);
      return json({ sent: false, invitation_id: invitationId, reason: 'replacement_required',
        message: 'This request cannot send another email. Send a replacement invitation to try again.' }, 409);
    }
    if (invite.replayed !== false) throw new Error('Invalid issuance response');
    const token = requiredString(invite, 'token');
    if (token.length !== 72) throw new Error('Invalid invitation token');
    const claim = invite;
    if (claim.dispatch === false) return uncertain(invitationId);
    if (claim.dispatch !== true) throw new Error('Invalid claim');
    const attemptId = requiredString(claim, 'attempt_id');
    const email = requiredString(claim, 'email');
    if (!uuid.test(attemptId) || email !== request.email || claim.role !== request.role
      || !(Date.parse(requiredString(claim, 'expires_at')) > (deps.now ?? Date.now)())) throw new Error('Invalid delivery scope');
    const redirect = (flow: 'new' | 'existing') => {
      const url = new URL('/staff-invite', origin.origin);
      url.searchParams.set('token', token); url.searchParams.set('flow', flow);
      return url.toString();
    };
    dispatchStarted = true;
    let result = await deps.sendInvite(email, redirect('new'));
    if (result.error?.code === 'email_exists' || result.error?.code === 'user_already_exists'
      || (result.error && /already.*registered|already.*exists/i.test(result.error.message))) {
      const current = await deps.status(jwt, invitationId);
      if (current.error) return rejected(current.error);
      const status = record(current.data);
      if (status.state !== 'pending' || status.delivery_state !== 'sending' || status.attempt_id !== attemptId
        || !(Date.parse(requiredString(status, 'expires_at')) > (deps.now ?? Date.now)())) return unavailable();
      result = await deps.sendMagicLink(email, redirect('existing'));
    }
    const finished = await deps.finish(invitationId, attemptId, result.error ? 'failed' : 'sent');
    if (finished.error) return uncertain(invitationId);
    if (result.error) return json({ sent: false, invitation_id: invitationId, reason: 'email_rejected',
      message: 'The email provider rejected this send. Check the address before sending a replacement invitation.' }, 502);
    return json({ sent: true, invitation_id: invitationId, replayed: false, message: 'The email provider accepted the invitation for sending.' });
  } catch {
    // A network exception after dispatch may mean the provider sent the email.
    // Never mark it failed or automatically send again from an uncertain result.
    return dispatchStarted ? uncertain(invitationId) : json({ sent: false, invitation_id: invitationId,
      reason: 'request_failed', message: 'Could not confirm this request. Retry it to check its status.' }, 503);
  }
}
