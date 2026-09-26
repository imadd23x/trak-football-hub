/**
 * TRAK-71 (J6, second use-case test 25 Sep): the coach's message sits inside
 * the latest-assessment card in full, with no tap-through. The old button
 * opened a page that read "Analyzing your feedback…" and looked like an error.
 * Showing the message still counts as the player opening it (J7).
 * The parent-invitations card leaves home once a parent is linked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { renderApp } from '../../../../tests/support/render-app'
import { signInAs } from '../../../../tests/support/session'
import { server } from '../../../../tests/msw/server'
import { table, rpc, SUPABASE_URL } from '../../../../tests/msw/supabase'
import { trackEvent } from '@/lib/telemetry'

vi.mock('@/lib/telemetry', async importOriginal => ({ ...(await importOriginal<typeof import('@/lib/telemetry')>()), trackEvent: vi.fn() }))

const PLAYER = { id: 'player-home-msg' }
const WORDS = 'Recovery runs after losing the ball.\nYou stopped twice this week. Keep going.'
const ASSESSMENT = { id: 'assessment-1', squad_player_id: 'squad-1', coach_user_id: 'coach-1', created_at: '2026-09-24T10:00:00Z',
  work_rate: 8, tactical: 8, attitude: 8, technical: 8, physical: 8, coachability: 8, coach_rating: 8 }
const invite = (status: string) => ({ id: 'invite-1', player_user_id: PLAYER.id, parent_email: 'parent@synthetic.test',
  invite_token: 'token-1', status, expires_at: '2026-10-30T00:00:00Z' })

function setup({ shared = HttpResponse.json({ body: WORDS }), invites = [invite('accepted')] } = {}) {
  server.use(
    table('profiles', [{ id: 'p', user_id: PLAYER.id, role: 'player', full_name: 'Manos Synthetic' }]),
    table('matches', []), table('player_details', []),
    table('squad_players', [{ id: 'squad-1', coach_user_id: 'coach-1' }]),
    table('coach_assessments', [ASSESSMENT]),
    http.get(`${SUPABASE_URL}/rest/v1/coach_shared_feedback`, () => shared),
    table('coach_calendar_events', []), table('recognition_awards', []),
    rpc('get_player_invites_for_current_user', () => invites),
    rpc('my_consent_status', () => ({ required: false, invited_parent: null })),
  )
}

beforeEach(() => { signInAs(PLAYER); vi.mocked(trackEvent).mockClear() })
afterEach(() => cleanup())

describe('TRAK-71: player home', () => {
  it("shows the coach's full message inside the latest assessment, with no tap-through", async () => {
    setup()
    renderApp('/player/home')
    const message = await screen.findByText(/Recovery runs after losing the ball\./)
    expect(message).toHaveTextContent('You stopped twice this week. Keep going.')
    expect(screen.getByText('MESSAGE FROM YOUR COACH')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Your coach left feedback|What to work on/ })).toBeNull()
    await waitFor(() => expect(trackEvent).toHaveBeenCalledWith('feedback_opened', { assessment_id: 'assessment-1' }))
  })

  it('a failed message read says so instead of looking like no message', async () => {
    setup({ shared: HttpResponse.json({ code: 'XX000', message: 'unavailable' }, { status: 500 }) })
    renderApp('/player/home')
    expect(await screen.findByText(/Couldn't load your coach's message/)).toBeInTheDocument()
    expect(trackEvent).not.toHaveBeenCalledWith('feedback_opened', expect.anything())
  })

  it('hides the parent-invitations card once a parent is linked', async () => {
    setup({ invites: [invite('accepted')] })
    renderApp('/player/home')
    await screen.findByText(/Recovery runs after losing the ball\./)
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Parent invitations' })).toBeNull())
  })

  it('keeps the card while the invitation is still pending', async () => {
    setup({ invites: [invite('pending')] })
    renderApp('/player/home')
    expect(await screen.findByRole('region', { name: 'Parent invitations' })).toBeInTheDocument()
  })
})
