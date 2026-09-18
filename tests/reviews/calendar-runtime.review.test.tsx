/**
 * Opt-in desired-behavior audit; excluded from `npm test` (src only).
 * TZ=Asia/Dubai npm exec -- vitest run tests/reviews/calendar-runtime.review.test.tsx
 * Real App/router/AuthProvider/Supabase SDK; HTTP and accounts are synthetic.
 * The fixture models PR41's columns, not an applied or verified migration.
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import type { Session } from '@supabase/supabase-js'
import App from '@/App'
import { supabase } from '@/integrations/supabase/client'
import { server } from '../msw/server'
import { SUPABASE_URL } from '../msw/supabase'

const coachId = '98000000-0000-4000-8000-000000000001'
const playerId = '98000000-0000-4000-8000-000000000002'
const squadId = '98000000-0000-4000-8000-000000000003'
const NOW = '2026-09-18T08:00:00.000Z' // Noon in Dubai.
const endpoint = (table: string) => `${SUPABASE_URL}/rest/v1/${table}`
const sessions = new Map<string, Session>()

interface CalendarEvent extends Record<string, unknown> {
  id: string
  coach_user_id: string
  title: string
  event_type: string
  starts_at: string
  ends_at: string | null
  event_date: string
  start_time: string | null
  end_time: string | null
  published: boolean
}

function event(id: string, title: string, startsAt: string, date: string, time: string | null): CalendarEvent {
  return { id, coach_user_id: coachId, title, event_type: 'training', starts_at: startsAt,
    ends_at: null, event_date: date, start_time: time, end_time: null, published: true,
    source: 'manual', opponent: null, venue: null, notes: null }
}

let events: CalendarEvent[]
let reads: { query: URLSearchParams; returned: string[] }[]
let unexpected: string[]

function project(rows: Record<string, unknown>[], request: Request) {
  const columns = new URL(request.url).searchParams.get('select') ?? '*'
  const projected = columns === '*' ? rows : rows.map(row => Object.fromEntries(columns.split(',')
    .filter(key => key in row).map(key => [key, row[key]])))
  return HttpResponse.json(request.headers.get('accept')?.includes('vnd.pgrst.object') ? projected[0] : projected)
}

// Model the actual server predicate instead of always returning an event that
// starts_at >= now would exclude. Unknown query shapes fail explicitly.
function filterEvent(row: CalendarEvent, column: string, expression: string): boolean {
  const dot = expression.indexOf('.')
  const operator = expression.slice(0, dot), operand = expression.slice(dot + 1)
  if (!['coach_user_id', 'published', 'starts_at', 'event_date', 'start_time'].includes(column)) {
    throw new Error(`Unmodelled calendar column: ${column}`)
  }
  const value = row[column]
  if (operator === 'eq') return String(value) === operand
  if (operator === 'in') return operand.slice(1, -1).split(',').includes(String(value))
  if (operator === 'is' && operand === 'null') return value === null
  if (operator === 'gte') {
    if (value === null) return false
    return column === 'starts_at' ? Date.parse(String(value)) >= Date.parse(operand) : String(value) >= operand
  }
  throw new Error(`Unmodelled calendar predicate: ${column}.${expression}`)
}

async function openAs(role: 'coach' | 'player') {
  const id = role === 'coach' ? coachId : playerId
  const exp = Math.floor(Date.now() / 1000) + 3600
  const access_token = [{ alg: 'HS256', typ: 'JWT' }, { sub: id, exp, role: 'authenticated' }]
    .map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.')
    + '.' + Buffer.from('synthetic-signature').toString('base64url')
  const session: Session = {
    access_token, refresh_token: `synthetic-${id}`, token_type: 'bearer', expires_in: 3600, expires_at: exp,
    user: { id, email: `${role}@calendar.test.invalid`, email_confirmed_at: NOW, app_metadata: { provider: 'email' },
      user_metadata: {}, aud: 'authenticated', role: 'authenticated', created_at: NOW },
  }
  sessions.set(access_token, session)
  const result = await supabase.auth.setSession({ access_token, refresh_token: session.refresh_token })
  expect(result.error).toBeNull()
  window.history.replaceState({}, '', role === 'coach' ? '/coach/schedule' : '/player/home')
  render(<App />)
}

beforeEach(() => {
  // Set TZ before starting Vitest: worker-thread runtime TZ changes are not a
  // reliable substitute. Fail loudly if someone runs this in a different zone.
  expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('Asia/Dubai')
  vi.useFakeTimers({ toFake: ['Date'] }) // Network, React and waitFor timers stay real.
  vi.setSystemTime(NOW)
  vi.stubEnv('DEV', false)
  vi.spyOn(console, 'log').mockImplementation(() => {})
  sessions.clear()
  sessionStorage.clear()
  events = []
  reads = []
  unexpected = []
  server.use(
    http.get(`${SUPABASE_URL}/auth/v1/user`, ({ request }) => {
      const session = sessions.get((request.headers.get('authorization') ?? '').replace(/^Bearer /, ''))
      return session ? HttpResponse.json(session.user) : HttpResponse.json({ message: 'Unknown synthetic token' }, { status: 401 })
    }),
    http.get(endpoint('profiles'), ({ request }) => {
      const id = new URL(request.url).searchParams.get('user_id')?.slice(3)
      return project([{ id, user_id: id, role: id === coachId ? 'coach' : 'player',
        full_name: id === coachId ? 'Synthetic Coach' : 'Synthetic Player', nationality: null }], request)
    }),
    http.get(endpoint('player_details'), ({ request }) => project([{ position: 'Midfielder', current_club: 'Synthetic Academy', age_group: 'Adult' }], request)),
    http.get(endpoint('squad_players'), ({ request }) => project([{ id: squadId, coach_user_id: coachId }], request)),
    http.get(endpoint('matches'), ({ request }) => project([], request)),
    http.get(endpoint('coach_assessments'), ({ request }) => project([], request)),
    http.get(endpoint('coach_sessions'), ({ request }) => project([], request)),
    http.post(endpoint('rpc/my_consent_status'), () => HttpResponse.json({ required: false, invited_parent: null })),
    http.post(endpoint('rpc/get_player_invites_for_current_user'), () => HttpResponse.json([])),
    http.post(endpoint('telemetry_events'), () => new HttpResponse(null, { status: 201 })),
    http.get(endpoint('coach_calendar_events'), ({ request }) => {
      const query = new URL(request.url).searchParams
      try {
        let selected = events.filter(row => [...query].every(([column, expression]) =>
          ['select', 'order', 'limit'].includes(column) || filterEvent(row, column, expression)))
        const order = query.get('order') ?? 'starts_at.asc'
        if (order !== 'starts_at.asc') throw new Error(`Unmodelled calendar order: ${order}`)
        selected = selected.sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at))
        if (query.has('limit')) selected = selected.slice(0, Number(query.get('limit')))
        reads.push({ query, returned: selected.map(row => row.id) })
        return project(selected, request)
      } catch (error) {
        unexpected.push(String(error))
        return HttpResponse.json({ message: 'Calendar fixture rejected unexpected query' }, { status: 500 })
      }
    }),
    http.all('*', ({ request }) => {
      unexpected.push(`${request.method} ${request.url}`)
      return HttpResponse.json({ message: 'Unexpected external request blocked' }, { status: 500 })
    }),
  )
})

afterEach(() => {
  cleanup()
  expect(unexpected).toEqual([])
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe('calendar consumer desired-behavior audit', () => {
  it('CONTROL: the real player route displays a valid future timed event at 18:00 Dubai', async () => {
    events = [event('timed', 'Synthetic timed training', '2026-09-19T14:00:00Z', '2026-09-19', '18:00:00')]
    await openAs('player')
    const title = await screen.findByText('Synthetic timed training')
    expect(title.parentElement).toHaveTextContent(/Sat,? 19 Sept · 18:00/)
    expect(reads[reads.length - 1]?.returned).toEqual(['timed'])
  })

  it('keeps a legacy coach event on its authoritative calendar day instead of moving it to tomorrow', async () => {
    events = [
      event('control', 'Synthetic coach timed control', '2026-09-18T14:00:00Z', '2026-09-18', '18:00:00'),
      event('legacy', 'Synthetic legacy late training', '2026-09-18T21:00:00Z', '2026-09-18', '21:00:00'),
    ]
    await openAs('coach')
    const control = await screen.findByText('Synthetic coach timed control')
    expect(control.parentElement).toHaveTextContent('Training · 18:00')
    expect(screen.getByText('Friday 18 September')).toBeInTheDocument()
    expect(reads[reads.length - 1]?.returned).toEqual(['control', 'legacy'])
    const legacy = await screen.findByText('Synthetic legacy late training')
    expect(legacy.parentElement).toHaveTextContent('Training · 21:00')
  })

  it('uses the supplied legacy wall-clock time on the player card instead of reinterpreting it as an instant', async () => {
    events = [event('legacy', 'Synthetic legacy player training', '2026-09-19T18:00:00Z', '2026-09-19', '18:00:00')]
    await openAs('player')
    const title = await screen.findByText('Synthetic legacy player training')
    expect(reads[reads.length - 1]?.returned).toEqual(['legacy'])
    expect(title.parentElement).toHaveTextContent(/Sat,? 19 Sept · 18:00/)
  })

  it('keeps an untimed event upcoming throughout its calendar day and displays TBC', async () => {
    events = [
      event('untimed', 'Synthetic time to be confirmed', '2026-09-17T20:00:00Z', '2026-09-18', null),
      event('control', 'Synthetic later today control', '2026-09-18T14:00:00Z', '2026-09-18', '18:00:00'),
    ]
    await openAs('player')
    // A returned sibling rendering proves the async calendar response was
    // processed; the absent event cannot pass as an initial/loading state.
    const control = await screen.findByText('Synthetic later today control')
    expect(control.parentElement).toHaveTextContent(/Fri,? 18 Sept · 18:00/)
    expect(reads.length).toBeGreaterThan(0)
    const untimed = await screen.findByText('Synthetic time to be confirmed')
    expect(untimed.parentElement).toHaveTextContent(/Fri,? 18 Sept · TBC/)
  })
})
