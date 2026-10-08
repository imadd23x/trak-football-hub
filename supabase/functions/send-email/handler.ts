// TRAK-126 (J8.3): one plain email through Trak's own sender, for the
// operator only (a secret key on apikey, as for send-roster-invites). It proves
// the deployed sender (the J8.3 test sends) and lets the operator send one
// message; J8.12 and J8.13 call sendPlainEmail() from their own functions.
// No browser calls this, so there are no CORS headers. Responses carry no addresses.
import { emailProblem, type PlainEmail, type SendResult } from '../_shared/send-email.ts';
import { sameSecret } from '../send-roster-invites/handler.ts';

export interface SendEmailDependencies {
  /** Every value of SUPABASE_SECRET_KEYS: the operator's key is one of them. */
  secretKeys: string[];
  send(message: PlainEmail): Promise<SendResult>;
}

const json = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
});

export async function handleSendEmailRequest(req: Request, deps: SendEmailDependencies): Promise<Response> {
  if (req.method !== 'POST') return json({ sent: false, reason: 'method_not_allowed' }, 405);
  const apikey = req.headers.get('apikey')?.trim() ?? '';
  if (!apikey || !deps.secretKeys.some(key => sameSecret(apikey, key))) return json({ sent: false, error: 'Not authenticated' }, 401);

  let message: PlainEmail;
  try {
    const body: unknown = JSON.parse(await req.text());
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Invalid body');
    const keys = Object.keys(body).sort().join(',');
    if (keys !== 'subject,text,to') throw new Error('Invalid body');
    message = body as PlainEmail;
  } catch {
    return json({ sent: false, error: 'Send { to, subject, text } only', reason: 'invalid_request' }, 400);
  }
  const problem = emailProblem(message);
  if (problem) return json({ sent: false, error: problem, reason: 'invalid_email' }, 400);

  const result = await deps.send(message);
  if (result.sent) return json({ sent: true, id: result.id });
  if (result.reason === 'not_configured') return json({ sent: false, error: 'Email is not configured yet', reason: result.reason }, 500);
  return json({ sent: false, reason: result.reason, status: result.status ?? null }, 502);
}
