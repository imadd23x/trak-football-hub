/**
 * TRAK-100 (J5): in the TRAK-24 rerun the session picker showed two
 * "Finishing Training" sessions on 1 Oct that looked the same. The coach
 * picked the earlier one, which nobody had attended, and the child's history
 * then showed the assessment against it. The picker now lists only sessions
 * the chosen player was marked present at, and shows when each was logged.
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
const EARLY = '2026-10-01T09:56:06Z'
const LATE = '2026-10-01T13:04:01Z'
const SESSIONS = [
  { id: 'session-late', title: 'Finishing Training', session_date: '2026-10-01', created_at: LATE },
  { id: 'session-early', title: 'Finishing Training', session_date: '2026-10-01', created_at: EARLY },
  { id: 'session-set', title: 'Set Pieces Training', session_date: '2026-10-01', created_at: '2026-10-01T13:09:57Z' },
]
// Who was marked present where. Bella was at nothing.
let present: Record<string, string[]>
let attendanceFails: boolean
let writes: Record<string, unknown>[]
const at = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })

beforeEach(() => {
  present = { 'player-a': ['session-late', 'session-set'], 'player-b': [] }
  attendanceFails = false
  writes = []
  server.use(
    http.get(endpoint('squad_players'), () => HttpResponse.json([
      { id: 'player-a', player_name: 'Alex Synthetic' },
      { id: 'player-b', player_name: 'Bella Synthetic' },
    ])),
    http.get(endpoint('coach_sessions'), () => HttpResponse.json(SESSIONS)),
    http.get(endpoint('session_attendance'), ({ request }) => {
      if (attendanceFails) return HttpResponse.json({ message: 'synthetic failure' }, { status: 500 })
      const p = new URL(request.url).searchParams
      expect(p.get('status')).toBe('eq.present')
      const player = p.get('squad_player_id')?.replace(/^eq\./, '') ?? ''
      return HttpResponse.json((present[player] ?? []).map(session_id => ({ session_id })))
    }),
    http.get(endpoint('coach_assessments'), () => HttpResponse.json([])),
    http.post(endpoint('coach_assessments'), async ({ request }) => {
      writes.push(await request.json() as Record<string, unknown>)
      return HttpResponse.json([{ id: 'assessment-1' }])
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
const sessionNames = () => [...select('Session').options].filter(o => o.value).map(o => o.textContent)
const saveButton = () => screen.getByRole('button', { name: /Save Assessment/ })

describe('TRAK-100: the session picker offers only sessions the player attended', () => {
  it('lists only attended sessions, each with the time it was logged', async () => {
    showForm()
    await choosePlayer('player-a')
    await screen.findByRole('option', { name: /Set Pieces Training/ })
    expect(sessionNames()).toEqual([
      `Finishing Training · 2026-10-01 · logged ${at(LATE)}`,
      `Set Pieces Training · 2026-10-01 · logged ${at('2026-10-01T13:09:57Z')}`,
    ])
    // The rerun's wrong pick: same title and day, nobody present.
    expect(screen.queryByRole('option', { name: new RegExp(`logged ${at(EARLY)}`) })).toBeNull()
  })

  it('saves against the attended session the coach picked', async () => {
    showForm()
    await choosePlayer('player-a')
    await screen.findByRole('option', { name: /Set Pieces Training/ })
    await userEvent.selectOptions(select('Session'), 'session-late')
    await waitFor(() => expect(saveButton()).toBeEnabled())
    await userEvent.click(saveButton())
    await screen.findByText('Coach home')
    expect(writes.map(w => w.session_id)).toEqual(['session-late'])
  })

  it('a player at no session gets a reason, not a list, and Save stays locked', async () => {
    showForm()
    await choosePlayer('player-b')
    expect(await screen.findByText(/Bella isn't marked present at any past session/)).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'Session' })).toBeNull()
    expect(saveButton()).toBeDisabled()
  })

  it('switching player drops a session the new player did not attend', async () => {
    present['player-b'] = ['session-set']
    showForm()
    await choosePlayer('player-a')
    await screen.findByRole('option', { name: /Set Pieces Training/ })
    await userEvent.selectOptions(select('Session'), 'session-late')
    await userEvent.selectOptions(select('Player'), 'player-b')
    await waitFor(() => expect(sessionNames()).toEqual([`Set Pieces Training · 2026-10-01 · logged ${at('2026-10-01T13:09:57Z')}`]))
    expect(select('Session').value).toBe('')
    expect(saveButton()).toBeDisabled()
  })

  it('a failed attendance read offers no sessions and a Retry, never every session', async () => {
    attendanceFails = true
    showForm()
    await choosePlayer('player-a')
    expect(await screen.findByText(/Couldn't load which sessions Alex was at/)).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /Finishing Training/ })).toBeNull()
    expect(saveButton()).toBeDisabled()
    attendanceFails = false
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await screen.findByRole('option', { name: /Set Pieces Training/ })
    expect(screen.queryByText(/Couldn't load which sessions/)).toBeNull()
  })

  it('no session list until a player is chosen', async () => {
    showForm()
    await screen.findByRole('option', { name: 'Alex Synthetic' })
    expect(select('Session')).toBeDisabled()
    expect(screen.getByRole('option', { name: 'Choose a player first' })).toBeInTheDocument()
    expect(sessionNames()).toEqual([])
  })
})
