import { cleanup, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { renderApp } from '../../../../tests/support/render-app'
import { signInAs } from '../../../../tests/support/session'
import { server } from '../../../../tests/msw/server'
import { rpc, rpcRows, table, SUPABASE_URL } from '../../../../tests/msw/supabase'

/**
 * TRAK-435 (Imad, 12 Nov): a match gets the coach's words, not a rating, in every academy. So the player's Home has no
 * card built on match ratings (season band, bands, streak, milestone, trend, "Your card is ready", "Your coach will
 * log your first match soon"), no quote under "Today", no goals and assists, and no card reveal, and it doesn't read
 * the matches at all. A player with rated matches from before is the case that used to show them.
 */
let matchesRead = 0
const rated = (id: string, rating: number) => ({ id, user_id: 'player-435', opponent: 'Aris U16', competition: 'League', created_at: '2026-10-01T10:00:00Z',
  match_date: '2026-10-01', computed_rating: rating, goals: 1, assists: 1 })

beforeEach(() => {
  localStorage.clear()
  matchesRead = 0
  signInAs({ id: 'player-435' })
  // An old count, as a player who saw the reveal before has: a new rated match used to open it.
  localStorage.setItem('trak_last_match_count_player-435', '1')
  server.use(
    table('profiles', [{ user_id: 'player-435', role: 'player', full_name: 'Giourkas Seitaridis' }]),
    http.get(`${SUPABASE_URL}/rest/v1/matches`, () => { matchesRead++; return HttpResponse.json([rated('m1', 7.5), rated('m2', 8), rated('m3', 6.5)]) }),
    table('player_details', []), table('squad_players', [{ id: 'squad-1', coach_user_id: 'coach-1' }]), table('coach_assessments', []),
    table('game_for_family', []), table('game_for_player', []), table('game_review_for_family', []),
    http.get(`${SUPABASE_URL}/rest/v1/coach_shared_feedback`, () => HttpResponse.json([])),
    rpcRows('child_events', []), rpcRows('season_plan_for_player', []),
    rpc('get_player_invites_for_current_user', () => []),
    rpc('my_consent_status', () => ({ required: false, invited_parent: null })),
  )
})
afterEach(cleanup)

describe('TRAK-435: the player Home waits for no match rating', () => {
  it('shows no rating card, quote, goals or reveal, and reads no matches', async () => {
    renderApp('/player/home')
    expect(await screen.findByRole('button', { name: /^Alerts/ })).toBeInTheDocument()
    for (const gone of ['THIS SEASON', 'Season bands', 'Next milestone', 'Trend', 'Today', 'Goals', 'Assists'])
      expect(screen.queryByText(gone, { exact: true })).toBeNull()
    for (const gone of [/Your card/, /log your first match/, /in a row/, /improving/, /has you in their squad/, /new match/i])
      expect(screen.queryByText(gone)).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(matchesRead).toBe(0)
  })
})
