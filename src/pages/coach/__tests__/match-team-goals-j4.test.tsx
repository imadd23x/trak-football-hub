/**
 * TRAK-66 (J4): the second use-case test saved a 1–0 win with two scorers.
 * The match form now refuses more goals from our players than our score.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { renderApp } from '../../../../tests/support/render-app'
import { signInAs } from '../../../../tests/support/session'
import { server } from '../../../../tests/msw/server'
import { table, insertInto, SUPABASE_URL } from '../../../../tests/msw/supabase'

const COACH = { id: 'coach-1' }
const player = (id: string, name: string) => ({ id, coach_user_id: COACH.id, player_name: name,
  linked_player_id: `user-${id}`, position: 'Attacker', age_group: 'U15', age: null })

beforeEach(() => {
  signInAs(COACH)
  server.use(
    table('profiles', [{ id: 'p', user_id: COACH.id, role: 'coach', full_name: 'Coach', invite_code: 'ABCD' }]),
    table('squad_players', [player('a', 'Alexis Georgiou'), player('b', 'Marios Rizos')]),
    table('coach_sessions', []),
    insertInto('coach_sessions', body => ({ id: 'session-1', ...body })),
    http.post(`${SUPABASE_URL}/rest/v1/rpc/coach_squad_player_consent_required`, () => HttpResponse.json(false)),
    http.post(`${SUPABASE_URL}/rest/v1/rpc/log_match_for_player`, () => HttpResponse.json(null)),
  )
})

describe('J4: our scorers cannot outnumber our goals', () => {
  it('refuses a 1–0 with two scorers, and accepts it once the score says 2', async () => {
    const user = userEvent.setup()
    renderApp('/coach/sessions/quick')
    await user.type(await screen.findByPlaceholderText('Opponent name'), 'Olympiacos Youth')
    const [us, them] = screen.getAllByPlaceholderText('0')
    await user.type(us, '1')
    await user.type(them, '0')
    for (const name of ['Alexis Georgiou', 'Marios Rizos']) {
      await user.click((await screen.findAllByRole('button', { name: 'Mark played' }))[0])
      await user.type(screen.getByRole('spinbutton', { name: `Minutes played by ${name}` }), '90')
      await user.click(screen.getByRole('button', { name: `One more goals for ${name}` }))
      await user.click(screen.getByRole('button', { name: `One fewer assists for ${name}` }))
    }
    const save = screen.getByRole('button', { name: 'Save match' })
    expect(await screen.findByText('2 goals entered, but the team scored 1')).toBeInTheDocument()
    expect(save).toBeDisabled()

    await user.clear(us)
    await user.type(us, '2')
    await waitFor(() => expect(save).toBeEnabled())
    expect(screen.queryByText(/goals entered, but the team scored/)).toBeNull()
  })
})
