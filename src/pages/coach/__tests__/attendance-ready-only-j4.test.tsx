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

    // The file's first render loads the session screen cold; on a busy CI
    // runner that took over the default 1 s (run 36270474713).
    await screen.findByRole('button', { name: /Rea Ready/ }, { timeout: 5000 })
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

  it('a failed roster load says so and can be retried; it is never "No squad yet"', async () => {
    roster([])
    let calls = 0
    server.use(http.get(`${SUPABASE_URL}/rest/v1/squad_players`, () => {
      calls++
      return calls === 1
        ? HttpResponse.json({ message: 'roster unavailable', code: 'XX000' }, { status: 400 })
        : HttpResponse.json([READY])
    }))
    const user = userEvent.setup()
    renderApp('/coach/sessions/add')

    expect(await screen.findByText(/Couldn't load your squad/)).toBeInTheDocument()
    expect(screen.queryByText(/No squad yet/)).toBeNull()
    expect(screen.queryByRole('button', { name: /Rea Ready/ })).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('button', { name: /Rea Ready/ })).toBeInTheDocument()
    expect(screen.queryByText(/Couldn't load your squad/)).toBeNull()
  })

  // TRAK-72: a squad still loading is not an empty one, and coaches don't add
  // players (the academy roster does, #164).
  it('says the squad is loading until the read answers, then that the academy adds players', async () => {
    roster([])
    let release!: () => void
    const held = new Promise<void>(resolve => { release = resolve })
    let asked = false
    server.use(http.get(`${SUPABASE_URL}/rest/v1/squad_players`, async () => {
      asked = true
      await held
      return HttpResponse.json([])
    }))
    renderApp('/coach/sessions/quick')

    await waitFor(() => expect(asked).toBe(true), { timeout: 5000 })
    expect(screen.getByText('Loading your squad…')).toBeInTheDocument()
    expect(screen.queryByText(/No squad yet/)).toBeNull()

    release()
    expect(await screen.findByText('No squad yet. Players appear here once your academy adds them.')).toBeInTheDocument()
    expect(screen.queryByText('Loading your squad…')).toBeNull()
    expect(screen.queryByText(/Add players from the Squad tab/)).toBeNull()
  })

  it('match: only the confirmed player can be marked as played', async () => {
    roster([])
    renderApp('/coach/sessions/quick')

    await screen.findByText('Rea Ready')
    expect(screen.getAllByRole('button', { name: 'Mark played' })).toHaveLength(1)
    expect(screen.queryByText('Wes Waiting')).toBeNull()
  })
})
