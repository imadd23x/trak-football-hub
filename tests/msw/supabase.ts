import { http, HttpResponse, type HttpHandler } from 'msw'
import { authUserForToken } from './auth-sessions'

export const SUPABASE_URL = 'https://test.supabase.co'

const SINGLE_OBJECT_ACCEPT = 'application/vnd.pgrst.object+json'

/**
 * PostgREST returns a bare object (not an array) when the client sends the
 * pgrst.object Accept header, and a 406/PGRST116 when it asks for one object
 * and the result set isn't exactly one row.
 *
 * In the pinned supabase-js / postgrest-js version, only `.single()` sends
 * that Accept header; `.maybeSingle()` fetches a plain list and unwraps (or
 * errors on) cardinality client-side instead. So this handler's bare-object
 * and 406/PGRST116 branches are exercised by `.single()` callers, while
 * `.maybeSingle()` callers always hit the plain-array branch. Reproducing
 * PostgREST's actual response shapes exactly — rather than hand-rolling a
 * fake client — is the whole reason MSW was chosen: an empty result and a
 * permission failure must not render identically in the app.
 */
function respond(rows: Record<string, unknown>[], accept: string) {
  if (!accept.includes(SINGLE_OBJECT_ACCEPT)) return HttpResponse.json(rows)
  if (rows.length !== 1) {
    return HttpResponse.json(
      {
        code: 'PGRST116',
        details: `Results contain ${rows.length} rows`,
        hint: null,
        message: 'JSON object requested, multiple (or no) rows returned',
      },
      { status: 406 },
    )
  }
  return HttpResponse.json(rows[0])
}

export function table(name: string, rows: Record<string, unknown>[]): HttpHandler {
  return http.get(`${SUPABASE_URL}/rest/v1/${name}`, ({ request }) =>
    respond(rows, request.headers.get('Accept') ?? ''),
  )
}

export function tableError(name: string, status: number, body: object): HttpHandler {
  return http.get(`${SUPABASE_URL}/rest/v1/${name}`, () =>
    HttpResponse.json(body, { status }),
  )
}

export function insertInto(
  name: string,
  makeRow: (body: Record<string, unknown>) => Record<string, unknown>,
): HttpHandler {
  return http.post(`${SUPABASE_URL}/rest/v1/${name}`, async ({ request }) => {
    const raw = await request.json()
    const body = (Array.isArray(raw) ? raw[0] : raw) as Record<string, unknown>
    const row = makeRow(body)
    const accept = request.headers.get('Accept') ?? ''
    const prefer = request.headers.get('Prefer') ?? ''
    if (!prefer.includes('return=representation')) {
      return new HttpResponse(null, { status: 201 })
    }
    return respond([row], accept)
  })
}

/** Auth hydration and telemetry verify the exact bearer token through Auth. */
export function authHandlers(): HttpHandler[] {
  return [
    http.get(`${SUPABASE_URL}/auth/v1/user`, ({ request }) => {
      const token = (request.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
      const user = authUserForToken(token)
      return user ? HttpResponse.json(user)
        : HttpResponse.json({ message: 'Unknown synthetic token' }, { status: 401 })
    }),
    http.post(`${SUPABASE_URL}/auth/v1/token`, () =>
      HttpResponse.json({ error: 'not_implemented' }, { status: 400 }),
    ),
    http.post(`${SUPABASE_URL}/rest/v1/telemetry_events`, () =>
      new HttpResponse(null, { status: 201 }),
    ),
  ]
}

/**
 * A SECURITY DEFINER function called through PostgREST. `reply` receives the
 * posted arguments and returns either the function's result, or an error the
 * way Postgres raises one — `{ status, body }` — so a RAISE EXCEPTION can be
 * reproduced rather than approximated.
 */
export function rpc(
  name: string,
  reply: (args: Record<string, unknown>) => unknown | { status: number; body: object },
): HttpHandler {
  return http.post(`${SUPABASE_URL}/rest/v1/rpc/${name}`, async ({ request }) => {
    const args = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const out = reply(args) as { status?: number; body?: object }
    if (out && typeof out === 'object' && 'status' in out && 'body' in out) {
      return HttpResponse.json(out.body as object, { status: out.status as number })
    }
    return HttpResponse.json(out ?? null)
  })
}
