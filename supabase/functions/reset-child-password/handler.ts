export interface ChildPasswordDependencies {
  /** Executes SQL with the caller's captured guardian JWT, never service role. */
  authorize(jwt: string, rosterChildId: string): Promise<string>;
  reset(authUserId: string, password: string): Promise<void>;
  /** TRAK-104: end every session of this child login (end_child_login_sessions, server key). */
  endSessions(authUserId: string): Promise<number>;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const reply = (status: number, body: Record<string, string>) => new Response(JSON.stringify(body), {
  status, headers: { ...cors, 'Content-Type': 'application/json' },
});

export async function handleResetChildPassword(req: Request, deps: ChildPasswordDependencies): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return reply(405, { error: 'Use POST' });
  const jwt = req.headers.get('Authorization')?.match(/^Bearer (\S+)$/i)?.[1];
  if (!jwt) return reply(401, { error: 'Sign in with your guardian account' });
  let value: unknown;
  try { value = await req.json(); } catch { return reply(400, { error: 'Invalid password request' }); }
  const body = (value && typeof value === 'object' && !Array.isArray(value) ? value : {}) as Record<string, unknown>;
  if (Object.keys(body).length !== 2 || typeof body.roster_child_id !== 'string' || !uuid.test(body.roster_child_id)
    || typeof body.password !== 'string' || body.password.length < 8 || body.password.length > 128) {
    return reply(400, { error: 'Check the child and password' });
  }
  let authUserId: string;
  try {
    authUserId = await deps.authorize(jwt, body.roster_child_id);
    if (typeof authUserId !== 'string' || !uuid.test(authUserId)) throw new Error('Invalid Auth target');
  } catch { return reply(403, { error: 'Use your linked guardian account with current approval' }); }
  try {
    await deps.reset(authUserId, body.password);
  } catch { return reply(503, { error: 'Could not set the password. Please try again.' }); }
  // TRAK-104: Auth's password update leaves existing sessions alive, so a lost
  // or shared phone stayed signed in. End them all; if that fails, the reply
  // says so (the new password stands either way, and a retry ends them).
  try {
    await deps.endSessions(authUserId);
    return reply(200, { state: 'password_updated' });
  } catch { return reply(200, { state: 'password_updated_signout_failed' }); }
}
