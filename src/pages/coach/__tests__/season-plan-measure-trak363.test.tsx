/**
 * TRAK-363 (Season plan 15/18, spec TRAK-348): each season objective measured on Home from matches only: the share of its
 * matches that Worked (Good from 60 %, Watch from 40 %, At risk below), a donut with a segment per objective, selecting
 * one lists its matches, two Didn'ts in a row need attention, and a result's instruction names the objective it
 * carried. A typed instruction doesn't count. Synthetic people.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { renderApp } from '../../../../tests/support/render-app'
import { signInAs } from '../../../../tests/support/session'
import { server } from '../../../../tests/msw/server'
import { table, rpc, SUPABASE_URL } from '../../../../tests/msw/supabase'
import { forgetScreens } from '@/lib/screen-memory'

const PRESS = '11111111-1111-4111-8111-111111111111', COMPACT = '22222222-2222-4222-8222-222222222222', SETS = '33333333-3333-4333-8333-333333333333'
let n = 0
let COACH = { id: 'coach-363' }
type Match = { id: string; day: string; opponent: string; squad?: string | null; status?: string }
let matches: Match[] = []
let evaluations: Record<string, unknown>[] = []
let plans: Record<string, unknown>[] = []

const param = (url: URL, key: string) => url.searchParams.get(key)?.replace(/^eq\./, '') ?? null
/** `event_id=eq.x` or `event_id=in.(x,y)`: the ids asked for, or null for all. */
const ids = (url: URL) => { const raw = url.searchParams.get('event_id'); return raw ? raw.replace(/^(eq\.|in\.\()|\)$/g, '').split(',').map(id => id.replace(/"/g, '')) : null }
const event = (m: Match) => ({
  id: m.id, coach_user_id: COACH.id, event_type: 'match', squad: m.squad === undefined ? 'U16' : m.squad, title: `v ${m.opponent}`,
  published: true, status: m.status ?? 'scheduled', starts_at: `${m.day}T15:00:00Z`, ends_at: `${m.day}T16:30:00Z`, event_date: m.day,
  start_time: '15:00', opponent: m.opponent, home_away: 'home', venue: 'Synthetic Park', competition: 'league',
})
const published = (id: string, our: number, their: number, plan_worked: string[] = []) =>
  ({ event_id: id, saved_at: '2026-11-02T10:00:00Z', published_at: '2026-11-02T10:00:00Z', our_score: our, their_score: their, plan_worked })

beforeEach(() => {
  localStorage.clear()
  COACH = { id: `coach-363-${++n}` }
  // The card starts open, so the results are in view.
  localStorage.setItem(`trak.season-plan-card.${COACH.id}.U16`, 'open')
  matches = [
    { id: 'm1', day: '2026-10-03', opponent: 'Synthetic Rovers' },
    { id: 'm2', day: '2026-10-10', opponent: 'Synthetic United' },
    { id: 'm3', day: '2026-10-17', opponent: 'Synthetic City' },
    { id: 'm4', day: '2026-10-24', opponent: 'Synthetic Typed' },
  ]
  evaluations = [
    published('m1', 2, 0, ['worked', 'didnt']),
    published('m2', 1, 1, ['worked', 'didnt']),
    published('m3', 0, 1, ['partly']),
    published('m4', 3, 0, ['worked']),
  ]
  plans = [
    { event_id: 'm1', saved_at: '2026-10-01T10:00:00Z', goals: [{ title: 'Press as one', looks_like: '', season_objective_id: PRESS }, { title: 'Stay narrow', looks_like: '', season_objective_id: COMPACT }] },
    { event_id: 'm2', saved_at: '2026-10-08T10:00:00Z', goals: [{ title: 'Press as one', looks_like: '', season_objective_id: PRESS }, { title: 'Stay narrow', looks_like: '', season_objective_id: COMPACT }] },
    { event_id: 'm3', saved_at: '2026-10-15T10:00:00Z', goals: [{ title: 'Press high', looks_like: '', season_objective_id: PRESS }] },
    // Typed by the coach: carries no objective, so it never counts.
    { event_id: 'm4', saved_at: '2026-10-22T10:00:00Z', goals: [{ title: 'Win it back within 5 seconds', looks_like: '' }] },
  ]
  signInAs(COACH)
  server.use(
    table('profiles', [{ id: 'p', user_id: COACH.id, role: 'coach', full_name: 'Synthetic Coach', invite_code: 'ABCD' }]),
    table('coach_details', [{ user_id: COACH.id, coach_role: 'Head Coach', team: 'U16', organization_id: 'org-1' }]),
    table('organizations', [{ id: 'org-1', name: 'Rehearsal FC', logo_url: null }]),
    table('squad_players', [{ id: 'pat', coach_user_id: COACH.id, player_name: 'Pat Synthetic', age_group: 'U16', status: 'active', shirt_number: 4,
      position: 'Defender', created_at: '2026-10-01T08:00:00Z', linked_player_id: 'child-pat' }]),
    rpc('coach_squad_player_consent_required', () => false),
    rpc('feature_on', () => true),
    table('season_plans', [{ id: 'plan-16', squad: 'U16', starts_on: '2026-09-01', ends_on: '2027-06-30', shared_at: '2026-11-01T10:00:00Z',
      positions_known: 'yes', watch_rule: 't2', last_shared_at: '2026-11-01T10:00:00Z', unshared_parts: [], unshared_players: [] }]),
    table('season_objectives', [
      { id: PRESS, place: 1, title: 'Win it back within 5 seconds', looks_like: '', status: 'open', created_at: '2026-09-01T08:00:00Z', retired_at: null },
      { id: COMPACT, place: 2, title: 'Stay compact', looks_like: '', status: 'open', created_at: '2026-09-01T08:00:00Z', retired_at: null },
      { id: SETS, place: 3, title: 'Own the set pieces', looks_like: '', status: 'open', created_at: '2026-09-01T08:00:00Z', retired_at: null },
    ]),
    table('player_objectives', []),
    table('player_watches', []),
    http.get(`${SUPABASE_URL}/rest/v1/coach_calendar_events`, () => HttpResponse.json(matches.map(event))),
    http.get(`${SUPABASE_URL}/rest/v1/game_evaluations`, ({ request }) => {
      const asked = ids(new URL(request.url))
      return HttpResponse.json(evaluations.filter(e => !asked || asked.includes(e.event_id as string)))
    }),
    http.get(`${SUPABASE_URL}/rest/v1/game_plans`, ({ request }) => {
      const asked = ids(new URL(request.url))
      return HttpResponse.json(plans.filter(p => !asked || asked.includes(p.event_id as string)))
    }),
    table('game_shares', []),
    rpc('game_plan_changes', () => []),
    table('coach_assessments', []),
    table('coach_sessions', []),
    table('session_attendance', []),
    table('event_absences', []),
    table('event_confirmations', []),
    table('notification_settings', []),
    table('training_notes', []),
    table('game_evaluation_players', []),
  )
})
afterEach(() => { cleanup(); forgetScreens(); localStorage.clear() })

const user = () => userEvent.setup()
const results = async () => {
  const card = await screen.findByRole('region', { name: 'U16 season plan' })
  const heading = await within(card).findByRole('heading', { name: 'Results' })
  return heading.parentElement!
}
const rowButtons = (scope: HTMLElement) => within(scope).getAllByRole('button').filter(b => b.hasAttribute('aria-expanded'))

const objectivesBlock = async () => {
  const card = await screen.findByRole('region', { name: 'U16 season plan' })
  const heading = await within(card).findByRole('heading', { name: 'Season objectives' })
  return heading.parentElement!
}

describe('TRAK-363 season objectives measured on Home', () => {
  it('measures each objective from its matches only, with Good, Watch or At risk, and a donut', async () => {
    renderApp('/coach/home')
    const block = await objectivesBlock()
    const press = within(block).getByRole('button', { name: /^Win it back within 5 seconds/ })
    // 2 of 3 Worked (67 %); the typed instruction in m4 doesn't count.
    expect(press).toHaveTextContent('Worked in 2 of 3 matches · 67%')
    expect(press).toHaveTextContent('Good')
    expect(within(block).getByRole('button', { name: /^Stay compact/ })).toHaveTextContent('Worked in 0 of 2 matches · 0%At risk')
    expect(within(block).getByRole('button', { name: /^Own the set pieces/ })).toHaveTextContent('No match yet')
    expect(within(block).getByRole('figure', { name: 'Times each season objective worked' })).toBeInTheDocument()
  }, 30_000)

  it('lists an objective’s matches when it’s selected, and flags two Didn’ts in a row', async () => {
    const user = userEvent.setup()
    renderApp('/coach/home')
    const block = await objectivesBlock()
    await user.click(within(block).getByRole('button', { name: /^Win it back within 5 seconds/ }))
    const list = within(block).getByRole('heading', { name: 'Win it back within 5 seconds: match by match' }).parentElement!
    expect(within(list).getAllByRole('listitem').map(li => li.textContent)).toEqual([
      expect.stringMatching(/^vs Synthetic City.*Partly$/), expect.stringMatching(/^vs Synthetic United.*Worked$/), expect.stringMatching(/^vs Synthetic Rovers.*Worked$/),
    ])
    const attention = within(block).getByRole('status')
    expect(attention).toHaveTextContent('Needs your attention')
    expect(attention).toHaveTextContent('Stay compact: didn’t work in the last two matches.')
    expect(attention).not.toHaveTextContent('Win it back')
  }, 30_000)

  it('names the season objective an instruction carried on its result row', async () => {
    const user = userEvent.setup()
    renderApp('/coach/home')
    const card = await screen.findByRole('region', { name: 'U16 season plan' })
    const results = (await within(card).findByRole('heading', { name: 'Results' })).parentElement!
    await user.click(within(results).getByRole('button', { name: /^vs Synthetic United/ }))
    const press = await within(results).findByText('Press as one')
    expect(press.closest('li')).toHaveTextContent('Press as oneSeason objective: Win it back within 5 secondsWorked')
  }, 30_000)
})
