/**
 * Opt-in desired-behavior audit of PR42 46518d7; no application replacements.
 * TZ=Asia/Dubai npm exec -- vitest run tests/reviews/player-followup.review.test.tsx
 * Real App/AuthProvider/Router/Supabase SDK, synthetic intercepted HTTP only.
 */
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import type { Session } from '@supabase/supabase-js'
import App from '@/App'
import { supabase } from '@/integrations/supabase/client'
import { localParts, normalizeInstant, toInstant } from '@/lib/event-time'
import { server } from '../msw/server'
import { SUPABASE_URL } from '../msw/supabase'

const playerId = '99000000-0000-4000-8000-000000000001'
const coachId = '99000000-0000-4000-8000-000000000002'
const endpoint = (table: string) => `${SUPABASE_URL}/rest/v1/${table}`
const FAILURE = 'SYNTHETIC_SIBLING_FAILURE'
const sessions = new Map<string, Session>()

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}

let matchesGate: ReturnType<typeof deferred>
let siblingGate: ReturnType<typeof deferred>
let failSibling: 'player_details' | 'coach_calendar_events' | null
let failureBodiesRead: number
let matchesRequested: boolean
let unexpected: string[]

function project(rows: Record<string, unknown>[], request: Request) {
  const columns = new URL(request.url).searchParams.get('select') ?? '*'
  const selected = columns === '*' ? rows : rows.map(row => Object.fromEntries(columns.split(',')
    .filter(key => key in row).map(key => [key, row[key]])))
  return HttpResponse.json(request.headers.get('accept')?.includes('vnd.pgrst.object') ? selected[0] : selected)
}

async function openPlayer() {
  const exp = Math.floor(Date.now() / 1000) + 3600
  const access_token = [{ alg: 'HS256', typ: 'JWT' }, { sub: playerId, exp, role: 'authenticated' }]
    .map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.')
    + '.' + Buffer.from('synthetic-signature').toString('base64url')
  const session: Session = {
    access_token, refresh_token: 'synthetic-player-refresh', token_type: 'bearer', expires_in: 3600, expires_at: exp,
    user: { id: playerId, email: 'player@followup.test.invalid', email_confirmed_at: '2026-09-01T00:00:00Z',
      app_metadata: { provider: 'email' }, user_metadata: {}, aud: 'authenticated', role: 'authenticated', created_at: '2026-09-01T00:00:00Z' },
  }
  sessions.set(access_token, session)
  const result = await supabase.auth.setSession({ access_token, refresh_token: session.refresh_token })
  expect(result.error).toBeNull()
  window.history.replaceState({}, '', '/player/home')
  render(<App />)
}

describe('PlayerHome sibling error ordering', () => {
  beforeEach(() => {
    vi.stubEnv('DEV', false)
    sessionStorage.clear()
    sessions.clear()
    matchesGate = deferred()
    siblingGate = deferred()
    failSibling = null
    failureBodiesRead = 0
    matchesRequested = false
    unexpected = []
    // Observe the real SDK consuming the failure body. This calls the original
    // Response.text unchanged; it does not replace a query or its result.
    const originalText = Response.prototype.text
    vi.spyOn(Response.prototype, 'text').mockImplementation(async function (this: Response) {
      const text = await originalText.call(this)
      if (text.includes(FAILURE)) failureBodiesRead++
      return text
    })
    server.use(
      http.get(`${SUPABASE_URL}/auth/v1/user`, ({ request }) => {
        const session = sessions.get((request.headers.get('authorization') ?? '').replace(/^Bearer /, ''))
        return session ? HttpResponse.json(session.user) : HttpResponse.json({ message: 'Unknown synthetic token' }, { status: 401 })
      }),
      http.get(endpoint('profiles'), ({ request }) => project([{ id: playerId, user_id: playerId,
        role: 'player', full_name: 'Synthetic Player', nationality: null }], request)),
      http.get(endpoint('matches'), async ({ request }) => {
        matchesRequested = true
        await matchesGate.promise
        return project([{ id: 'synthetic-match', opponent: 'Synthetic Opponent', competition: 'Friendly',
          created_at: '2026-09-18T08:00:00Z', match_date: '2026-09-17', computed_rating: 8,
          team_score: 2, opponent_score: 1, goals: 1, assists: 0 }], request)
      }),
      http.get(endpoint('player_details'), async ({ request }) => {
        await siblingGate.promise
        return failSibling === 'player_details'
          ? HttpResponse.json({ code: '42501', message: FAILURE }, { status: 403 })
          : project([{ position: 'Midfielder', current_club: 'Synthetic Academy', age_group: 'Adult' }], request)
      }),
      http.get(endpoint('squad_players'), ({ request }) => project([{ id: 'synthetic-squad', coach_user_id: coachId }], request)),
      http.get(endpoint('coach_assessments'), ({ request }) => project([], request)),
      http.get(endpoint('coach_calendar_events'), async ({ request }) => {
        await siblingGate.promise
        const params = new URL(request.url).searchParams
        const filter = /^\(event_date\.gte\.(\d{4}-\d{2}-\d{2}),and\(event_date\.is\.null,starts_at\.gte\.([^)]+)\)\)$/.exec(params.get('or') ?? '')
        expect(filter, 'real PR42 calendar-day/fallback filter').not.toBeNull()
        expect(params.get('order')).toBe('event_date.asc.nullslast,starts_at.asc')
        expect(params.get('limit')).toBe('5')
        const eventDate = new Date(Date.now() + 86400000).toLocaleDateString('en-CA')
        const events = [{ id: 'synthetic-event', title: 'Synthetic upcoming training', event_type: 'training',
          event_date: eventDate, start_time: '18:00:00', starts_at: toInstant(eventDate, '18:00')!, published: true }]
        // Apply the observed date branch rather than returning rows that the
        // real query would exclude. All fixtures here have the new columns.
        const visible = events.filter(event => event.event_date >= filter![1]).slice(0, 5)
        return failSibling === 'coach_calendar_events'
          ? HttpResponse.json({ code: '42501', message: FAILURE }, { status: 403 })
          : project(visible, request)
      }),
      http.post(endpoint('rpc/my_consent_status'), () => HttpResponse.json({ required: false, invited_parent: null })),
      http.post(endpoint('rpc/get_player_invites_for_current_user'), () => HttpResponse.json([])),
      http.post(endpoint('telemetry_events'), () => new HttpResponse(null, { status: 201 })),
      http.all('*', ({ request }) => {
        unexpected.push(`${request.method} ${request.url}`)
        return HttpResponse.json({ message: 'Unexpected request blocked' }, { status: 500 })
      }),
    )
  })

  afterEach(() => {
    cleanup()
    matchesGate.resolve()
    siblingGate.resolve()
    expect(unexpected).toEqual([])
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it('CONTROL: successful matches and siblings render the real Home without an error', async () => {
    matchesGate.resolve()
    siblingGate.resolve()
    await openPlayer()
    expect(await screen.findByText('Synthetic Player')).toBeInTheDocument()
    expect(await screen.findByText('Midfielder')).toBeInTheDocument()
    expect(await screen.findByText('Synthetic upcoming training')).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: /vs Synthetic Opponent/ })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(failureBodiesRead).toBe(0)
  })

  it('CONTROL: a sibling failure that arrives after matches succeeds is visible', async () => {
    failSibling = 'player_details'
    matchesGate.resolve()
    await openPlayer()
    expect(await screen.findByText('Synthetic Player')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    await act(async () => { siblingGate.resolve(); await siblingGate.promise })
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't connect")
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })

  it.each(['player_details', 'coach_calendar_events'] as const)(
    'retains an earlier %s failure when the slower matches request succeeds', async table => {
      failSibling = table
      siblingGate.resolve()
      await openPlayer()
      await waitFor(() => expect(matchesRequested).toBe(true))
      await waitFor(() => expect(failureBodiesRead).toBeGreaterThan(0))
      // Cross one task boundary after SDK body consumption so its promise and
      // React state updates settle before releasing the held matches request.
      await act(async () => { await new Promise<void>(resolve => setTimeout(resolve, 0)) })
      await act(async () => { matchesGate.resolve(); await matchesGate.promise })
      expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't connect")
      expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
    },
  )
})

describe('normalizeInstant whitespace and malformed input contract', () => {
  it('CONTROL: single-space and offset input preserve time, while an invalid time is rejected', () => {
    expect(localParts(normalizeInstant('2026-03-01 18:00:00')!)).toEqual({ date: '2026-03-01', time: '18:00' })
    expect(normalizeInstant('2026-03-01T18:00:00+04')).toBe('2026-03-01T14:00:00.000Z')
    expect(normalizeInstant('2026-03-01Tbanana')).toBeNull()
  })

  it('either rejects repeated whitespace or preserves its explicit 18:00, never guesses midnight', () => {
    const parsed = normalizeInstant('2026-03-01  18:00:00')
    // Both strict rejection and supported whitespace are safe contracts.
    // A fabricated time is not: the existing function returns local midnight.
    expect([null, toInstant('2026-03-01', '18:00')]).toContain(parsed)
  })

  it.each(['2026-03-01 18:00:00 garbage', '2026-03-01T18:00:00garbage'])(
    'rejects trailing non-date content rather than truncating it: %s', value => {
      expect(normalizeInstant(value)).toBeNull()
    },
  )
})
