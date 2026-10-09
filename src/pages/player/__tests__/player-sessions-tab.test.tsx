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
import { table, rpc } from '../../../../tests/msw/supabase'

const PLAYER = { id: 'player-sessions-tab' }
const MATCH = { id: 'match-1', user_id: PLAYER.id, opponent: 'Synthetic United', competition: 'League',
  match_date: '2026-10-03', created_at: '2026-10-03T18:00:00Z', team_score: 2, opponent_score: 1, computed_rating: 7.1 }
const TRAINING = { session_id: 'session-1', session_date: '2026-10-04', focus: ['Finishing'], attendance: 'present' }

beforeEach(() => {
  signInAs(PLAYER)
  server.use(
    table('coach_calendar_events', []), // TRAK-130: the Sessions tab also reads upcoming events
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
  it('is called Sessions, in the nav and the heading', async () => {
    renderApp('/player/matches')
    expect(await screen.findByRole('heading', { name: 'Sessions' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sessions' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Matches' })).toBeNull()
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
    expect(screen.queryByText(/No matches found/)).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Cup' }))
    expect(screen.getByText(/No matches found/)).toBeInTheDocument()
    expect(trainingShown()).toBeNull()
  })
})
