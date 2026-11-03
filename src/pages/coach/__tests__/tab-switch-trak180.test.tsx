import { describe, it, expect, afterEach } from 'vitest'
import { cleanup, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { renderApp } from '../../../../tests/support/render-app'
import { signInAs } from '../../../../tests/support/session'
import { server } from '../../../../tests/msw/server'
import { table, rpc, SUPABASE_URL } from '../../../../tests/msw/supabase'
import { forgetScreens, remember, remembered } from '@/lib/screen-memory'

/**
 * TRAK-180 (J4, Kostas on his iPhone, 15 Oct): switching tabs flashed an
 * all-Loading screen, then read everything again from nothing. A revisit now
 * shows what the screen last showed while the reads refresh it. (Squad's own
 * loading and empty states are tested in squad-views-trak250.)
 */
const COACH = { id: 'coach-1' }
const PLAYERS = [
  { id: 'sp-1', coach_user_id: COACH.id, player_name: 'Ade Okafor', position: 'Midfielder', created_at: '2026-09-01T00:00:00Z' },
  { id: 'sp-2', coach_user_id: COACH.id, player_name: 'Bo Lind', position: 'Defender', created_at: '2026-09-01T00:00:00Z' },
]
// TRAK-197: the overview lists the players, one row each (TRAK-211: on the Feedback tab).
const homeRow = (name: string) => screen.queryByRole('button', { name: new RegExp(`^Open ${name}'s profile`) })
// The overview reads the squad, assessments, sessions and attendance before its rows show:
// over 1 s on GitHub's runner (#367's run, 19 Oct), so allow 5 s like the other coach waits.
const HOME_LOAD = { timeout: 5000 }

/** The coach's reads; squad_players waits for `gate` when one is given. */
function coachReads(players: typeof PLAYERS | [], gate?: Promise<void>) {
  server.use(
    table('profiles', [{ id: 'p', user_id: COACH.id, role: 'coach', full_name: 'Coach Vasilis', invite_code: 'ABCD' }]),
    table('coach_details', [{ user_id: COACH.id, team: 'U15s', coach_role: 'Head Coach' }]),
    table('coach_assessments', []),
    table('session_attendance', []),
    rpc('coach_squad_player_consent_required', () => false),
    rpc('feature_on', () => true),
    // TRAK-286: no game plan, shared or not.
    table('game_plans', []),
    table('game_shares', []),
    rpc('game_plan_changes', () => []),
    http.get(`${SUPABASE_URL}/rest/v1/coach_sessions`, ({ request }) =>
      new URL(request.url).searchParams.get('limit') === '1'
        ? HttpResponse.json([])
        : HttpResponse.json([], { headers: { 'Content-Range': '*/0' } })),
    http.get(`${SUPABASE_URL}/rest/v1/squad_players`, async () => {
      if (gate) await gate
      return HttpResponse.json(players)
    }),
  )
}

afterEach(() => { cleanup(); forgetScreens() })

// TRAK-259: Feedback left the coach's nav; Home is the glass tab bar's, and Back returns to Feedback.
const toHome = () => userEvent.click(screen.getByRole('tab', { name: 'Home' }))
const backToFeedback = async () => {
  window.history.back()
  await waitFor(() => expect(window.location.pathname).toBe('/coach/feedback'))
}

describe('TRAK-180 switching between Home and the overview tab', () => {
  it('going back to Feedback shows what it last showed at once, then refreshes', async () => {
    signInAs(COACH)
    coachReads(PLAYERS)
    renderApp('/coach/feedback')
    await waitFor(() => expect(homeRow('Bo Lind')).not.toBeNull(), HOME_LOAD)

    // From here every squad read is held: only the memory can show players.
    let release!: () => void
    coachReads(PLAYERS, new Promise<void>(resolve => { release = resolve }))
    await toHome()
    await screen.findByRole('heading', { name: 'Coach Vasilis' })

    await backToFeedback()
    expect(homeRow('Ade Okafor')).not.toBeNull()
    expect(screen.queryByRole('status', { name: 'Loading your players…' })).toBeNull()
    release()
    await waitFor(() => expect(homeRow('Bo Lind')).not.toBeNull(), HOME_LOAD)
  }, 20_000) // four tab switches take longer than 5 s on GitHub's runners

  it("a revisit whose assessments read fails doesn't show the last visit's players", async () => {
    signInAs(COACH)
    coachReads(PLAYERS)
    renderApp('/coach/feedback')
    await waitFor(() => expect(homeRow('Ade Okafor')).not.toBeNull(), HOME_LOAD)
    await toHome()
    await screen.findByRole('heading', { name: 'Coach Vasilis' })

    // The assessments decide each level, so a failed read can't keep the old list.
    server.use(http.get(`${SUPABASE_URL}/rest/v1/coach_assessments`, () =>
      HttpResponse.json({ message: 'unavailable' }, { status: 500 })))
    await backToFeedback()
    expect(await screen.findByText(/Couldn't load your players/)).toBeInTheDocument()
    expect(homeRow('Ade Okafor')).toBeNull()
  }, 20_000)

  it("keeps each account's screens apart, and forgets them all on sign-out", () => {
    remember('coach-squad', 'coach-1', { players: PLAYERS })
    expect(remembered('coach-squad', 'coach-1')).toEqual({ players: PLAYERS })
    expect(remembered('coach-squad', 'coach-2')).toBeUndefined()
    expect(remembered('coach-squad', null)).toBeUndefined()
    forgetScreens()
    expect(remembered('coach-squad', 'coach-1')).toBeUndefined()
  })
})
