/**
 * TRAK-397 (Season plan 18/18 build 2/8, spec TRAK-366): the My season card on the player's Home. It shows what the
 * coach shared (squad objectives as words, the player's own with the latest word), wears New and a Got it until the
 * player taps it, gets New back after a later share, and shows nothing when the database returns no plan (not shared,
 * switch off, consent withdrawn) or when the read fails. The function (TRAK-396) decides who may read; this is the
 * screen. Test people are named after footballers.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderApp } from '../../../../tests/support/render-app'
import { signInAs } from '../../../../tests/support/session'
import { server } from '../../../../tests/msw/server'
import { table, rpc, rpcRows, rpcError } from '../../../../tests/msw/supabase'

// A new id per test: the app's query cache is keyed by user, so a shared id would carry one test's card into the next.
let n = 0
let PLAYER = { id: 'player-397' }
let isNew = true
let seenCalls: Record<string, unknown>[] = []

const PLAN = () => ({
  squad_player_id: 'sq-397', squad: 'U16', coach_name: 'Otto Rehhagel', time_zone: 'Asia/Dubai',
  starts_on: '2026-09-01', ends_on: '2027-06-30', eval_every: 'month', eval_day: 0, last_evaluation_on: '2026-11-01',
  position: 'Defender', also_plays: ['Midfielder'], roles: ['Ball-playing centre back'],
  season_objectives: [
    { id: 'so-1', place: 1, title: 'Win it back within 5 seconds', looks_like: 'The nearest three press.' },
    { id: 'so-2', place: 2, title: 'Stay compact', looks_like: 'No more than 35 m.' },
  ],
  objectives: [
    { id: 'po-1', slot: 1, title: 'Holds the line together', status: 'open', current: 'on_track', supports: null,
      history: [{ due_on: '2026-10-04', status: 'not_yet' }, { due_on: '2026-11-01', status: 'on_track' }] },
    { id: 'po-2', slot: 2, title: 'Talks to the keeper at every corner', status: 'open', current: 'some_progress', supports: null, history: [] },
    { id: 'po-3', slot: 3, title: 'Plays out from the back', status: 'open', current: null, supports: null, history: [] },
  ],
  is_new: isNew, shared_at: '2026-11-01T10:00:00Z',
})

function setup(plan: () => object[] = () => [PLAN()]) {
  server.use(
    table('profiles', [{ id: 'p', user_id: PLAYER.id, role: 'player', full_name: 'Theodoros Zagorakis' }]),
    table('player_details', [{ position: 'Defender', current_club: 'Rehearsal Athens', age_group: 'U16' }]),
    table('matches', []), table('squad_players', []),
    table('coach_assessments', []), table('coach_shared_feedback', []), table('recognition_awards', []),
    rpcRows('child_events', []),
    rpc('get_player_invites_for_current_user', () => []),
    rpc('my_consent_status', () => ({ required: false, invited_parent: null })),
    rpc('season_plan_for_player', () => plan()),
    rpc('mark_season_plan_seen', args => { seenCalls.push(args); isNew = false; return null }),
  )
}

beforeEach(() => { isNew = true; seenCalls = []; PLAYER = { id: `player-397-${++n}` }; signInAs(PLAYER) })
afterEach(() => cleanup())

describe('TRAK-397: the My season card on player Home', () => {
  it('shows the squad objectives as words and the player\'s own with their latest word', async () => {
    setup()
    renderApp('/player/home')
    const card = await screen.findByRole('region', { name: 'My season' })
    expect(within(card).getByText('Win it back within 5 seconds')).toBeInTheDocument()
    expect(within(card).getByText('Stay compact')).toBeInTheDocument()
    // The page carries "what it looks like"; the card does not.
    expect(within(card).queryByText('The nearest three press.')).toBeNull()
    expect(within(card).getByText('Holds the line together').parentElement).toHaveTextContent('On track')
    expect(within(card).getByText('Talks to the keeper at every corner').parentElement).toHaveTextContent('Some progress')
    // Before the first evaluation an objective has no word, not an invented one.
    expect(within(card).getByText('Plays out from the back').parentElement).toHaveTextContent(/^Plays out from the back$/)
    // The squad's measure is the coach's: no Good, Watch or At risk, no match counts.
    expect(within(card).queryByText(/Good|Watch|At risk|match/i)).toBeNull()
    expect(within(card).getByRole('button', { name: 'Open my season' })).toBeInTheDocument()
  })

  it('wears New and Got it until the player taps Got it, then both go', async () => {
    setup()
    renderApp('/player/home')
    const card = await screen.findByRole('region', { name: 'My season' })
    expect(within(card).getByText('New')).toBeInTheDocument()
    await userEvent.click(within(card).getByRole('button', { name: 'Got it' }))
    await waitFor(() => expect(seenCalls).toEqual([{}]))
    // The re-read after the tap: the function now says it is no longer new.
    await waitFor(() => expect(within(screen.getByRole('region', { name: 'My season' })).queryByText('New')).toBeNull())
    expect(screen.queryByRole('button', { name: 'Got it' })).toBeNull()
    // Opening the page stays possible once it is cleared.
    expect(screen.getByRole('button', { name: 'Open my season' })).toBeInTheDocument()
  })

  it('brings New and Got it back when the coach shares a change', async () => {
    isNew = false
    setup()
    renderApp('/player/home')
    const card = await screen.findByRole('region', { name: 'My season' })
    expect(within(card).queryByText('New')).toBeNull()
    expect(within(card).queryByRole('button', { name: 'Got it' })).toBeNull()
    cleanup()
    isNew = true // a later Share stamped a change after the player last looked
    PLAYER = { id: `player-397-${++n}` }; signInAs(PLAYER) // a fresh visit: no cached card
    setup()
    renderApp('/player/home')
    const again = await screen.findByRole('region', { name: 'My season' })
    expect(within(again).getByText('New')).toBeInTheDocument()
    expect(within(again).getByRole('button', { name: 'Got it' })).toBeInTheDocument()
  })

  it('shows Met on a closed objective', async () => {
    const met = { ...PLAN(), objectives: [{ id: 'po-9', slot: 1, title: 'Scans before receiving', status: 'met', current: 'on_track', supports: null, history: [] }] }
    setup(() => [met])
    renderApp('/player/home')
    const card = await screen.findByRole('region', { name: 'My season' })
    expect(within(card).getByText('Scans before receiving').parentElement).toHaveTextContent('Met')
  })

  it('shows no card when the function returns no plan (not shared, switch off, consent withdrawn)', async () => {
    setup(() => [])
    renderApp('/player/home')
    expect(await screen.findByText('Rehearsal Athens · U16')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('region', { name: 'My season' })).toBeNull())
    expect(screen.queryByText('My season')).toBeNull()
  })

  it('shows no card when the read fails, and the rest of Home is untouched', async () => {
    setup()
    server.use(rpcError('season_plan_for_player', 500, { message: 'boom' }))
    renderApp('/player/home')
    expect(await screen.findByText('Rehearsal Athens · U16')).toBeInTheDocument()
    expect(await screen.findByText('Theodoros Zagorakis')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'My season' })).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
