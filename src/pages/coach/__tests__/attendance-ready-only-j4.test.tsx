import { describe, it, expect, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { renderApp } from '../../../../tests/support/render-app'
import { signInAs } from '../../../../tests/support/session'
import { server } from '../../../../tests/msw/server'
import { table, insertInto, rpc, SUPABASE_URL } from '../../../../tests/msw/supabase'

/**
 * J4 + G1: the database refuses attendance for a child whose consent is not
 * confirmed, and one refused row fails the whole attendance insert. So the
 * screen offers only confirmed players and names the rest. A failed check
 * counts as not confirmed.
 */
const COACH = { id: 'coach-1' }
const row = (id: string, player_name: string) => ({
  id, coach_user_id: COACH.id, player_name, linked_player_id: `player-${id}`,
  position: 'Defender', age_group: 'U15', age: 15,
})
const READY = row('ready', 'Rea Ready')
const WAITING = row('waiting', 'Wes Waiting')
const UNCHECKED = row('unchecked', 'Uma Unchecked')

function roster(inserted: unknown[]) {
  server.use(
    table('profiles', [{ id: 'p', user_id: COACH.id, role: 'coach', full_name: 'Coach', invite_code: 'ABCD' }]),
    table('squad_players', [READY, WAITING, UNCHECKED]),
    table('coach_sessions', []),
    insertInto('coach_sessions', body => ({ id: 'session-1', ...body })),
    http.post(`${SUPABASE_URL}/rest/v1/session_attendance`, async ({ request }) => {
      inserted.push(...((await request.json()) as unknown[]))
      return new HttpResponse(null, { status: 201 })
    }),
    rpc('coach_squad_player_consent_required', ({ p_squad_player_id }) =>
      p_squad_player_id === 'ready' ? false
      : p_squad_player_id === 'waiting' ? true
      : { status: 500, body: { message: 'check failed' } }),
  )
}

describe('J4 attendance offers only consent-confirmed players', () => {
  beforeEach(() => signInAs(COACH))

  it('training: saves attendance for the confirmed player alone and names the others', async () => {
    const inserted: unknown[] = []
    roster(inserted)
    const user = userEvent.setup()
    renderApp('/coach/sessions/add')

    await screen.findByRole('button', { name: /Rea Ready/ })
    expect(screen.queryByRole('button', { name: /Wes Waiting/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Uma Unchecked/ })).toBeNull()
    expect(screen.getByText(/Wes Waiting \(waiting for a parent\)/)).toBeInTheDocument()
    expect(screen.getByText(/Uma Unchecked \(consent couldn't be checked\)/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Technical/ }))
    await user.click(screen.getByRole('button', { name: 'ALL' }))
    await user.click(screen.getByRole('button', { name: 'Save session' }))

    await waitFor(() => expect(inserted).toHaveLength(1))
    expect(inserted[0]).toMatchObject({ squad_player_id: 'ready' })
  })

  it('match: only the confirmed player can be marked as played', async () => {
    roster([])
    renderApp('/coach/sessions/quick')

    await screen.findByText('Rea Ready')
    expect(screen.getAllByRole('button', { name: 'Mark played' })).toHaveLength(1)
    expect(screen.queryByText('Wes Waiting')).toBeNull()
  })
})
