/**
 * Tarek's review of #141: J6 says a failed load shows a clear error and a retry
 * button. The message alert says "Pull down to refresh", but player home has no
 * pull-to-refresh, so the child is told to do something that does nothing.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { renderApp } from '../../../../tests/support/render-app'
import { signInAs } from '../../../../tests/support/session'
import { server } from '../../../../tests/msw/server'
import { table, rpc, SUPABASE_URL } from '../../../../tests/msw/supabase'

const PLAYER = { id: 'player-home-retry' }
const ASSESSMENT = { id: 'assessment-1', squad_player_id: 'squad-1', coach_user_id: 'coach-1', created_at: '2026-09-24T10:00:00Z',
  work_rate: 8, tactical: 8, attitude: 8, technical: 8, physical: 8, coachability: 8, coach_rating: 8 }

beforeEach(() => signInAs(PLAYER))
afterEach(() => cleanup())

describe('#141 review: a failed coach-message read', () => {
  it('offers a Retry that loads the message once the read works', async () => {
    let fail = true
    server.use(
      table('profiles', [{ id: 'p', user_id: PLAYER.id, role: 'player', full_name: 'Manos Synthetic' }]),
      table('matches', []), table('player_details', []),
      table('squad_players', [{ id: 'squad-1', coach_user_id: 'coach-1' }]),
      table('coach_assessments', [ASSESSMENT]),
      http.get(`${SUPABASE_URL}/rest/v1/coach_shared_feedback`, () => fail
        ? HttpResponse.json({ code: 'XX000', message: 'unavailable' }, { status: 500 })
        : HttpResponse.json({ body: 'Keep your head up after a mistake.' })),
      table('coach_calendar_events', []), table('recognition_awards', []),
      rpc('get_player_invites_for_current_user', () => []),
      rpc('my_consent_status', () => ({ required: false, invited_parent: null })),
    )
    const user = userEvent.setup()
    renderApp('/player/home')
    const alert = await screen.findByText(/Couldn't load your coach's message/)
    expect(alert).not.toHaveTextContent(/pull down/i)
    fail = false
    await user.click(screen.getByRole('button', { name: /retry/i }))
    expect(await screen.findByText('Keep your head up after a mistake.')).toBeInTheDocument()
  })
})
