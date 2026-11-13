/**
 * TRAK-361 (Season plan 13/18, spec TRAK-348): Home's Season plan card under Needs you. The whole card folds, by mouse,
 * touch and keyboard, with a real button that says whether it's open; a reload keeps it as the coach left it, per squad.
 * Folded, one line says where the plan stands. Open: the season objectives ("No match yet"), the player objectives in
 * one folded row, worst first, and View plan. Under All, one folded row per squad, each opening its own card. A skeleton
 * first, never "Not started" for a plan it hasn't read. Synthetic people.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { renderApp } from '../../../../tests/support/render-app'
import { signInAs } from '../../../../tests/support/session'
import { server } from '../../../../tests/msw/server'
import { table, rpc, SUPABASE_URL } from '../../../../tests/msw/supabase'
import { forgetScreens } from '@/lib/screen-memory'
import { planState, seasonLeft, type SeasonPlan } from '@/lib/season-plan'

type Plan = Record<string, unknown> & { id: string; squad: string }
let n = 0
let COACH = { id: 'coach-361' }
let plans: Plan[] = []
let squadPlayers: Record<string, unknown>[] = []
let held: Record<string, unknown>[] = []
let watches: Record<string, unknown>[] = []
let holdPlans: Promise<void> | null = null

const param = (url: URL, key: string) => url.searchParams.get(key)?.replace(/^eq\./, '') ?? null
const child = (id: string, name: string, squad = 'U16') => ({
  id, coach_user_id: COACH.id, player_name: name, age_group: squad, status: 'active', shirt_number: 4, position: 'Defender',
  created_at: '2026-10-01T08:00:00Z', linked_player_id: `child-${id}`,
})
const shared = (id: string, squad: string): Plan => ({
  id, squad, starts_on: '2026-09-01', ends_on: '2027-06-30', shared_at: '2026-11-01T10:00:00Z', positions_known: 'yes', watch_rule: 't2',
  last_shared_at: '2026-11-01T10:00:00Z', unshared_parts: [], unshared_players: [],
})

beforeEach(() => {
  localStorage.clear()
  COACH = { id: `coach-361-${++n}` }
  plans = [shared('plan-16', 'U16')]
  squadPlayers = [child('pat', 'Pat Synthetic'), child('quinn', 'Quinn Synthetic'), child('rae', 'Rae Synthetic')]
  held = [{ id: 'po-1', squad_player_id: 'pat', title: 'Wins their headers', source: 'library', season_objective_id: null, created_at: '2026-11-01T10:00:00Z', status: 'open', retired_at: null }]
  watches = [{ squad_player_id: 'quinn', since: new Date(Date.now() - 2 * 86400_000).toISOString() }]
  holdPlans = null
  signInAs(COACH)
  server.use(
    table('profiles', [{ id: 'p', user_id: COACH.id, role: 'coach', full_name: 'Synthetic Coach', invite_code: 'ABCD' }]),
    table('coach_details', [{ user_id: COACH.id, coach_role: 'Head Coach', team: 'U16', organization_id: 'org-1' }]),
    table('organizations', [{ id: 'org-1', name: 'Rehearsal FC', logo_url: null }]),
    http.get(`${SUPABASE_URL}/rest/v1/squad_players`, () => HttpResponse.json(squadPlayers)),
    rpc('coach_squad_player_consent_required', () => false),
    rpc('feature_on', () => true),
    // TRAK-364: a shared plan's evaluations; none published.
    table('season_evaluations', []),
    http.get(`${SUPABASE_URL}/rest/v1/season_plans`, async ({ request }) => {
      if (holdPlans) await holdPlans
      const squad = param(new URL(request.url), 'squad')
      return HttpResponse.json(plans.filter(p => !squad || p.squad === squad))
    }),
    http.get(`${SUPABASE_URL}/rest/v1/season_objectives`, ({ request }) => HttpResponse.json(param(new URL(request.url), 'plan_id') === 'plan-16'
      ? [{ id: 'so-1', place: 1, title: 'Stay compact', looks_like: '', status: 'open', created_at: '2026-09-01T08:00:00Z', retired_at: null }] : [])),
    http.get(`${SUPABASE_URL}/rest/v1/player_objectives`, () => HttpResponse.json(held)),
    table('objective_progress', []),
    http.get(`${SUPABASE_URL}/rest/v1/player_watches`, () => HttpResponse.json(watches)),
    table('coach_assessments', []),
    table('coach_sessions', []),
    table('session_attendance', []),
    table('coach_calendar_events', []),
    table('event_absences', []),
    table('event_confirmations', []),
    table('notification_settings', []),
    table('game_plans', []),
    table('game_evaluations', []),
    rpc('game_plan_changes', () => []),
    http.get(`${SUPABASE_URL}/rest/v1/game_shares`, () => HttpResponse.json([])),
    table('training_notes', []),
  )
})
afterEach(() => { cleanup(); forgetScreens(); localStorage.clear() })

const user = () => userEvent.setup()
const cardOf = (squad: string) => screen.findByRole('region', { name: `${squad} season plan` })
const fold = (card: HTMLElement) => within(card).getAllByRole('button').find(b => b.hasAttribute('aria-expanded') && /season plan/.test(b.textContent ?? ''))!

describe('TRAK-361 the Season plan card', () => {
  it('folds by mouse, touch and keyboard, with a real button that says so', async () => {
    renderApp('/coach/home')
    const card = await cardOf('U16')
    expect(await within(card).findByText(/^Shared 1 Nov · \d+ weeks? left$/)).toBeInTheDocument()
    const button = fold(card)
    expect(button.tagName).toBe('BUTTON')
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(within(card).queryByText('Stay compact')).toBeNull()

    await user().click(button)
    expect(button).toHaveAttribute('aria-expanded', 'true')
    expect(await within(card).findByText('Stay compact')).toBeInTheDocument()
    expect(within(card).getByText('No match yet')).toBeInTheDocument()
    expect(within(card).getByRole('button', { name: 'View plan' })).toBeInTheDocument()

    const touch = user()
    await touch.pointer({ keys: '[TouchA]', target: button })
    expect(button).toHaveAttribute('aria-expanded', 'false')

    button.focus()
    await user().keyboard('{Enter}')
    expect(button).toHaveAttribute('aria-expanded', 'true')
    await user().keyboard(' ')
    expect(button).toHaveAttribute('aria-expanded', 'false')
  }, 30_000)

  it('keeps open or folded after a reload, as the coach left it', async () => {
    renderApp('/coach/home')
    await user().click(fold(await cardOf('U16')))
    cleanup()
    renderApp('/coach/home')
    expect(fold(await cardOf('U16'))).toHaveAttribute('aria-expanded', 'true')
    await user().click(fold(await cardOf('U16')))
    cleanup()
    renderApp('/coach/home')
    expect(fold(await cardOf('U16'))).toHaveAttribute('aria-expanded', 'false')
  }, 30_000)

  it('lists the players worst first in one folded row, and View plan opens the plan', async () => {
    renderApp('/coach/home')
    const card = await cardOf('U16')
    await user().click(fold(card))
    const players = await within(card).findByRole('button', { name: /^Player objectives/ })
    expect(players).toHaveTextContent('1 player working on objectives · 1 watching')
    expect(players).toHaveAttribute('aria-expanded', 'false')
    await user().click(players)
    const groups = within(card).getAllByRole('heading', { level: 4 }).map(h => h.textContent)
    expect(groups).toEqual(['Not rated yet · 1', 'Watching · 1', 'No objective yet · 1'])
    expect(within(card).getByText('Wins their headers')).toBeInTheDocument()
    await user().click(within(card).getByRole('button', { name: 'View plan' }))
    await waitFor(() => expect(window.location.pathname).toBe('/coach/season-plan'))
  }, 30_000)

  it('a draft says it isn’t shared, and opens to Continue', async () => {
    plans = [{ ...shared('plan-16', 'U16'), shared_at: null, last_shared_at: null }]
    renderApp('/coach/home')
    const card = await cardOf('U16')
    expect(await within(card).findByText('Not shared yet')).toBeInTheDocument()
    await user().click(fold(card))
    expect(within(card).getByText('Once you share the plan, how the season is going shows here.')).toBeInTheDocument()
    await user().click(within(card).getByRole('button', { name: 'Continue' }))
    await waitFor(() => expect(window.location.pathname).toBe('/coach/season-plan'))
  }, 30_000)

  it('under All, one folded row per squad, each opening its own card', async () => {
    squadPlayers = [...squadPlayers, child('uri', 'Uri Synthetic', 'U14')]
    plans = [shared('plan-16', 'U16'), { ...shared('plan-14', 'U14'), unshared_parts: ['dates'] }]
    renderApp('/coach/home')
    const u14 = await cardOf('U14'), u16 = await cardOf('U16')
    expect(await within(u14).findByText('Changes not shared')).toBeInTheDocument()
    expect(await within(u16).findByText(/^Shared 1 Nov/)).toBeInTheDocument()
    expect(fold(u14)).toHaveAttribute('aria-expanded', 'false')
    expect(fold(u16)).toHaveAttribute('aria-expanded', 'false')
    await user().click(fold(u14))
    expect(fold(u14)).toHaveAttribute('aria-expanded', 'true')
    expect(fold(u16)).toHaveAttribute('aria-expanded', 'false')
    expect(await within(u14).findByText('None picked.')).toBeInTheDocument()
    expect(within(u16).queryByText('Stay compact')).toBeNull()
    // Opening U14's plan picks U14 first.
    await user().click(within(u14).getByRole('button', { name: 'View plan' }))
    await waitFor(() => expect(window.location.pathname).toBe('/coach/season-plan'))
    expect(await screen.findByText(/^U14 · /)).toBeInTheDocument()
  }, 30_000)

  it('under All, Needs you’s Set up opens that squad’s plan, not "pick one squad"', async () => {
    squadPlayers = [...squadPlayers, child('uri', 'Uri Synthetic', 'U14')]
    plans = [{ ...shared('plan-16', 'U16'), shared_at: null, last_shared_at: null }, { ...shared('plan-14', 'U14'), shared_at: null, last_shared_at: null }]
    watches = [{ squad_player_id: 'uri', since: new Date(Date.now() - 30 * 86400_000).toISOString() }]
    renderApp('/coach/home')
    await user().click(await screen.findByRole('button', { name: 'Set up' }))
    await waitFor(() => expect(window.location.pathname).toMatch(/^\/coach\/season-plan/))
    expect(await screen.findByText(/^U14 · /)).toBeInTheDocument()
    expect(screen.queryByText('Pick one squad in the menu to plan its season.')).toBeNull()
  }, 30_000)

  it('shows a skeleton first, never "Not started" for a plan it hasn’t read', async () => {
    let release = () => {}
    holdPlans = new Promise<void>(resolve => { release = resolve })
    renderApp('/coach/home')
    expect(await screen.findByLabelText('Loading the U16 season plan…')).toBeInTheDocument()
    expect(screen.queryByText('Not started')).toBeNull()
    release()
    expect(await within(await cardOf('U16')).findByText(/^Shared 1 Nov/)).toBeInTheDocument()
  }, 30_000)

  // TRAK-416: a coach with no players has no squad to plan; the skeleton must not wait for one forever.
  it('shows no loading bars for a coach with no players', async () => {
    let release = () => {}
    const held = new Promise<void>(resolve => { release = resolve })
    server.use(http.get(`${SUPABASE_URL}/rest/v1/squad_players`, async () => { await held; return HttpResponse.json([]) }))
    renderApp('/coach/home')
    expect(await screen.findByLabelText('Loading your season plan…')).toBeInTheDocument()
    release()
    await waitFor(() => expect(screen.queryByLabelText('Loading your season plan…')).toBeNull())
    expect(screen.queryByText('Not started')).toBeNull()
  }, 30_000)

  it('says so, with Retry, when the squads cannot be read', async () => {
    server.use(http.get(`${SUPABASE_URL}/rest/v1/squad_players`, () => HttpResponse.json({ message: 'offline' }, { status: 500 })))
    renderApp('/coach/home')
    expect(await screen.findByText(/couldn.t load your season plan/i)).toBeInTheDocument()
    expect(screen.queryByLabelText('Loading your season plan…')).toBeNull()
  }, 30_000)
})

describe('TRAK-361 the folded line', () => {
  const plan = (patch: Partial<SeasonPlan>): SeasonPlan => ({
    id: 'plan-1', squad: 'U16', starts_on: '2026-09-01', ends_on: '2027-06-30', positions_known: 'yes', watch_rule: 't2',
    shared_at: '2026-11-03T10:00:00Z', last_shared_at: '2026-11-03T10:00:00Z', unshared_parts: [], unshared_players: [], ...patch,
  })
  it('says when it was shared and how many weeks are left, by the day', () => {
    expect(planState(plan({}), '2026-11-06')).toBe('Shared 3 Nov · 34 weeks left')
    expect(seasonLeft(plan({}), '2027-06-29')).toBe('1 week left')
    expect(seasonLeft(plan({}), '2027-07-01')).toBe('season over')
    expect(seasonLeft(plan({ starts_on: '2026-12-01' }), '2026-11-06')).toMatch(/^starts 1 Dec$/)
    expect(seasonLeft(plan({ starts_on: null }), '2026-11-06')).toBeNull()
  })
  it('says what isn’t shared', () => {
    expect(planState(plan({ shared_at: null, last_shared_at: null }), '2026-11-06')).toBe('Not shared yet')
    expect(planState(plan({ unshared_players: ['pat'] }), '2026-11-06')).toBe('Changes not shared')
  })
})
