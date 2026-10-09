import { describe, it, expect, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { renderApp } from '../../../../tests/support/render-app'
import { signInAs } from '../../../../tests/support/session'
import { server } from '../../../../tests/msw/server'
import { table, insertInto, rpc, SUPABASE_URL } from '../../../../tests/msw/supabase'

/**
 * TRAK-151 (J4). Since TRAK-149 the database refuses a match row on purpose,
 * with a sentence written for the coach ("This match is already saved as
 * 1-0 …"). A saved match can't be edited or deleted, so "press save again"
 * can never fix that: the coach must see why. A failure a retry can fix (the
 * connection, the server) still says to press save again.
 */

const COACH = { id: 'coach-1' }
const PLAYER = {
  id: 'squad-1', coach_user_id: COACH.id, player_name: 'Ade Okafor', linked_player_id: 'player-1',
  position: 'Attacker', age_group: 'U16', age: 15,
}
const toastText = () => [...document.querySelectorAll('[data-sonner-toast]')].map(t => t.textContent ?? '').join(' | ')

function fixtures(matchRpc: () => Response) {
  server.use(
    table('profiles', [{ id: 'p-coach', user_id: COACH.id, role: 'coach', full_name: 'Coach Vasilis', invite_code: 'ABCD' }]),
    table('squad_players', [PLAYER]),
    table('coach_sessions', []),
    insertInto('coach_sessions', body => ({ id: 'session-1', ...body })),
    insertInto('session_attendance', body => ({ id: 'att-1', ...body })),
    rpc('coach_squad_player_consent_required', () => false),
    http.post(`${SUPABASE_URL}/rest/v1/rpc/log_match_for_player`, matchRpc),
  )
}

async function saveOneZeroWin() {
  const user = userEvent.setup()
  renderApp('/coach/sessions/quick')
  await user.type(await screen.findByPlaceholderText('Opponent name'), 'Olympiakos U16')
  const [scoreUs, scoreThem] = screen.getAllByPlaceholderText('0')
  await user.type(scoreUs, '1')
  await user.type(scoreThem, '0')
  await user.click(await screen.findByRole('button', { name: 'Mark played' }))
  await user.type(screen.getByRole('spinbutton', { name: `Minutes played by ${PLAYER.player_name}` }), '70')
  await user.click(screen.getByRole('button', { name: `One fewer goals for ${PLAYER.player_name}` }))
  await user.click(screen.getByRole('button', { name: `One fewer assists for ${PLAYER.player_name}` }))
  await user.click(screen.getByRole('button', { name: 'Save match' }))
}

describe('J4: a refused match save says why', () => {
  beforeEach(() => signInAs(COACH))

  it("shows the database's reason by the player, and doesn't promise a retry", async () => {
    // PostgREST's answer to RAISE EXCEPTION in log_match_for_player (TRAK-149).
    fixtures(() => HttpResponse.json({
      code: 'P0001', details: null, hint: null,
      message: 'This match is already saved as 2-0; every player in it needs the same score',
    }, { status: 400 }))
    await saveOneZeroWin()
    await waitFor(() => expect(toastText()).toMatch(/did not record/))
    expect(toastText()).toContain('Ade Okafor: This match is already saved as 2-0; every player in it needs the same score')
    expect(toastText()).not.toMatch(/press save again/i)
  }, 20_000)

  it("names the child, not their id, when the reason is consent", async () => {
    fixtures(() => HttpResponse.json({
      code: '42501', details: null, hint: null,
      message: 'Waiting for parent: nothing is recorded about player 3f1c2b9a-4d5e-4f60-8a71-92b3c4d5e6f7 until a parent approves',
    }, { status: 403 }))
    await saveOneZeroWin()
    await waitFor(() => expect(toastText()).toMatch(/did not record/))
    expect(toastText()).toContain('nothing is recorded about player Ade Okafor until a parent approves')
    expect(toastText()).not.toMatch(/3f1c2b9a/)
  }, 20_000)

  it('still says to press save again when the connection failed', async () => {
    fixtures(() => HttpResponse.json({ message: 'upstream timeout' }, { status: 503 }))
    await saveOneZeroWin()
    await waitFor(() => expect(toastText()).toMatch(/did not record/))
    expect(toastText()).toMatch(/Ade Okafor/)
    expect(toastText()).toMatch(/Press save again to retry just those/)
  }, 20_000)
})
