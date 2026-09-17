import { http, HttpResponse, type HttpHandler } from 'msw'

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

/** trackEvent() calls supabase.auth.getUser(), which is a real network call. */
export function authHandlers(): HttpHandler[] {
  return [
    http.get(`${SUPABASE_URL}/auth/v1/user`, () =>
      HttpResponse.json({ id: 'test-user', aud: 'authenticated' }),
    ),
    http.post(`${SUPABASE_URL}/auth/v1/token`, () =>
      HttpResponse.json({ error: 'not_implemented' }, { status: 400 }),
    ),
    http.post(`${SUPABASE_URL}/rest/v1/telemetry_events`, () =>
      new HttpResponse(null, { status: 201 }),
    ),
  ]
}
