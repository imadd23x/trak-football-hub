import { describe, it, expect } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderApp } from '../../../../tests/support/render-app'
import { signInAs } from '../../../../tests/support/session'
import { server } from '../../../../tests/msw/server'
import { table, rpc } from '../../../../tests/msw/supabase'

/**
 * TRAK-193 (Kostas, 16 Oct: "I missed it completely"): on "What are you
 * logging?", History was 10 px grey capitals. It's a button now: an icon and
 * the word, a 44 px touch target, in the same place, going to the same list.
 */
const COACH = { id: 'coach-193' }

describe('TRAK-193: History on the coach\'s "What are you logging?"', () => {
  it('is a clear button with an icon and a 44 px target, and opens the sessions list', async () => {
    signInAs(COACH)
    server.use(
      table('profiles', [{ id: 'p', user_id: COACH.id, role: 'coach', full_name: 'Coach', invite_code: 'ABCD' }]),
      table('coach_sessions', []),
      table('squad_players', []),
      // TRAK-426: Training off, so the Log page (and History) is still there.
      rpc('feature_on', ({ p_feature }) => p_feature !== 'training'),
    )
    renderApp('/coach/sessions')
    const history = await screen.findByRole('button', { name: 'History' })
    expect(history).toHaveTextContent('History')
    expect(history.querySelector('svg')).not.toBeNull()
    // Tailwind's min-h-11 is 44 px, Apple's smallest comfortable tap.
    expect(history.className).toMatch(/\bmin-h-11\b/)
    await userEvent.click(history)
    await waitFor(() => expect(window.location.pathname).toBe('/coach/sessions/list'))
  }, 20_000)
})
