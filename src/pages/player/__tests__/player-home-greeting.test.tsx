/**
 * TRAK-70: the player home greeting follows the time of day. The second
 * use-case test (25 Sep, 13:40 Dubai) showed "Good morning" to the player while
 * the coach home said "Good afternoon".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, screen } from '@testing-library/react'
import { renderApp } from '../../../../tests/support/render-app'
import { signInAs } from '../../../../tests/support/session'
import { server } from '../../../../tests/msw/server'
import { table, rpc } from '../../../../tests/msw/supabase'

const PLAYER = { id: 'player-greeting' }

beforeEach(() => {
  server.use(
    table('profiles', [{ id: 'p', user_id: PLAYER.id, role: 'player', full_name: 'Greta Synthetic' }]),
    table('matches', []), table('player_details', []), table('squad_players', []),
    table('coach_assessments', []), table('coach_shared_feedback', []),
    table('coach_calendar_events', []), table('recognition_awards', []),
    rpc('get_player_invites_for_current_user', () => []),
    rpc('my_consent_status', () => ({ required: false, invited_parent: null })),
  )
})
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('TRAK-70: player home greeting', () => {
  it.each([
    ['09:15', 'Good morning,'],
    ['13:40', 'Good afternoon,'],
    ['19:00', 'Good evening,'],
  ])('at %s local time it says "%s"', async (time, greeting) => {
    // Only the clock is faked; timers stay real so the app's requests settle.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(`2026-09-25T${time}:00`))
    // Sign in on the faked clock. A session minted on the real clock expires an
    // hour after the test runs, so a faked hour later than that looked expired,
    // the refresh failed and the app signed out (red on CI at 17:48 UTC).
    signInAs(PLAYER)
    renderApp('/player/home')
    expect(await screen.findByText('Greta Synthetic')).toBeInTheDocument()
    expect(screen.getByText(greeting)).toBeInTheDocument()
  })
})
