/**
 * TRAK-194 (Kostas, 16 Oct list, items 12 + 13): player Home.
 * 12. Under the header, one quiet line like the parent's ("Attacker · Rehearsal
 *     Athens · U16"), not "Good morning" and the Active / position / club chips,
 *     which looked like buttons.
 * 13. No "Recent matches": the Sessions tab lists every match.
 * Replaces TRAK-70's greeting test: there is no greeting any more.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, screen } from '@testing-library/react'
import { renderApp } from '../../../../tests/support/render-app'
import { signInAs } from '../../../../tests/support/session'
import { server } from '../../../../tests/msw/server'
import { table, rpc, rpcRows } from '../../../../tests/msw/supabase'

const PLAYER = { id: 'player-194' }
const MATCH = {
  id: 'm-194', user_id: PLAYER.id, created_at: '2026-10-11T11:00:00Z', match_date: '2026-10-11',
  opponent: 'Panathinaikos U16', competition: 'League', venue: 'Municipal Ground', home_away: 'home',
  team_score: 2, opponent_score: 1, computed_rating: 7.5, minutes_played: 70, goals: 1, assists: 0,
  position: 'Attacker', age_group: 'U16',
}

beforeEach(() => {
  signInAs(PLAYER)
  server.use(
    table('profiles', [{ id: 'p', user_id: PLAYER.id, role: 'player', full_name: 'Kostas Tsimikas' }]),
    table('player_details', [{ position: 'Attacker', current_club: 'Rehearsal Athens', age_group: 'U16' }]),
    table('matches', [MATCH]), table('squad_players', []),
    table('coach_assessments', []), table('coach_shared_feedback', []), table('recognition_awards', []),
    rpcRows('child_events', []),
    rpcRows('season_plan_for_player', []), // TRAK-437: the position is the coach's, from the season plan's read
    rpc('get_player_invites_for_current_user', () => []),
    rpc('my_consent_status', () => ({ required: false, invited_parent: null })),
  )
})
afterEach(() => cleanup())

describe('TRAK-194: player Home', () => {
  it('12. shows one quiet line under the header, with no greeting or chips', async () => {
    renderApp('/player/home')
    expect(await screen.findByText('Kostas Tsimikas')).toBeInTheDocument()
    expect(await screen.findByText('Rehearsal Athens · U16')).toBeInTheDocument()
    expect(screen.queryByText(/^Good (morning|afternoon|evening)$/)).toBeNull()
    expect(screen.queryByText('Active')).toBeNull()
    expect(screen.queryByText('Rehearsal Athens U16')).toBeNull()
  })

  it('13. has no "Recent matches"; Sessions still lists the match', async () => {
    renderApp('/player/home')
    await screen.findByText('Rehearsal Athens · U16')
    expect(screen.queryByText('RECENT MATCHES')).toBeNull()
    expect(screen.queryByText('vs Panathinaikos U16')).toBeNull()
    cleanup()
    renderApp('/player/matches')
    expect(await screen.findByText(/Panathinaikos U16/)).toBeInTheDocument()
  })
})
