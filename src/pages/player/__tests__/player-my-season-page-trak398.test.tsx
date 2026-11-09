/**
 * TRAK-398 (Season plan 18/18 build 3/8, spec TRAK-366): the player's My season page. Position, the squad's objectives
 * with what each looks like, the player's own with their word now and one row per published evaluation, the coach and
 * the next evaluation in the subtitle. Read-only; opening it clears New; Back returns to Home. The function (TRAK-396)
 * leaves out removed objectives and unshared players; this is the screen. Test people are named after footballers.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderApp } from '../../../../tests/support/render-app'
import { signInAs } from '../../../../tests/support/session'
import { server } from '../../../../tests/msw/server'
import { table, rpc, rpcRows, rpcError } from '../../../../tests/msw/supabase'

// A new id per test: the app's query cache is keyed by user.
let n = 0
let PLAYER = { id: 'player-398' }
let isNew = true
let seenCalls: Record<string, unknown>[] = []

const PLAN = (over: object = {}) => ({
  squad_player_id: 'sq-398', squad: 'U16', coach_name: 'Otto Rehhagel', time_zone: 'Asia/Dubai',
  // Dates far ahead, so the next evaluation is always one the plan has not reached.
  starts_on: '2099-01-01', ends_on: '2099-12-31', eval_every: 'month', eval_day: 0, last_evaluation_on: null,
  position: 'Defender', also_plays: ['Midfielder'], roles: ['Ball-playing centre back'],
  season_objectives: [
    { id: 'so-1', place: 1, title: 'Win it back within 5 seconds', looks_like: 'The nearest three press.' },
    { id: 'so-2', place: 2, title: 'Stay compact', looks_like: 'No more than 35 m.' },
  ],
  objectives: [
    { id: 'po-1', slot: 1, title: 'Holds the line together', status: 'open', current: 'on_track', supports: null,
      history: [{ due_on: '2026-10-04', status: 'not_yet' }, { due_on: '2026-11-01', status: 'on_track' }] },
    { id: 'po-2', slot: 2, title: 'Scans before receiving', status: 'met', current: 'met', supports: null,
      history: [{ due_on: '2026-10-04', status: 'on_track' }, { due_on: '2026-11-01', status: 'met' }] },
  ],
  is_new: isNew, shared_at: '2099-01-01T10:00:00Z', ...over,
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

beforeEach(() => { isNew = true; seenCalls = []; PLAYER = { id: `player-398-${++n}` }; signInAs(PLAYER) })
afterEach(() => cleanup())

describe('TRAK-398: the player\'s My season page', { timeout: 30_000 }, () => {
  it('shows the position, the squad objectives with what they look like, and the coach and next evaluation', async () => {
    setup()
    renderApp('/player/season')
    expect(await screen.findByRole('heading', { name: 'My season' })).toBeInTheDocument()
    expect(screen.getByText(/^Set by Otto Rehhagel\. Next evaluation \w{3} \d{1,2} \w{3} 2099\.$/)).toBeInTheDocument()
    const position = screen.getByRole('region', { name: 'Your position' })
    expect(within(position).getByText('Defender')).toBeInTheDocument()
    expect(within(position).getByText('Can also play Midfielder')).toBeInTheDocument()
    expect(within(position).getByText('Ball-playing centre back')).toBeInTheDocument()
    const squad = screen.getByRole('region', { name: 'Squad objectives' })
    expect(within(squad).getByText('Win it back within 5 seconds')).toBeInTheDocument()
    expect(within(squad).getByText('The nearest three press.')).toBeInTheDocument()
    expect(within(squad).getByText('Stay compact')).toBeInTheDocument()
    expect(within(squad).getByText('No more than 35 m.')).toBeInTheDocument()
  })

  it('lists the player\'s objectives with their word now and one history row per evaluation, oldest first', async () => {
    setup()
    renderApp('/player/season')
    const own = await screen.findByRole('region', { name: 'Your objectives' })
    const history = within(own).getByRole('list', { name: 'History of Holds the line together' })
    const rows = within(history).getAllByRole('listitem').map(row => row.textContent)
    expect(rows).toEqual(['Sun 4 OctNot yet', 'Sun 1 NovOn track'])
    // A Met objective stays, with its Met row.
    const met = within(own).getByRole('list', { name: 'History of Scans before receiving' })
    expect(within(met).getAllByRole('listitem').map(row => row.textContent)).toEqual(['Sun 4 OctOn track', 'Sun 1 NovMet'])
    expect(within(own).getAllByText('Met').length).toBeGreaterThanOrEqual(2)
  })

  it('is read-only: Back is the only control', async () => {
    setup()
    renderApp('/player/season')
    await screen.findByRole('region', { name: 'Your objectives' })
    const main = screen.getByRole('heading', { name: 'My season' }).closest('div')!.parentElement!
    expect(within(main).queryAllByRole('button')).toEqual([])
    expect(within(main).getAllByRole('link').map(a => a.textContent?.trim())).toEqual(['Back'])
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('with no player objectives shows the squad objectives only', async () => {
    setup(() => [PLAN({ objectives: [] })])
    renderApp('/player/season')
    expect(await screen.findByRole('region', { name: 'Squad objectives' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Your objectives' })).toBeNull()
  })

  it('opening it clears New, once', async () => {
    setup()
    renderApp('/player/season')
    await screen.findByRole('region', { name: 'Squad objectives' })
    await waitFor(() => expect(seenCalls).toEqual([{}]))
    // The re-read says it is no longer new, so nothing marks it again.
    await new Promise(resolve => setTimeout(resolve, 300))
    expect(seenCalls).toEqual([{}])
  })

  it('does not mark anything when it is not new', async () => {
    isNew = false
    setup()
    renderApp('/player/season')
    await screen.findByRole('region', { name: 'Squad objectives' })
    await new Promise(resolve => setTimeout(resolve, 300))
    expect(seenCalls).toEqual([])
  })

  it('opens from the Home card, and Back returns to Home', async () => {
    setup()
    renderApp('/player/home')
    await userEvent.click(await screen.findByRole('button', { name: 'Open my season' }))
    expect(await screen.findByRole('heading', { name: 'My season' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('link', { name: 'Back' }))
    expect(await screen.findByText('Theodoros Zagorakis')).toBeInTheDocument()
    // New was cleared by opening the page, so the card no longer wears it.
    const card = await screen.findByRole('region', { name: 'My season' })
    await waitFor(() => expect(within(card).queryByText('New')).toBeNull())
  })

  it('says so when there is no plan to read, and offers a retry when the read fails', async () => {
    setup(() => [])
    renderApp('/player/season')
    expect(await screen.findByText('Your coach hasn\'t shared a season plan with you yet.')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Squad objectives' })).toBeNull()
    cleanup()
    PLAYER = { id: `player-398-${++n}` }; signInAs(PLAYER)
    setup()
    server.use(rpcError('season_plan_for_player', 500, { message: 'boom' }))
    renderApp('/player/season')
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.queryByText('Your coach hasn\'t shared a season plan with you yet.')).toBeNull()
  })
})
