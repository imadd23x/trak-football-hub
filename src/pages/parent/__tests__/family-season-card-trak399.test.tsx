/**
 * TRAK-399 (Season plan 18/18 build 4/8, spec TRAK-366): the Season plan card on the family Home, for the child chosen
 * in the picker. It shows the squad's objectives as words and that child's with their latest word, wears New until the
 * guardian opens the page (no Got it, no coach note), follows the picker, and shows nothing for a child the database
 * returns no plan for (not shared, switch off, consent withdrawn) or when the read fails. The function (TRAK-396)
 * decides who may read; this is the screen. Test people are named after footballers.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { renderApp } from '../../../../tests/support/render-app'
import { signInAs } from '../../../../tests/support/session'
import { server } from '../../../../tests/msw/server'
import { table, rpc, rpcRows, rpcError, SUPABASE_URL } from '../../../../tests/msw/supabase'

// A new id per test: the app's query cache is keyed by user.
let n = 0
let GUARDIAN = { id: 'guardian-399' }
const ALEX = 'child-alex-399', ZARA = 'child-zara-399'
let isNew = true
let seenCalls: Record<string, unknown>[] = []
let readFor: string[] = []

const PLAN = (over: object = {}) => ({
  squad_player_id: 'sq-399', squad: 'U15', coach_name: 'Otto Rehhagel', time_zone: 'Asia/Dubai',
  starts_on: '2099-01-01', ends_on: '2099-12-31', eval_every: 'month', eval_day: 0, last_evaluation_on: null,
  position: 'Midfielder', also_plays: ['Attacker'], roles: ['Box-to-box'],
  season_objectives: [
    { id: 'so-1', place: 1, title: 'Win it back within 5 seconds', looks_like: 'The nearest three press.' },
    { id: 'so-2', place: 2, title: 'Stay compact', looks_like: 'No more than 35 m.' },
  ],
  objectives: [
    { id: 'po-1', slot: 1, title: 'Scans before receiving', status: 'open', current: 'not_yet', supports: null,
      history: [{ due_on: '2026-10-04', status: 'not_yet' }, { due_on: '2026-11-01', status: 'not_yet' }] },
    { id: 'po-2', slot: 2, title: 'Plays forward on the half-turn', status: 'open', current: 'some_progress', supports: null, history: [] },
  ],
  is_new: isNew, shared_at: '2099-01-01T10:00:00Z', ...over,
})

/** Alex's coach has shared; Zara's has not, so the function returns no row for her. */
function setup(plan: (child: string) => object[] = child => child === ALEX ? [PLAN()] : []) {
  server.use(
    http.get(`${SUPABASE_URL}/rest/v1/profiles`, ({ request }) => {
      const asked = new URL(request.url).searchParams.get('user_id') ?? ''
      if (asked.includes(GUARDIAN.id)) return HttpResponse.json({ id: 'p', user_id: GUARDIAN.id, role: 'parent', full_name: 'Giorgos Karagounis', nationality: null })
      return HttpResponse.json([{ user_id: ALEX, full_name: 'Alex Example' }, { user_id: ZARA, full_name: 'Zara Example' }])
    }),
    table('player_parent_links', [{ player_user_id: ALEX }, { player_user_id: ZARA }]),
    table('player_details', [{ position: 'Midfielder', current_club: 'Rehearsal Athens', age_group: 'U15' }]),
    table('parental_consents', []), table('squad_players', []), table('coach_assessments', []), table('recognition_awards', []),
    table('matches', []), table('game_for_family', []), table('game_review_for_family', []),
    rpcRows('child_events', []), rpcRows('family_training_history', []), rpcRows('get_children_awaiting_consent', []),
    rpcRows('get_roster_children_awaiting_consent', []), rpcRows('get_my_child_logins', []), rpcRows('get_my_approved_children_awaiting_signup', []),
    rpc('guardian_consent_applies', () => true),
    rpc('season_plan_for_player', args => { readFor.push(String((args as { p_child?: string }).p_child)); return plan(String((args as { p_child?: string }).p_child)) }),
    rpc('mark_season_plan_seen', args => { seenCalls.push(args); isNew = false; return null }),
  )
}

beforeEach(() => { isNew = true; seenCalls = []; readFor = []; GUARDIAN = { id: `guardian-399-${++n}` }; signInAs(GUARDIAN) })
afterEach(() => cleanup())

describe('TRAK-399: the Season plan card on the family Home', () => {
  it('shows the squad objectives as words and the child\'s own with their latest word, New, and no Got it or note', async () => {
    setup()
    renderApp('/parent/home')
    const card = await screen.findByRole('region', { name: 'Season plan' })
    expect(within(card).getByText('Win it back within 5 seconds')).toBeInTheDocument()
    expect(within(card).queryByText('The nearest three press.')).toBeNull() // the page carries "what it looks like"
    expect(within(card).getByRole('heading', { name: "Alex's objectives" })).toBeInTheDocument()
    expect(within(card).getByText('Scans before receiving').parentElement).toHaveTextContent('Not yet')
    expect(within(card).getByText('Plays forward on the half-turn').parentElement).toHaveTextContent('Some progress')
    expect(within(card).getByText('New')).toBeInTheDocument()
    expect(within(card).queryByRole('button', { name: 'Got it' })).toBeNull()
    expect(within(card).queryByText(/Good|Watch|At risk|match|note/i)).toBeNull()
    expect(readFor).toContain(ALEX)
  })

  it('follows the picker: nothing for a child the coach has not shared', async () => {
    setup()
    renderApp('/parent/home')
    await screen.findByRole('region', { name: 'Season plan' })
    await userEvent.click(screen.getByRole('button', { name: /Alex Example/ }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Zara Example' }))
    await waitFor(() => expect(readFor).toContain(ZARA))
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Season plan' })).toBeNull())
  })

  it('shows no card when the function returns no plan (not shared, switch off, consent withdrawn)', async () => {
    setup(() => [])
    renderApp('/parent/home')
    expect((await screen.findAllByText('Alex Example')).length).toBeGreaterThan(0)
    await waitFor(() => expect(readFor.length).toBeGreaterThan(0))
    expect(screen.queryByRole('region', { name: 'Season plan' })).toBeNull()
  })

  it('shows no card when the read fails, and the rest of Home is untouched', async () => {
    setup()
    server.use(rpcError('season_plan_for_player', 500, { message: 'boom' }))
    renderApp('/parent/home')
    expect((await screen.findAllByText('Alex Example')).length).toBeGreaterThan(0)
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    expect(screen.queryByRole('region', { name: 'Season plan' })).toBeNull()
  })

  it('opens the page, which clears New for this guardian', async () => {
    setup()
    renderApp('/parent/home')
    const card = await screen.findByRole('region', { name: 'Season plan' })
    await userEvent.click(within(card).getByRole('button', { name: 'See the season plan' }))
    expect(await screen.findByRole('heading', { name: "Alex's season" })).toBeInTheDocument()
    await waitFor(() => expect(seenCalls).toEqual([{ p_child: ALEX }]))
    await userEvent.click(screen.getByRole('link', { name: 'Back' }))
    const again = await screen.findByRole('region', { name: 'Season plan' })
    await waitFor(() => expect(within(again).queryByText('New')).toBeNull())
  })
})
