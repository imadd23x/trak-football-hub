/**
 * TRAK-437: the position under the name on Home and on the Profile is the one the coach set, not the one saved when the
 * account was made. Where the coach has set none (or the plan is not shared), none shows. One place owns it: the season
 * plan's read, the same one the My season card uses.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, screen } from '@testing-library/react'
import { renderApp } from '../../../../tests/support/render-app'
import { signInAs } from '../../../../tests/support/session'
import { server } from '../../../../tests/msw/server'
import { table, rpc, rpcRows } from '../../../../tests/msw/supabase'

// A new id each test: the app's query cache lives for the file, and the season plan is cached per user.
let n = 0
let PLAYER = { id: 'player-437' }
const match = () => ({
  id: 'm-437', user_id: PLAYER.id, created_at: '2026-10-11T11:00:00Z', match_date: '2026-10-11',
  opponent: 'Panathinaikos U16', competition: 'League', venue: 'Municipal Ground', home_away: 'home',
  team_score: 2, opponent_score: 1, computed_rating: 7.5, minutes_played: 70, goals: 1, assists: 0, position: 'Attacker', age_group: 'U16',
})
const PLAN = { squad_player_id: 'sq-437', squad: 'U16', coach_name: 'Coach Rami', time_zone: 'Asia/Dubai', starts_on: '2026-09-01', ends_on: '2027-06-30',
  eval_every: 'month', eval_day: 0, last_evaluation_on: null, position: 'Midfielder', also_plays: [], roles: [], season_objectives: [], objectives: [],
  is_new: false, shared_at: '2026-11-01T10:00:00Z' }

beforeEach(() => {
  PLAYER = { id: `player-437-${++n}` }
  signInAs(PLAYER)
  server.use(
    table('profiles', [{ id: 'p', user_id: PLAYER.id, role: 'player', full_name: 'Kostas Tsimikas' }]),
    // The sign-up position is Attacker; the coach has made them a Midfielder.
    table('player_details', [{ position: 'Attacker', current_club: 'Rehearsal Athens', age_group: 'U16' }]),
    table('matches', [match()]), table('squad_players', []), table('coach_assessments', []), table('coach_shared_feedback', []),
    table('recognition_awards', []), rpcRows('child_events', []),
    rpc('get_player_invites_for_current_user', () => []),
    rpc('my_consent_status', () => ({ required: false, invited_parent: null })),
  )
})
afterEach(() => cleanup())

describe('TRAK-437: the position the coach set', () => {
  it("shows the coach's position on Home, not the sign-up one", async () => {
    server.use(rpcRows('season_plan_for_player', [PLAN]))
    renderApp('/player/home')
    expect(await screen.findByText('Midfielder · Rehearsal Athens · U16')).toBeInTheDocument()
    expect(screen.queryByText(/Attacker/)).toBeNull()
  })

  it("shows the coach's position on the Profile tag, not the sign-up one", async () => {
    server.use(rpcRows('season_plan_for_player', [PLAN]))
    renderApp('/player/profile')
    expect(await screen.findByText('Midfielder')).toBeInTheDocument()
    expect(screen.queryByText('Attacker')).toBeNull()
  })

  it('shows no position where the plan is not shared, never the sign-up value', async () => {
    server.use(rpcRows('season_plan_for_player', []))
    renderApp('/player/home')
    expect(await screen.findByText('Rehearsal Athens · U16')).toBeInTheDocument()
    expect(screen.queryByText(/Attacker/)).toBeNull()
  })

  it('shows no position where the coach has set none', async () => {
    server.use(rpcRows('season_plan_for_player', [{ ...PLAN, position: null }]))
    renderApp('/player/home')
    expect(await screen.findByText('Rehearsal Athens · U16')).toBeInTheDocument()
  })
})
