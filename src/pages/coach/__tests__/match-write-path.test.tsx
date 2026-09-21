import { describe, it, expect, beforeEach } from 'vitest'
import { cleanup, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { renderApp } from '../../../../tests/support/render-app'
import { signInAs } from '../../../../tests/support/session'
import { server } from '../../../../tests/msw/server'
import { table, insertInto, SUPABASE_URL } from '../../../../tests/msw/supabase'

/**
 * What the coach's form actually sends, driven through the rendered screen and
 * the real Supabase SDK.
 *
 * The defect this exists to catch: `goalsKey()` collapsed every count of two or
 * more to `'2+'`, for every position. The attacker branch of `computeMatchScore`
 * reads `'1'`, `'2'` and `'3+'` — it has no `'2+'` case — so an attacker's brace
 * fell through to no credit at all and rated identically to not scoring. The
 * unit tests were green throughout, because the mapping and the engine were each
 * correct in isolation and nothing asserted the pair.
 *
 * So this test deliberately goes the whole way: render, tap, save, and read what
 * left the client. A test that called `goalsKey` directly would have agreed with
 * the bug.
 *
 * It lives under src/ rather than beside the MSW harness it borrows, because
 * `npm test` is `vitest run src` — a file in tests/ outside tests/msw and
 * tests/support is collected by no CI step at all, and a test that never runs
 * is worse than no test. Hence the reach back up for the harness.
 *
 * One mount at a time. Four blocks mounting one page into a single jsdom in #44
 * left exactly one mounted and which one varied between runs, so each pass here
 * cleans up before the next renders.
 */

const COACH = { id: 'coach-1' }

/** 'Attacker' so mapPosition() resolves 'att' — the finer scale, and the one
 *  the collapsed key silently emptied. linked_player_id is required or the
 *  player is skipped before the RPC is ever reached. */
const STRIKER = {
  id: 'squad-1',
  coach_user_id: COACH.id,
  player_name: 'Ade Okafor',
  linked_player_id: 'player-1',
  position: 'Attacker',
  age: 15,
}

type RpcBody = Record<string, unknown>

/** Every log_match_for_player call the client made, in order. */
function captureMatchRpc(): RpcBody[] {
  const calls: RpcBody[] = []
  server.use(
    table('profiles', [
      { id: 'p-coach', user_id: COACH.id, role: 'coach', full_name: 'Coach Vasilis', invite_code: 'ABCD' },
    ]),
    table('squad_players', [STRIKER]),
    // The destination after a successful save.
    table('coach_sessions', []),
    insertInto('coach_sessions', body => ({ id: 'session-1', ...body })),
    insertInto('session_attendance', body => ({ id: 'att-1', ...body })),
    http.post(`${SUPABASE_URL}/rest/v1/rpc/log_match_for_player`, async ({ request }) => {
      calls.push((await request.json()) as RpcBody)
      return HttpResponse.json(null)
    }),
  )
  return calls
}

/**
 * Log one match for the striker with `goals` goals and `assists` assists, and
 * resolve once the RPC has been called.
 *
 * `scoreUs` is 4 because the rules refuse a player scoring more than the team
 * did — a hat-trick in a 0-0 is correctly impossible, and would fail this test
 * for the wrong reason.
 */
async function logMatch(
  calls: RpcBody[],
  { goals = 0, assists = 0 }: { goals?: number; assists?: number },
): Promise<RpcBody> {
  const before = calls.length
  const user = userEvent.setup()

  // /sessions/quick opens on Match, so the type chip needs no tap.
  renderApp('/coach/sessions/quick')

  await user.type(await screen.findByPlaceholderText('Opponent name'), 'Olympiakos U16')
  const [scoreUs, scoreThem] = screen.getAllByPlaceholderText('0')
  await user.type(scoreUs, '4')
  await user.type(scoreThem, '1')

  // Marking played auto-expands the row, which is what renders the steppers.
  await user.click(await screen.findByRole('button', { name: 'Mark played' }))

  for (let i = 0; i < goals; i++) {
    await user.click(screen.getByRole('button', { name: `One more goals for ${STRIKER.player_name}` }))
  }
  for (let i = 0; i < assists; i++) {
    await user.click(screen.getByRole('button', { name: `One more assists for ${STRIKER.player_name}` }))
  }

  await user.click(screen.getByRole('button', { name: 'Save match' }))
  await waitFor(() => expect(calls.length).toBe(before + 1))

  cleanup()
  return calls[before]
}

describe('what the coach records reaches the database and the rating', () => {
  beforeEach(() => signInAs(COACH))

  it('stores the exact count, and pays an attacker on the attacker scale', async () => {
    const calls = captureMatchRpc()

    const none  = await logMatch(calls, { goals: 0 })
    const brace = await logMatch(calls, { goals: 2 })
    const hat   = await logMatch(calls, { goals: 3 })

    // The record is the real number, not the rating bucket. Before this, a
    // hat-trick was stored as 2 because 2 was the highest the form could say.
    expect(none.p_goals).toBe(0)
    expect(brace.p_goals).toBe(2)
    expect(hat.p_goals).toBe(3)

    // And the rating moves with it. `'2+'` sent to the attacker branch matched
    // no case, so this assertion failed with brace === none: a striker who
    // scored twice was rated exactly as if they had not scored.
    expect(brace.p_computed_rating as number).toBeGreaterThan(none.p_computed_rating as number)
    expect(hat.p_computed_rating as number).toBeGreaterThan(brace.p_computed_rating as number)
  })

  it('keys assists on the assists scale, which is not the goals one', async () => {
    const calls = captureMatchRpc()

    // Assists read '1' and '2+' at every position, including attacker. Reusing
    // the position-aware goals helper here would send an attacker's third
    // assist as '3+' — a key the assists branch has no case for — and the
    // credit would vanish exactly the way the goals credit did. Three, not
    // two, because two is where the two scales still agree.
    const none  = await logMatch(calls, { assists: 0 })
    const three = await logMatch(calls, { assists: 3 })

    expect(three.p_assists).toBe(3)
    expect(three.p_computed_rating as number).toBeGreaterThan(none.p_computed_rating as number)
  })
})
