/**
 * TRAK-400 (Season plan 18/18 build 5/8, spec TRAK-366): the family's season page, for the child chosen in the picker.
 * It shows the squad's objectives and that child's with their words and one row per evaluation, clears New when it
 * opens (no Got it, no coach note), and says so when the database returns no plan (not shared, switch off, consent
 * withdrawn). The function (TRAK-396) decides who may read; this is the screen. Test people are named after footballers.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { renderApp } from '../../../../tests/support/render-app'
import { signInAs } from '../../../../tests/support/session'
import { server } from '../../../../tests/msw/server'
import { table, rpc, rpcRows, SUPABASE_URL } from '../../../../tests/msw/supabase'

// A new id per test: the app's query cache is keyed by user.
let n = 0
let GUARDIAN = { id: 'guardian-400' }
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

beforeEach(() => { isNew = true; seenCalls = []; readFor = []; GUARDIAN = { id: `guardian-400-${++n}` }; signInAs(GUARDIAN) })
afterEach(() => cleanup())

describe('TRAK-400: the family\'s Season plan page', () => {
  it('shows position, squad objectives with what each looks like, the child\'s objectives with one row per evaluation, and the quiet line', async () => {
    setup()
    renderApp('/parent/season')
    expect(await screen.findByRole('heading', { name: "Alex's season" })).toBeInTheDocument()
    expect(screen.getByText(/^Set by Otto Rehhagel\./)).toBeInTheDocument()
    const position = screen.getByRole('region', { name: "Alex's position" })
    for (const text of ['Midfielder', 'Can also play Attacker', 'Box-to-box']) expect(within(position).getByText(text)).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Squad objectives' })).getByText('No more than 35 m.')).toBeInTheDocument()
    const objectives = screen.getByRole('region', { name: "Alex's objectives" })
    expect(within(objectives).getByText('Plays forward on the half-turn').parentElement).toHaveTextContent('Some progress')
    expect(within(screen.getByRole('list', { name: 'History of Scans before receiving' })).getAllByRole('listitem')).toHaveLength(2)
    expect(screen.getByText('Your coach updates this at each evaluation. You can read it here; nothing needs a reply.')).toBeInTheDocument()
    // The evaluation note is the player's alone, and the function never returns it.
    expect(screen.queryByText(/note/i)).toBeNull()
    await waitFor(() => expect(seenCalls).toEqual([{ p_child: ALEX }]))
  })

  it('shows no objectives section for a child with none, and still the squad objectives', async () => {
    setup(() => [PLAN({ objectives: [] })])
    renderApp('/parent/season')
    expect(await screen.findByRole('region', { name: 'Squad objectives' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: "Alex's objectives" })).toBeNull()
  })

  it('says the coach has not shared a plan when the function returns none', async () => {
    setup(() => [])
    renderApp('/parent/season')
    expect(await screen.findByText("Alex's coach hasn't shared a season plan yet.")).toBeInTheDocument()
    expect(seenCalls).toEqual([])
  })
})
