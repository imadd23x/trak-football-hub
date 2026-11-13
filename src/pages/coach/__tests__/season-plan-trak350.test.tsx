/**
 * TRAK-350 (Season plan 2/18, spec TRAK-348): the season plan's step 1. The coach starts a plan from Home, picks up to
 * three season objectives (the mockup's six or their own), edits or deletes them, and saves a draft, with or without
 * objectives. A season that ends before it starts is refused with the reason, and a failed save keeps everything
 * typed. With the switch off, Home shows no season plan at all. Synthetic people.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { delay, http, HttpResponse } from 'msw'
import { renderApp } from '../../../../tests/support/render-app'
import { signInAs } from '../../../../tests/support/session'
import { server } from '../../../../tests/msw/server'
import { table, rpc, SUPABASE_URL } from '../../../../tests/msw/supabase'

type Plan = { id: string; squad: string; starts_on: string | null; ends_on: string | null; shared_at: string | null }
type Objective = { id: string; plan_id: string; place: number; title: string; looks_like: string }

let n = 0
let COACH = { id: 'coach-350' }
let plans: Plan[] = []
let objectives: Objective[] = []
let writes: { method: string; table: string; body: unknown; query: string }[] = []
let failWrites = false
let asked: string[] = []

const param = (url: URL, key: string) => url.searchParams.get(key)?.replace(/^eq\./, '') ?? null
const child = (id: string, name: string) =>
  ({ id, coach_user_id: COACH.id, player_name: name, age_group: 'U16', status: 'active', shirt_number: 4, position: 'Defender', created_at: '2026-10-01T08:00:00Z' })

/** A small stand-in for the two tables, so saves land and reload as they would. */
function seasonTables(switchOn = true) {
  server.use(
    rpc('feature_on', args => { asked.push(String(args.p_feature)); return args.p_feature !== 'season_plan' || switchOn }),
    http.get(`${SUPABASE_URL}/rest/v1/season_plans`, ({ request }) => {
      const squad = param(new URL(request.url), 'squad')
      return HttpResponse.json(plans.filter(p => !squad || p.squad === squad))
    }),
    http.get(`${SUPABASE_URL}/rest/v1/season_objectives`, ({ request }) => {
      const planId = param(new URL(request.url), 'plan_id')
      return HttpResponse.json(objectives.filter(o => o.plan_id === planId).sort((a, b) => a.place - b.place))
    }),
    http.post(`${SUPABASE_URL}/rest/v1/season_plans`, async ({ request }) => {
      const body = await request.json() as Omit<Plan, 'id' | 'shared_at'>
      writes.push({ method: 'POST', table: 'season_plans', body, query: '' })
      if (failWrites) return HttpResponse.json({ message: 'down' }, { status: 503 })
      const plan = { id: `plan-${plans.length + 1}`, shared_at: null, ...body }
      plans.push(plan)
      return HttpResponse.json({ id: plan.id }, { status: 201 })
    }),
    http.patch(`${SUPABASE_URL}/rest/v1/season_plans`, async ({ request }) => {
      const url = new URL(request.url), body = await request.json() as Partial<Plan>
      writes.push({ method: 'PATCH', table: 'season_plans', body, query: url.search })
      if (failWrites) return HttpResponse.json({ message: 'down' }, { status: 503 })
      plans = plans.map(p => (p.id === param(url, 'id') ? { ...p, ...body } : p))
      return new HttpResponse(null, { status: 204 })
    }),
    http.post(`${SUPABASE_URL}/rest/v1/season_objectives`, async ({ request }) => {
      const body = await request.json() as Omit<Objective, 'id'>[]
      writes.push({ method: 'POST', table: 'season_objectives', body, query: '' })
      objectives.push(...body.map(o => ({ id: `objective-${objectives.length + Math.random()}`, ...o })))
      return new HttpResponse(null, { status: 201 })
    }),
    http.patch(`${SUPABASE_URL}/rest/v1/season_objectives`, async ({ request }) => {
      const url = new URL(request.url), body = await request.json() as Partial<Objective>
      writes.push({ method: 'PATCH', table: 'season_objectives', body, query: url.search })
      objectives = objectives.map(o => (o.id === param(url, 'id') ? { ...o, ...body } : o))
      return new HttpResponse(null, { status: 204 })
    }),
    http.delete(`${SUPABASE_URL}/rest/v1/season_objectives`, ({ request }) => {
      const url = new URL(request.url)
      const ids = (url.searchParams.get('id') ?? '').replace(/^in\.\(|\)$/g, '').split(',').map(id => id.replace(/"/g, ''))
      writes.push({ method: 'DELETE', table: 'season_objectives', body: ids, query: url.search })
      objectives = objectives.filter(o => !ids.includes(o.id))
      return new HttpResponse(null, { status: 204 })
    }),
  )
}

beforeEach(() => {
  COACH = { id: `coach-350-${++n}` }
  plans = []
  objectives = []
  writes = []
  failWrites = false
  asked = []
  signInAs(COACH)
  server.use(
    // TRAK-355: who the coach is watching; no one.
    table('player_watches', []),
    table('profiles', [{ id: 'p', user_id: COACH.id, role: 'coach', full_name: 'Synthetic Coach', invite_code: 'ABCD' }]),
    table('coach_details', [{ user_id: COACH.id, coach_role: 'Head Coach', team: 'U16', organization_id: 'org-1' }]),
    table('organizations', [{ id: 'org-1', name: 'Rehearsal FC', logo_url: null }]),
    table('squad_players', [child('pat', 'Synthetic Player Pat'), child('quinn', 'Synthetic Player Quinn')]),
    rpc('coach_squad_player_consent_required', () => false),
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
  )
})
afterEach(cleanup)

const user = () => userEvent.setup()
const saveDraft = () => screen.getByRole('button', { name: /^(Save draft|Saved)$/ })

describe('TRAK-350 the season plan, step 1', () => {
  it('starts from Home and saves a draft with one of the six and one of the coach\'s own', async () => {
    seasonTables()
    renderApp('/coach/home')
    // TRAK-361: the card, still a Start row for a squad with no plan.
    const row = await screen.findByRole('region', { name: 'U16 season plan' })
    expect(await within(row).findByText('Not started')).toBeInTheDocument()
    await user().click(within(row).getByRole('button', { name: 'Start' }))

    expect(await screen.findByRole('heading', { name: 'Season plan', level: 1 })).toBeInTheDocument()
    expect(screen.queryByText(/Focus/)).toBeNull()
    expect(screen.queryByRole('button', { name: /Fill in for me/ })).toBeNull()
    await user().click(screen.getByRole('button', { name: 'Stay compact' }))
    await user().click(screen.getByRole('button', { name: 'Write your own' }))
    await user().type(screen.getByLabelText('Objective 2'), 'Win the second ball')
    await user().click(saveDraft())

    await waitFor(() => expect(saveDraft()).toHaveTextContent('Saved'))
    expect(writes.find(w => w.method === 'POST' && w.table === 'season_plans')?.body).toMatchObject({ squad: 'U16', starts_on: null, ends_on: null })
    expect(objectives.map(o => [o.place, o.title, o.looks_like])).toEqual([
      [1, 'Stay compact', 'No more than 35 m from back to front.'], [2, 'Win the second ball', '']])

    cleanup()
    renderApp('/coach/season-plan')
    expect(await screen.findByDisplayValue('Win the second ball')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Stay compact')).toBeInTheDocument()
    expect(screen.getByText('U16 · Draft, only you see it')).toBeInTheDocument()
  }, 30_000)

  it('holds three at most: a fourth can\'t be added', async () => {
    seasonTables()
    renderApp('/coach/season-plan')
    for (const title of ['Stay compact', 'React first', 'Own the set pieces']) {
      await user().click(await screen.findByRole('button', { name: title }))
    }
    expect(screen.getByText('3 of 3')).toBeInTheDocument()
    expect(screen.getByText('Up to three. Delete one to add another.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Write your own' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Win it back within 5 seconds' })).toBeDisabled()
  })

  it('edits and deletes saved objectives, and saves with none at all', async () => {
    plans = [{ id: 'plan-1', squad: 'U16', starts_on: '2026-09-01', ends_on: '2027-06-30', shared_at: null }]
    objectives = [
      { id: 'o1', plan_id: 'plan-1', place: 1, title: 'Stay compact', looks_like: '' },
      { id: 'o2', plan_id: 'plan-1', place: 2, title: 'React first', looks_like: '' },
    ]
    seasonTables()
    renderApp('/coach/season-plan')
    const title = await screen.findByDisplayValue('Stay compact')
    await user().clear(title)
    await user().type(title, 'Stay compact, always')
    await user().click(screen.getByRole('button', { name: 'Delete React first' }))
    await user().click(saveDraft())
    await waitFor(() => expect(saveDraft()).toHaveTextContent('Saved'))
    expect(objectives.map(o => o.title)).toEqual(['Stay compact, always'])
    expect(writes.filter(w => w.method === 'DELETE').flatMap(w => w.body as string[])).toEqual(['o2'])

    await user().click(screen.getByRole('button', { name: 'Delete Stay compact, always' }))
    await user().click(saveDraft())
    await waitFor(() => expect(saveDraft()).toHaveTextContent('Saved'))
    expect(objectives).toEqual([])
    expect(screen.getByText('None yet. Pick from the list or write your own.')).toBeInTheDocument()
  })

  it('refuses a season that ends before it starts, saying why', async () => {
    plans = [{ id: 'plan-1', squad: 'U16', starts_on: '2026-09-01', ends_on: '2026-08-01', shared_at: null }]
    seasonTables()
    renderApp('/coach/season-plan')
    expect(await screen.findByText('The season has to end after it starts.')).toBeInTheDocument()
    await user().click(saveDraft())
    expect(writes).toEqual([])
  })

  it('refuses an objective with no title, saying why', async () => {
    seasonTables()
    renderApp('/coach/season-plan')
    await user().click(await screen.findByRole('button', { name: 'Write your own' }))
    await user().click(saveDraft())
    expect(await screen.findByText('Give each objective a title, or delete it.')).toBeInTheDocument()
    expect(writes).toEqual([])
  })

  it('keeps everything typed when a save fails, and says so', async () => {
    seasonTables()
    failWrites = true
    renderApp('/coach/season-plan')
    await user().click(await screen.findByRole('button', { name: 'Write your own' }))
    await user().type(screen.getByLabelText('Objective 1'), 'Win the second ball')
    await user().click(saveDraft())
    expect(await screen.findByText(/Couldn't save the plan/)).toBeInTheDocument()
    expect(screen.getByDisplayValue('Win the second ball')).toBeInTheDocument()
    expect(saveDraft()).toHaveTextContent('Save draft')
  })

  it('waits for the switch before saying anything: never "Not started" or an empty form for a saved plan (CI, 3 Nov)', async () => {
    plans = [{ id: 'plan-1', squad: 'U16', starts_on: null, ends_on: null, shared_at: null }]
    objectives = [{ id: 'o1', plan_id: 'plan-1', place: 1, title: 'Stay compact', looks_like: '' }]
    seasonTables()
    // Only the season plan's switch is slow: the frame's own switches answer at once, so the page shows before it knows
    // whether the plan is on. Held until released, so the test doesn't race a timer.
    let release = () => {}
    const answered = new Promise<void>(resolve => { release = resolve })
    server.use(http.post(`${SUPABASE_URL}/rest/v1/rpc/feature_on`, async ({ request }) => {
      const { p_feature: feature } = await request.json() as { p_feature: string }
      asked.push(feature)
      if (feature === 'season_plan') await answered
      return HttpResponse.json(true)
    }))
    renderApp('/coach/season-plan')
    expect(await screen.findByRole('heading', { name: 'Season plan', level: 1 })).toBeInTheDocument()
    await waitFor(() => expect(asked).toContain('season_plan'))
    expect(screen.queryByText('U16 · Not started')).toBeNull()
    expect(screen.queryByText(/None yet/)).toBeNull()
    release()
    expect(await screen.findByDisplayValue('Stay compact')).toBeInTheDocument()
    expect(screen.getByText('U16 · Draft, only you see it')).toBeInTheDocument()
  })

  it('shows nothing on Home with the switch off', async () => {
    seasonTables(false)
    renderApp('/coach/home')
    await waitFor(() => expect(asked).toContain('season_plan'))
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(screen.queryByRole('region', { name: /season plan$/ })).toBeNull()
    expect(writes).toEqual([])
  })
})
