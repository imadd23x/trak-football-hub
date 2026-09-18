/**
 * Opt-in desired-behavior audit for PR40, separate from `npm test` (src only).
 * Run: npm exec -- vitest run tests/reviews/feedback-ui.review.test.tsx
 * Actual App/router/AuthProvider/Supabase SDK; synthetic HTTP only. These mocks
 * verify UI requests and lifecycle, not SQL authorization or provider output.
 */
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import type { Session } from '@supabase/supabase-js'
import App from '@/App'
import { supabase } from '@/integrations/supabase/client'
import { server } from '../msw/server'
import { SUPABASE_URL } from '../msw/supabase'

const coachA = '91000000-0000-4000-8000-000000000001'
const coachB = '91000000-0000-4000-8000-000000000002'
const player = '91000000-0000-4000-8000-000000000003'
const assessmentA = '91000000-0000-4000-8000-000000000011'
const assessmentB = '91000000-0000-4000-8000-000000000012'
const squadA = '91000000-0000-4000-8000-000000000021'
const squadB = '91000000-0000-4000-8000-000000000022'
const draftA = '91000000-0000-4000-8000-000000000031'
const feedbackA = { points: [
  { title: 'Only Alex feedback', what: 'Alex first touch', why: 'Alex control', drill: 'Alex drill' },
  { title: 'Alex passing', what: 'Pass accurately', why: 'Keep possession', drill: 'Short passing practice' },
  { title: 'Alex movement', what: 'Find space', why: 'Receive the ball', drill: 'Move after passing' },
], encouragement: 'Keep going Alex' }
const endpoint = (name: string) => `${SUPABASE_URL}/rest/v1/${name}`
const reviewPath = (assessment: string) => `/coach/feedback/${assessment}`
const sessions = new Map<string, Session>()
let publications: Record<string, Record<string, unknown>>
let publishCalls: Record<string, unknown>[]
let generation: (assessment: string) => Promise<Record<string, unknown>>
let unexpected: string[]

function makeSession(id: string): Session {
  const exp = Math.floor(Date.now() / 1000) + 3600
  const access_token = [{ alg: 'HS256', typ: 'JWT' }, { sub: id, exp, role: 'authenticated' }]
    .map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.') + '.' + Buffer.from('synthetic-signature').toString('base64url')
  const value: Session = {
    access_token, refresh_token: `synthetic-refresh-${id}`, token_type: 'bearer', expires_in: 3600, expires_at: exp,
    user: { id, email: `${id}@synthetic.invalid`, email_confirmed_at: '2026-09-01T00:00:00Z',
      app_metadata: { provider: 'email' }, user_metadata: {}, aud: 'authenticated', role: 'authenticated', created_at: '2026-09-01T00:00:00Z' },
  }
  sessions.set(access_token, value)
  return value
}

async function signIn(id: string) {
  const session = makeSession(id)
  const result = await supabase.auth.setSession({ access_token: session.access_token, refresh_token: session.refresh_token })
  expect(result.error).toBeNull()
}

function project(rows: Record<string, unknown>[], request: Request) {
  const columns = new URL(request.url).searchParams.get('select') ?? '*'
  const projected = columns === '*' ? rows : rows.map(row => Object.fromEntries(columns.split(',').filter(key => key in row).map(key => [key, row[key]])))
  return HttpResponse.json(request.headers.get('accept')?.includes('vnd.pgrst.object') ? projected[0] : projected)
}

function published(feedback: unknown = feedbackA) {
  return { published_text: JSON.stringify(feedback), published_at: '2026-09-18T10:00:00Z', draft_id: draftA, assessment_id: assessmentA }
}

function open(path: string) {
  window.history.replaceState({}, '', path)
  return render(<App />)
}

async function navigate(path: string) {
  await act(async () => {
    window.history.pushState({}, '', path)
    window.dispatchEvent(new PopStateEvent('popstate'))
  })
}

beforeEach(async () => {
  // Exercise the production publication reader, not PlayerFeedback's DEV demo.
  vi.stubEnv('DEV', false)
  vi.spyOn(console, 'error').mockImplementation(() => {})
  sessionStorage.clear()
  publications = {}
  publishCalls = []
  unexpected = []
  sessions.clear()
  generation = async () => ({ feedback: feedbackA, draft_id: draftA })
  server.use(
    http.get(`${SUPABASE_URL}/auth/v1/user`, ({ request }) => {
      const session = sessions.get((request.headers.get('authorization') ?? '').replace(/^Bearer /, ''))
      return session ? HttpResponse.json(session.user) : HttpResponse.json({ message: 'Unknown synthetic token' }, { status: 401 })
    }),
    http.get(endpoint('profiles'), ({ request }) => {
      const id = new URL(request.url).searchParams.get('user_id')?.slice(3)
      return project([{ id, user_id: id, role: id === player ? 'player' : 'coach', full_name: id === coachB ? 'Synthetic Coach B' : 'Synthetic Coach A', nationality: null }], request)
    }),
    http.get(endpoint('coach_assessments'), ({ request }) => {
      const id = new URL(request.url).searchParams.get('id')?.slice(3) ?? assessmentA
      const session = sessions.get((request.headers.get('authorization') ?? '').replace(/^Bearer /, ''))
      if (session?.user.id === coachB && id === assessmentA) return project([], request)
      return project([{ id, squad_player_id: id === assessmentA ? squadA : squadB, coach_user_id: coachA,
        created_at: '2026-09-18T10:00:00Z', coach_rating: 8, work_rate: 8, tactical: 8, attitude: 8, technical: 8, physical: 8, coachability: 8 }], request)
    }),
    http.get(endpoint('squad_players'), ({ request }) => {
      const id = new URL(request.url).searchParams.get('id')?.slice(3) ?? squadA
      return project([{ id, player_name: id === squadA ? 'Alex Synthetic' : 'Blake Synthetic', position: 'mid', age_group: 'U18', linked_player_id: player }], request)
    }),
    http.get(endpoint('coach_assessment_notes'), ({ request }) => project([], request)),
    http.get(endpoint('player_feedback'), ({ request }) => {
      const params = new URL(request.url).searchParams
      const id = params.get('assessment_id')?.slice(3) ?? ''
      return project(publications[id] ? [publications[id]] : [], request)
    }),
    http.post(`${SUPABASE_URL}/functions/v1/player-feedback`, async ({ request }) => {
      const body = await request.json() as { assessment_id: string }
      expect(sessions.has((request.headers.get('authorization') ?? '').replace(/^Bearer /, ''))).toBe(true)
      return HttpResponse.json(await generation(body.assessment_id))
    }),
    http.post(endpoint('rpc/publish_player_feedback'), async ({ request }) => {
      publishCalls.push(await request.json() as Record<string, unknown>)
      return HttpResponse.json('91000000-0000-4000-8000-000000000041')
    }),
    http.post(endpoint('telemetry_events'), () => new HttpResponse(null, { status: 201 })),
    http.all('*', ({ request }) => {
      unexpected.push(`${request.method} ${request.url}`)
      return HttpResponse.json({ message: 'Unexpected request blocked' }, { status: 500 })
    }),
  )
  await signIn(coachA)
})

afterEach(() => {
  cleanup()
  expect(unexpected).toEqual([])
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe('PR40 explicit feedback UI audit', () => {
  it('CONTROL: real coach route opens and a fresh generated draft retains provenance when published', async () => {
    open(reviewPath(assessmentA))
    await userEvent.click(await screen.findByRole('button', { name: 'Draft feedback' }))
    expect(await screen.findByRole('textbox', { name: 'Point 1 title' })).toHaveValue('Only Alex feedback')
    await userEvent.click(screen.getByRole('button', { name: 'Send to Alex' }))
    await waitFor(() => expect(publishCalls).toHaveLength(1))
    expect(publishCalls[0]).toEqual({ p_squad_player_id: squadA, p_text: JSON.stringify(feedbackA), p_draft_id: draftA })
  })

  it('retains the original draft association after reopening and editing an existing publication', async () => {
    publications[assessmentA] = published()
    open(reviewPath(assessmentA))
    const title = await screen.findByRole('textbox', { name: 'Point 1 title' })
    expect(title).toHaveValue('Only Alex feedback')
    await userEvent.clear(title)
    await userEvent.type(title, 'Edited Alex feedback')
    await userEvent.click(screen.getByRole('button', { name: 'Send update' }))
    await waitFor(() => expect(publishCalls).toHaveLength(1))
    expect(publishCalls[0].p_squad_player_id).toBe(squadA)
    expect(publishCalls[0].p_text).toContain('Edited Alex feedback')
    expect(publishCalls[0].p_draft_id).toBe(draftA)
  })

  it('clears A publication before showing B and cannot send A text to B after a route-param change', async () => {
    publications[assessmentA] = published()
    open(reviewPath(assessmentA))
    expect(await screen.findByRole('textbox', { name: 'Point 1 title' })).toHaveValue('Only Alex feedback')
    await navigate(reviewPath(assessmentB))
    expect(await screen.findByText(/Nothing here reaches Blake/)).toBeInTheDocument()
    // Capture the actual wrong-target request when the stale control exists.
    const staleSend = screen.queryByRole('button', { name: 'Send update' })
    if (staleSend) {
      await userEvent.click(staleSend)
      await waitFor(() => expect(publishCalls).toHaveLength(1))
      expect(publishCalls[0].p_squad_player_id).toBe(squadB)
      expect(publishCalls[0].p_text).toContain('Only Alex feedback')
    }
    expect(publishCalls).toHaveLength(0)
    expect(screen.queryByDisplayValue('Only Alex feedback')).not.toBeInTheDocument()
  })

  it('ignores a late generation response for A after navigating to B', async () => {
    let release!: () => void
    let requested = false
    const pending = new Promise<void>(resolve => { release = resolve })
    generation = async id => { expect(id).toBe(assessmentA); requested = true; await pending; return { feedback: feedbackA, draft_id: draftA } }
    open(reviewPath(assessmentA))
    try {
      await userEvent.click(await screen.findByRole('button', { name: 'Draft feedback' }))
      await waitFor(() => expect(requested).toBe(true))
      await navigate(reviewPath(assessmentB))
      expect(await screen.findByText(/Nothing here reaches Blake/)).toBeInTheDocument()
      await act(async () => { release(); await pending })
      await waitFor(() => expect(screen.queryByRole('button', { name: 'Drafting…' })).not.toBeInTheDocument())
      expect(screen.queryByDisplayValue('Only Alex feedback')).not.toBeInTheDocument()
    } finally { release() }
  })

  it('CONTROL: actual AuthProvider/RouteGuard unmount prevents A generation entering a different coach account', async () => {
    let release!: () => void
    let requested = false
    let finished = false
    const pending = new Promise<void>(resolve => { release = resolve })
    generation = async () => { requested = true; await pending; finished = true; return { feedback: feedbackA, draft_id: draftA } }
    open(reviewPath(assessmentA))
    try {
      await userEvent.click(await screen.findByRole('button', { name: 'Draft feedback' }))
      await waitFor(() => expect(requested).toBe(true))
      await act(async () => { await signIn(coachB) })
      expect(await screen.findByText('Assessment not found')).toBeInTheDocument()
      await navigate(reviewPath(assessmentB))
      expect(await screen.findByText(/Nothing here reaches Blake/)).toBeInTheDocument()
      await act(async () => { release(); await pending })
      await waitFor(() => expect(finished).toBe(true))
      expect(screen.getByRole('button', { name: 'Draft feedback' })).toBeInTheDocument()
      expect(screen.queryByDisplayValue('Only Alex feedback')).not.toBeInTheDocument()
      expect(publishCalls).toHaveLength(0)
    } finally { release() }
  })

  it.each(['coach stored', 'coach generated', 'player stored'] as const)('handles points:[null] in %s without crashing the app', async source => {
    const malformed = { points: [null], encouragement: 'Synthetic malformed feedback' }
    let release!: () => void
    let requested = false
    const pending = new Promise<void>(resolve => { release = resolve })
    if (source === 'coach generated') {
      generation = async () => {
        requested = true
        await pending
        return { feedback: malformed, draft_id: draftA }
      }
    } else {
      server.use(http.get(endpoint('player_feedback'), async ({ request }) => {
        expect(new URL(request.url).searchParams.get('assessment_id')).toBe(`eq.${assessmentA}`)
        requested = true
        await pending
        return project([published(malformed)], request)
      }))
    }
    if (source === 'player stored') await signIn(player)
    open(source === 'player stored' ? `/player/feedback/${assessmentA}` : reviewPath(assessmentA))
    const busy = () => source === 'coach generated'
      ? screen.queryByRole('button', { name: 'Drafting…' })
      : screen.queryByText(source === 'player stored' ? 'Analysing your feedback' : 'Loading…')
    try {
      if (source === 'coach generated') await userEvent.click(await screen.findByRole('button', { name: 'Draft feedback' }))
      await waitFor(() => expect(requested).toBe(true))
      expect(busy()).toBeInTheDocument()
      // Observe the real pending state before releasing HTTP, then wait for it
      // to finish. An initial empty editor must not pass before data is handled.
      await act(async () => { release(); await pending })
      await waitFor(() => expect(busy()).not.toBeInTheDocument())
      expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument()
      expect(screen.getByRole('heading', { name: source === 'player stored' ? 'Coach Feedback' : 'Review feedback' })).toBeInTheDocument()
      // Accept a local recovery action or explanation, without requiring an
      // alert role (the player's existing safe error view has no alert).
      const fallback = screen.queryByRole('alert')
        || screen.queryByRole('button', { name: /^(Draft feedback|Try again|Retry)$/i })
        || screen.queryByText(/(?:couldn't|could not|unable to|invalid|unavailable).*feedback|feedback.*(?:invalid|unavailable)/i)
      expect(fallback).toBeInTheDocument()
      expect(publishCalls).toHaveLength(0)
    } finally { release() }
  })
})
