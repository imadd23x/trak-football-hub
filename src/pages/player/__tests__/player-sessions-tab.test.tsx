/**
 * TRAK-112 (J6, run 4, 4 Oct): the player's Matches tab also lists the
 * training the coach logged, but the League/Cup/Friendly chips only filtered
 * the matches, so training stayed under "No matches found". Decision on the
 * call: the tab is "Sessions", with a Training chip.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderApp } from '../../../../tests/support/render-app'
import { signInAs } from '../../../../tests/support/session'
import { server } from '../../../../tests/msw/server'
import { table, rpc, rpcRows } from '../../../../tests/msw/supabase'

const PLAYER = { id: 'player-sessions-tab' }
const MATCH = { id: 'match-1', user_id: PLAYER.id, opponent: 'Synthetic United', competition: 'League',
  match_date: '2026-10-03', created_at: '2026-10-03T18:00:00Z', team_score: 2, opponent_score: 1, computed_rating: 7.1 }
const TRAINING = { session_id: 'session-1', session_date: '2026-10-04', focus: ['Finishing'], attendance: 'present' }

beforeEach(() => {
  signInAs(PLAYER)
  server.use(
    // TRAK-286: no roster row, so no shared game plan.
    table('squad_players', []),
    rpcRows('child_events', []), // TRAK-130: the Sessions tab also reads upcoming events
    table('profiles', [{ id: 'p', user_id: PLAYER.id, role: 'player', full_name: 'Synthetic Player' }]),
    table('matches', [MATCH]),
    rpc('family_training_history', () => [TRAINING]),
    rpc('my_consent_status', () => ({ required: false, invited_parent: null })),
  )
})
afterEach(() => cleanup())

const matchShown = () => screen.queryByText('vs Synthetic United')
const trainingShown = () => screen.queryByRole('region', { name: 'Training' })

describe('TRAK-112: the player Sessions tab', () => {
  // TRAK-440 (Imad, 12 Nov): the tab is Matches; the page keeps its heading until its own slice (TRAK-441, 4).
  it('is the Matches tab, marked as the open tab', async () => {
    renderApp('/player/matches')
    expect(await screen.findByRole('heading', { name: 'Sessions' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Matches' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByRole('tab', { name: 'Sessions' })).toBeNull()
  })

  it('All shows matches and training; League only matches; Training only training', async () => {
    renderApp('/player/matches')
    expect(await screen.findByText('vs Synthetic United')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('Finishing', { exact: false })).toBeInTheDocument())
    expect(trainingShown()).not.toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'League' }))
    expect(matchShown()).not.toBeNull()
    expect(trainingShown()).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Training' }))
    expect(trainingShown()).not.toBeNull()
    expect(matchShown()).toBeNull()
    expect(screen.queryByText(/No past .*matches yet/)).toBeNull()

    // TRAK-438: the coach's three words; no Cup chip.
    expect(screen.queryByRole('button', { name: 'Cup' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Tournament' }))
    // TRAK-170: the list is past matches, so it says so, for the chosen competition.
    expect(screen.getByText('No past tournament matches yet.')).toBeInTheDocument()
    expect(trainingShown()).toBeNull()
  })

  // TRAK-438: a match published as a tournament is under Tournament; one logged before as "Cup" counts as one too.
  it('Tournament holds tournament matches, and an old "Cup" one', async () => {
    server.use(table('matches', [
      { ...MATCH, id: 'match-t', opponent: 'Tournament Rovers', competition: 'Tournament' },
      { ...MATCH, id: 'match-c', opponent: 'Old Cup City', competition: 'Cup', match_date: '2026-09-20', created_at: '2026-09-20T18:00:00Z' },
      MATCH,
    ]))
    renderApp('/player/matches')
    expect(await screen.findByText('vs Tournament Rovers')).toBeInTheDocument()
    expect(screen.getAllByRole('button').map(b => b.textContent)).toEqual(expect.arrayContaining(['All', 'League', 'Tournament', 'Friendly', 'Training']))
    await userEvent.click(screen.getByRole('button', { name: 'Tournament' }))
    expect(screen.getByText('vs Tournament Rovers')).toBeInTheDocument()
    expect(screen.getByText('vs Old Cup City')).toBeInTheDocument()
    expect(matchShown()).toBeNull()
  })
})
