import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { http, HttpResponse } from 'msw'
import { server } from '../msw/server'
import { insertInto, SUPABASE_URL, table } from '../msw/supabase'
import { signInAs } from '../support/session'
import CoachAssessPage from '@/pages/coach/CoachAssessPage'

const state = vi.hoisted(() => ({ navigate: vi.fn(), error: vi.fn(),
  user: { id: 'review-coach' }, profile: { user_id: 'review-coach', role: 'coach', full_name: 'Review Coach' },
}))
vi.mock('react-router-dom', async importOriginal => ({
  ...await importOriginal<typeof import('react-router-dom')>(),
  useNavigate: () => state.navigate,
}))
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({
  user: state.user, profile: state.profile,
}) }))
vi.mock('sonner', () => ({ toast: { error: state.error, success: vi.fn() } }))
vi.mock('@/lib/telemetry', () => ({ trackEvent: vi.fn(), startTimer: () => () => 1 }))

beforeEach(() => {
  state.navigate.mockClear(); state.error.mockClear()
  signInAs({ id: 'review-coach' })
  server.use(
    table('squad_players', [{ id: 'review-player', coach_user_id: 'review-coach', player_name: 'Synthetic Player' }]),
    table('coach_sessions', []), table('coach_assessments', []),
    insertInto('coach_assessments', body => ({ id: 'saved-assessment', ...body })),
  )
})

async function editFeedback() {
  render(<MemoryRouter><CoachAssessPage /></MemoryRouter>)
  const user = userEvent.setup()
  const option = await screen.findByRole('option', { name: 'Synthetic Player' })
  await user.selectOptions(option.closest('select')!, 'review-player')
  const shared = screen.getByPlaceholderText(/Great week\. Keep working/)
  fireEvent.change(shared, { target: { value: 'Deliberately shared synthetic feedback' } })
  await user.click(screen.getByRole('button', { name: 'Publish to the player' }))
  return { user, shared }
}

// These are review reproductions against PR44's exact head. The desired
// behaviors are asserted, so an unresolved bug remains visibly red.
describe('K9 routed assessment feedback runtime review', () => {
  it('CONTROL: writes deliberately shared text and publication state before leaving', async () => {
    const writes: Record<string, unknown>[] = []
    server.use(insertInto('coach_shared_feedback', body => { writes.push(body); return { id: 'shared', ...body } }))
    const { user } = await editFeedback()
    await user.click(screen.getByRole('button', { name: /save assessment/i }))
    await waitFor(() => expect(state.navigate).toHaveBeenCalledWith('/coach/home'))
    expect(writes).toHaveLength(1)
    expect(writes[0]).toMatchObject({ assessment_id: 'saved-assessment', coach_user_id: 'review-coach', body: 'Deliberately shared synthetic feedback' })
    expect(writes[0].published_at).toEqual(expect.any(String))
  })

  it('keeps the feedback form and a usable retry when publication fails', async () => {
    server.use(http.post(`${SUPABASE_URL}/rest/v1/coach_shared_feedback`, () =>
      HttpResponse.json({ code: '42501', message: 'Synthetic publication refusal' }, { status: 403 })))
    const { user, shared } = await editFeedback()
    await user.click(screen.getByRole('button', { name: /save assessment/i }))
    await waitFor(() => expect(state.error).toHaveBeenCalledWith(expect.stringContaining('shared feedback failed')))
    expect(state.navigate).not.toHaveBeenCalled()
    expect(shared).toHaveValue('Deliberately shared synthetic feedback')
    expect(screen.getByRole('button', { name: /save assessment/i })).toBeEnabled()
  })

  it('does not claim completion when an assessment update returns zero rows', async () => {
    let loadedShared = false
    server.use(table('coach_assessments', [{ id: 'existing', work_rate: 5, tactical: 5, attitude: 5, technical: 5, physical: 5, coachability: 5 }]),
      http.get(`${SUPABASE_URL}/rest/v1/coach_shared_feedback`, () => { loadedShared = true; return HttpResponse.json([]) }),
      http.patch(`${SUPABASE_URL}/rest/v1/coach_assessments`, () => HttpResponse.json([])))
    const { user } = await editFeedback()
    // Wait for the existing assessment's readback before submitting.
    await waitFor(() => expect(loadedShared).toBe(true))
    await user.click(screen.getByRole('button', { name: /save assessment/i }))
    await waitFor(() => expect(state.navigate.mock.calls.length + state.error.mock.calls.length).toBeGreaterThan(0))
    expect(state.error).toHaveBeenCalled()
    expect(state.navigate).not.toHaveBeenCalled()
  })
})
