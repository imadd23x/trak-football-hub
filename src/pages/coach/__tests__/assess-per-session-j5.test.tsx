/**
 * TRAK-68 (J5, decided 25 Sep): an assessment belongs to a session. The session
 * is required, only sessions that already happened are offered, and there is one
 * assessment per player per session. The use-case test found that assessing a
 * player twice in one day silently overwrote the first assessment and moved it
 * to the second match.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CoachAssessPage from '@/pages/coach/CoachAssessPage'
import { server } from '../../../../tests/msw/server'
import { SUPABASE_URL } from '../../../../tests/msw/supabase'

const auth = vi.hoisted(() => ({ user: { id: 'coach-a' }, profile: { full_name: 'Coach A' } }))
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => auth }))
vi.mock('@/lib/telemetry', () => ({ trackEvent: vi.fn(), startTimer: () => () => 100 }))

const endpoint = (table: string) => `${SUPABASE_URL}/rest/v1/${table}`
const SESSIONS = [
  { id: 'session-future', title: 'Planned training', session_date: '2099-01-01' },
  { id: 'session-a', title: 'vs Olympiacos Academy', session_date: '2026-09-20' },
  { id: 'session-b', title: 'Finishing training', session_date: '2026-09-20' },
]
type Row = { id: string; squad_player_id: string; session_id: string | null; created_at: string } & Record<string, unknown>
let rows: Row[]
let writes: { method: 'post' | 'patch'; id: string | null; body: Record<string, unknown> }[]
let sessions: typeof SESSIONS

const eq = (params: URLSearchParams, key: string) => params.get(key)?.replace(/^eq\./, '')

beforeEach(() => {
  rows = []; writes = []; sessions = SESSIONS
  server.use(
    http.get(endpoint('squad_players'), () => HttpResponse.json([
      { id: 'player-a', player_name: 'Alex Synthetic' },
      { id: 'player-b', player_name: 'Bella Synthetic' },
    ])),
    // Honours the date filter the page sends, like PostgREST would.
    http.get(endpoint('coach_sessions'), ({ request }) => {
      const upTo = new URL(request.url).searchParams.get('session_date')?.replace(/^lte\./, '')
      return HttpResponse.json(sessions.filter(s => !upTo || s.session_date <= upTo))
    }),
    // A small assessments table: filters by player, session and created_at like PostgREST.
    http.get(endpoint('coach_assessments'), ({ request }) => {
      const p = new URL(request.url).searchParams
      const since = p.get('created_at')?.replace(/^gte\./, '')
      return HttpResponse.json(rows.filter(r =>
        r.squad_player_id === eq(p, 'squad_player_id')
        && (!p.has('session_id') || r.session_id === eq(p, 'session_id'))
        && (!since || r.created_at >= since)))
    }),
    http.post(endpoint('coach_assessments'), async ({ request }) => {
      const body = await request.json() as Record<string, unknown>
      const id = `assessment-${rows.length + 1}`
      rows.push({ ...body, id, squad_player_id: body.squad_player_id as string,
        session_id: (body.session_id as string) ?? null, created_at: new Date().toISOString() })
      writes.push({ method: 'post', id: null, body })
      return HttpResponse.json([{ id }])
    }),
    http.patch(endpoint('coach_assessments'), async ({ request }) => {
      const id = eq(new URL(request.url).searchParams, 'id') ?? null
      const body = await request.json() as Record<string, unknown>
      writes.push({ method: 'patch', id, body })
      return HttpResponse.json([{ id }])
    }),
    http.get(endpoint('coach_shared_feedback'), () => HttpResponse.json([])),
    http.get(endpoint('coach_assessment_notes'), () => HttpResponse.json([])),
    ...['coach_assessment_notes', 'coach_shared_feedback'].flatMap(table =>
      (['post', 'patch'] as const).map(method => http[method](endpoint(table), () => HttpResponse.json([])))),
    http.post(`${SUPABASE_URL}/rest/v1/rpc/coach_squad_player_consent_required`, () => HttpResponse.json(false)),
  )
})
afterEach(() => cleanup())

function showForm() {
  render(<MemoryRouter initialEntries={['/coach/assess']}><Routes>
    <Route path="/coach/assess" element={<CoachAssessPage />} />
    <Route path="/coach/home" element={<p>Coach home</p>} />
  </Routes></MemoryRouter>)
}
const select = (label: string) => screen.getByRole('combobox', { name: label }) as HTMLSelectElement
async function choosePlayer(id: string) {
  await screen.findByRole('option', { name: 'Alex Synthetic' })
  await userEvent.selectOptions(select('Player'), id)
}
async function chooseSession(id: string) {
  await screen.findByRole('option', { name: /Finishing training/ })
  await userEvent.selectOptions(select('Session'), id)
}
const saveButton = () => screen.getByRole('button', { name: /Save Assessment/ })

describe('TRAK-68: an assessment belongs to a session that already happened', () => {
  it('offers only past sessions, and no "No session" choice', async () => {
    showForm()
    await choosePlayer('player-b')
    await screen.findByRole('option', { name: /vs Olympiacos Academy/ })
    expect(screen.getByRole('option', { name: /Finishing training/ })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /Planned training/ })).toBeNull()
    expect(screen.queryByRole('option', { name: /No session/ })).toBeNull()
  })

  it('cannot save until a session is chosen', async () => {
    showForm()
    await choosePlayer('player-b')
    await screen.findByRole('option', { name: /Finishing training/ })
    expect(saveButton()).toBeDisabled()
    await chooseSession('session-a')
    await waitFor(() => expect(saveButton()).toBeEnabled())
  })

  it('two sessions on the same day give the same player two assessments', async () => {
    showForm()
    await choosePlayer('player-b'); await chooseSession('session-a')
    await waitFor(() => expect(saveButton()).toBeEnabled())
    await userEvent.click(saveButton())
    await screen.findByText('Coach home')
    cleanup()
    showForm()
    await choosePlayer('player-b'); await chooseSession('session-b')
    await waitFor(() => expect(saveButton()).toBeEnabled())
    expect(screen.queryByText(/Editing your assessment/)).toBeNull()
    await userEvent.click(saveButton())
    await screen.findByText('Coach home')
    expect(writes.map(w => [w.method, w.body.session_id])).toEqual([['post', 'session-a'], ['post', 'session-b']])
  })

  it('reopening the same player and session edits that assessment', async () => {
    rows.push({ id: 'assessment-x', squad_player_id: 'player-a', session_id: 'session-a', created_at: '2026-09-20T18:00:00Z',
      work_rate: 8, tactical: 8, attitude: 8, technical: 8, physical: 8, coachability: 8, appearance: 'sub' })
    showForm()
    await choosePlayer('player-a'); await chooseSession('session-a')
    await screen.findByText(/Editing your assessment for vs Olympiacos Academy/)
    await waitFor(() => expect(saveButton()).toBeEnabled())
    await userEvent.click(saveButton())
    await screen.findByText('Coach home')
    expect(writes).toEqual([expect.objectContaining({ method: 'patch', id: 'assessment-x' })])
    expect(writes[0].body.session_id).toBe('session-a')
  })

  it('tells a coach with no past sessions to log one first', async () => {
    sessions = [SESSIONS[0]]
    showForm()
    await choosePlayer('player-b')
    expect(await screen.findByText(/Log the session first/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Log a session/ })).toHaveAttribute('href', '/coach/sessions')
    expect(saveButton()).toBeDisabled()
  })
})
