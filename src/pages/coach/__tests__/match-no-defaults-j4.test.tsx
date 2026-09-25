/**
 * J4 (MVP Requirements): the coach logs each child's position, minutes, goals
 * and assists "with no invented defaults". The form used to start every child
 * at 90 minutes, 0 goals and 0 assists, and sent 'Midfielder' and 'U19+' when
 * the roster had no position or age, so ticking "played" alone saved a record
 * nobody entered.
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
const PLAYER = { id: 'squad-1', coach_user_id: COACH.id, player_name: 'Ade Okafor',
  linked_player_id: 'player-1', position: 'Defender', age_group: 'U14', age: null }

function setup(player: Record<string, unknown> = PLAYER) {
  const calls: Record<string, unknown>[] = []
  server.use(
    table('profiles', [{ id: 'p', user_id: COACH.id, role: 'coach', full_name: 'Coach', invite_code: 'ABCD' }]),
    table('squad_players', [player]),
    table('coach_sessions', []),
    insertInto('coach_sessions', body => ({ id: 'session-1', ...body })),
    insertInto('session_attendance', body => ({ id: 'att-1', ...body })),
    http.post(`${SUPABASE_URL}/rest/v1/rpc/log_match_for_player`, async ({ request }) => {
      calls.push(await request.json() as Record<string, unknown>)
      return HttpResponse.json(null)
    }),
  )
  return calls
}

async function startMatch() {
  const user = userEvent.setup()
  renderApp('/coach/sessions/quick')
  await user.type(await screen.findByPlaceholderText('Opponent name'), 'Olympiakos U14')
  const [us, them] = screen.getAllByPlaceholderText('0')
  await user.type(us, '2')
  await user.type(them, '1')
  await user.click(await screen.findByRole('button', { name: 'Mark played' }))
  return user
}

const saveButton = () => screen.getByRole('button', { name: 'Save match' })

describe('J4: no invented match defaults', () => {
  beforeEach(() => signInAs(COACH))

  it('ticking "played" alone cannot save: minutes, goals and assists start empty', async () => {
    const calls = setup()
    await startMatch()
    expect(screen.getByRole('spinbutton', { name: 'Minutes played by Ade Okafor' })).toHaveValue(null)
    expect(saveButton()).toBeDisabled()
    expect(screen.getAllByText(/still needs? .*minutes, goals, assists/i).length).toBeGreaterThan(0)
    expect(calls).toHaveLength(0)
  })

  it('saves exactly what the coach entered, including an explicit 0', async () => {
    const calls = setup()
    const user = await startMatch()
    await user.type(screen.getByRole('spinbutton', { name: 'Minutes played by Ade Okafor' }), '55')
    await user.click(screen.getByRole('button', { name: 'One more goals for Ade Okafor' }))
    await user.click(screen.getByRole('button', { name: 'One fewer assists for Ade Okafor' }))
    await waitFor(() => expect(saveButton()).toBeEnabled())
    await user.click(saveButton())
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0]).toMatchObject({
      p_minutes_played: 55, p_goals: 1, p_assists: 0,
      // From the roster, not invented.
      p_position: 'Defender', p_age_group: 'U14',
    })
  })

  it('a roster row with no position needs one picked; it is never sent as Midfielder', async () => {
    const calls = setup({ ...PLAYER, position: null })
    const user = await startMatch()
    await user.type(screen.getByRole('spinbutton', { name: 'Minutes played by Ade Okafor' }), '30')
    await user.click(screen.getByRole('button', { name: 'One fewer goals for Ade Okafor' }))
    await user.click(screen.getByRole('button', { name: 'One fewer assists for Ade Okafor' }))
    expect(saveButton()).toBeDisabled()
    expect(screen.getAllByText(/position/i).length).toBeGreaterThan(0)
    await user.click(screen.getByRole('button', { name: 'Goalkeeper' }))
    await waitFor(() => expect(saveButton()).toBeEnabled())
    await user.click(saveButton())
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0]).toMatchObject({ p_position: 'Goalkeeper' })
  })

  it('a child with no age group on the roster is never logged as U19+', async () => {
    const calls = setup({ ...PLAYER, age_group: null, age: null })
    const user = await startMatch()
    await user.type(screen.getByRole('spinbutton', { name: 'Minutes played by Ade Okafor' }), '30')
    await user.click(screen.getByRole('button', { name: 'One fewer goals for Ade Okafor' }))
    await user.click(screen.getByRole('button', { name: 'One fewer assists for Ade Okafor' }))
    expect(saveButton()).toBeDisabled()
    expect(screen.getAllByText(/age group on the roster/i).length).toBeGreaterThan(0)
    expect(calls).toHaveLength(0)
  })
})
