/**
 * TRAK-364 (Season plan 16/18, spec TRAK-348): the evaluation. Where the season plan is on and the squad's plan is
 * shared, Home has one Evaluation due card in place of the per-player Assess cards; elsewhere Home is as it was. The
 * evaluation lists every consented player, each from their latest ratings; a player with none has to be rated before
 * Publish; a note goes to the player alone. Publish sends everyone at once, and a failed publish keeps everything
 * entered. The set-up's step 1 and View plan's Edit set the rhythm; a new rhythm after sharing waits under Not shared
 * yet as the evaluation dates. Synthetic people; dates are worked out from today with the app's own rules, in the
 * academy's time zone, so the suite never depends on the day it runs.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { renderApp } from '../../../../tests/support/render-app'
import { signInAs } from '../../../../tests/support/session'
import { setSlider } from '../../../../tests/support/slider'
import { server } from '../../../../tests/msw/server'
import { table, rpc, SUPABASE_URL } from '../../../../tests/msw/supabase'
import { forgetScreens } from '@/lib/screen-memory'
import { evalDay, squadEvaluation } from '@/lib/evaluation'

const ZONE = 'Asia/Dubai'
const DAY = 86_400_000
const dayIn = (instant: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(instant)
const daysFromNow = (n: number) => dayIn(new Date(Date.now() + n * DAY))

type Plan = Record<string, unknown> & { id: string; shared_at: string | null; unshared_parts: string[]; eval_every: string; eval_day: number }
let n = 0
let COACH = { id: 'coach-364' }
let seasonOn = true
let plan: Plan
let evaluations: { plan_id: string; due_on: string }[] = []
let published: unknown[] = []
let failNext = 0
let patches: Record<string, unknown>[] = []
let reads: string[] = []

const child = (id: string, name: string, position: string) => ({
  id, coach_user_id: COACH.id, player_name: name, age_group: 'U16', status: 'active', shirt_number: 4, position,
  created_at: '2026-08-01T08:00:00Z', linked_player_id: `child-${id}`,
})
// Pat was assessed after a session; Quinn never was; Rae waits for a parent.
const lastTime = { squad_player_id: 'pat', coach_rating: 6.2, created_at: '2026-08-20T10:00:00Z', published_at: '2026-08-20T10:00:00Z',
  work_rate: 7, tactical: 6, attitude: 6, technical: 6, physical: 6, coachability: 6 }
/** What the app works out for the plan, as the suite's expectation. */
const expected = () => squadEvaluation({
  plan: { ...plan, shared_at: plan.shared_at!, starts_on: plan.starts_on as string, ends_on: plan.ends_on as string },
  lastDueOn: evaluations.map(e => e.due_on).sort().at(-1) ?? null, zone: ZONE, now: new Date(),
})

beforeEach(() => {
  localStorage.clear()
  COACH = { id: `coach-364-${++n}` }
  seasonOn = true
  // Shared 90 days ago; every 2 weeks on Sunday; nothing evaluated yet, so it's been due for a while.
  plan = { id: 'plan-1', squad: 'U16', starts_on: daysFromNow(-120), ends_on: daysFromNow(200), shared_at: new Date(Date.now() - 90 * DAY).toISOString(),
    last_shared_at: new Date(Date.now() - 90 * DAY).toISOString(), positions_known: 'yes', watch_rule: 't2', unshared_parts: [], unshared_players: [],
    eval_every: '2w', eval_day: 0 }
  evaluations = []
  published = []
  failNext = 0
  patches = []
  reads = []
  signInAs(COACH)
  server.events.on('request:start', ({ request }) => { reads.push(new URL(request.url).pathname) })
  server.use(
    table('profiles', [{ id: 'p', user_id: COACH.id, role: 'coach', full_name: 'Synthetic Coach', invite_code: 'ABCD' }]),
    table('coach_details', [{ user_id: COACH.id, coach_role: 'Head Coach', team: 'U16', organization_id: 'org-1' }]),
    table('organizations', [{ id: 'org-1', name: 'Rehearsal FC', logo_url: null, time_zone: ZONE }]),
    table('squad_players', [child('pat', 'Pat Synthetic', 'Defender'), child('quinn', 'Quinn Synthetic', 'Midfielder'), child('rae', 'Rae Synthetic', 'Attacker')]),
    rpc('coach_squad_player_consent_required', ({ p_squad_player_id }) => p_squad_player_id === 'rae'),
    rpc('feature_on', ({ p_feature }) => p_feature === 'season_plan' ? seasonOn : false),
    http.get(`${SUPABASE_URL}/rest/v1/season_plans`, () => HttpResponse.json([plan])),
    http.patch(`${SUPABASE_URL}/rest/v1/season_plans`, async ({ request }) => {
      const body = await request.json() as Record<string, unknown>
      patches.push(body)
      // As the database: once shared, a new rhythm waits to be shared.
      const moved = (body.eval_every !== undefined && body.eval_every !== plan.eval_every) || (body.eval_day !== undefined && body.eval_day !== plan.eval_day)
      plan = { ...plan, ...body, unshared_parts: plan.shared_at && moved && !plan.unshared_parts.includes('evaluation') ? [...plan.unshared_parts, 'evaluation'] : plan.unshared_parts }
      return new HttpResponse(null, { status: 204 })
    }),
    http.get(`${SUPABASE_URL}/rest/v1/season_evaluations`, () => HttpResponse.json(evaluations)),
    http.post(`${SUPABASE_URL}/rest/v1/rpc/publish_evaluation_with_objectives`, async ({ request }) => {
      const args = await request.json() as { p_due_on: string; p_players: { squad_player_id: string }[] }
      published.push(args)
      if (failNext > 0) { failNext -= 1; return HttpResponse.json({ message: 'Network down' }, { status: 503 }) }
      evaluations = [...evaluations, { plan_id: 'plan-1', due_on: args.p_due_on }]
      return HttpResponse.json({ evaluation_id: 'ev-1', due_on: args.p_due_on,
        assessments: args.p_players.map((p, i) => ({ squad_player_id: p.squad_player_id, assessment_id: `as-${i}` })) })
    }),
    table('coach_assessments', [lastTime]),
    table('season_objectives', []),
    table('player_objectives', []), rpc('stuck_player_objectives', () => []),
    table('player_watches', []),
    // The rest of Home, answered empty.
    table('coach_sessions', []), table('session_attendance', []), table('coach_calendar_events', []), table('event_absences', []),
    table('event_confirmations', []), table('notification_settings', []), table('game_plans', []), table('game_evaluations', []),
    rpc('game_plan_changes', () => []), http.get(`${SUPABASE_URL}/rest/v1/game_shares`, () => HttpResponse.json([])),
    table('training_notes', []), table('squad_player_also_plays', []), table('squad_player_roles', []), table('squad_position_history', []),
    table('squad_player_profiles', []), rpc('coach_player_birth_dates', () => []), rpc('coach_squad_season', () => []),
    table('coach_assessment_notes', []), table('coach_shared_feedback', []),
  )
})
afterEach(() => { cleanup(); forgetScreens(); localStorage.clear(); server.events.removeAllListeners() })

const user = () => userEvent.setup()

describe('TRAK-364 Home', () => {
  it('one Evaluation due card in place of the per-player Assess cards; a missed date stays due', async () => {
    const { due, today } = expected()
    expect(due.dueOn).not.toBeNull()
    expect(due.since! < today).toBe(true)
    renderApp('/coach/home')
    const section = (await screen.findByText('Evaluation due')).closest('section')!
    expect(within(section).getByText(evalDay(due.since!))).toBeInTheDocument()
    expect(within(section).getByText(`Due since ${evalDay(due.since!)}. Everyone starts where they were last time.`)).toBeInTheDocument()
    // Quinn was never assessed: elsewhere an Assess card; here the evaluation covers him.
    expect(within(section).queryByText('Quinn Synthetic')).toBeNull()
    expect(within(section).queryByText(/Never assessed/)).toBeNull()
    await user().click(within(section).getByRole('button', { name: 'Evaluate' }))
    await waitFor(() => expect(window.location.pathname).toBe('/coach/evaluation'))
    expect(await screen.findByRole('heading', { level: 1, name: 'Evaluation' })).toBeInTheDocument()
  }, 30_000)

  it('no card once the due date is published, and the per-player Assess cards still give way', async () => {
    evaluations = [{ plan_id: 'plan-1', due_on: expected().due.dueOn! }]
    renderApp('/coach/home')
    expect(await screen.findByRole('heading', { name: /^Needs you/ })).toBeInTheDocument()
    await waitFor(() => expect(reads).toContain('/rest/v1/season_evaluations'))
    await waitFor(() => expect(screen.queryByText('Loading who needs you')).toBeNull())
    expect(screen.queryByText('Evaluation due')).toBeNull()
    expect(screen.queryByText(/Never assessed/)).toBeNull()
  }, 30_000)

  it('without the season plan, Home is as it was: Quinn’s Assess card, no evaluation, nothing new read', async () => {
    seasonOn = false
    renderApp('/coach/home')
    expect(await screen.findByText(/^Never assessed, \d+ weeks in the squad$/)).toBeInTheDocument()
    expect(screen.getByText('Quinn Synthetic')).toBeInTheDocument()
    expect(screen.queryByText('Evaluation due')).toBeNull()
    expect(reads).not.toContain('/rest/v1/season_evaluations')
    expect(reads).not.toContain('/rest/v1/season_plans')
  }, 30_000)

  it('before the plan is shared there is nothing to evaluate, so the Assess cards stay', async () => {
    plan = { ...plan, shared_at: null, last_shared_at: null }
    renderApp('/coach/home')
    expect(await screen.findByText(/^Never assessed, \d+ weeks in the squad$/)).toBeInTheDocument()
    expect(screen.queryByText('Evaluation due')).toBeNull()
  }, 30_000)
})

describe('TRAK-364 the evaluation', () => {
  it('starts from last time, waits for a player with no ratings, and sends the note to the player alone', async () => {
    const { due } = expected()
    renderApp('/coach/evaluation')
    const list = await screen.findByRole('list', { name: 'Players' })
    expect(within(list).getByRole('button', { name: /^Pat Synthetic/ })).toHaveTextContent('Steady · 6.2')
    expect(within(list).getByRole('button', { name: /^Quinn Synthetic/ })).toHaveTextContent('Not rated yet')
    expect(within(list).queryByText('Rae Synthetic')).toBeNull()
    expect(screen.getByText(/^Not in this evaluation: Rae Synthetic\./)).toBeInTheDocument()

    await user().click(screen.getByRole('button', { name: 'Next: Publish' }))
    expect(screen.getByRole('button', { name: 'Publish to 2 players' })).toBeDisabled()
    expect(screen.getByText('Rate Quinn first: no ratings yet.')).toBeInTheDocument()
    await user().click(screen.getByRole('button', { name: 'Players' }))

    // Quinn: 5 each to start, Technical up to 8, a note, Done.
    await user().click(await screen.findByRole('button', { name: /^Quinn Synthetic/ }))
    expect(await screen.findByText(/^No ratings yet: each starts at 5\./)).toBeInTheDocument()
    setSlider(screen.getAllByRole('slider')[3], 8)
    await user().type(screen.getByLabelText('Note to Quinn'), 'Great first month.')
    expect(screen.getByText('Optional. Only Quinn sees it, never their family.')).toBeInTheDocument()
    await user().click(screen.getByRole('button', { name: 'Done' }))
    // Pat: last time's ratings, Work Rate up to 9.
    await user().click(await screen.findByRole('button', { name: /^Pat Synthetic/ }))
    expect(screen.getByText('From last time: Steady, 6.2. Move only what changed.')).toBeInTheDocument()
    setSlider(screen.getAllByRole('slider')[0], 9)
    await user().click(screen.getByRole('button', { name: 'Done' }))
    expect(await screen.findByText('1 player changed')).toBeInTheDocument()

    await user().click(screen.getByRole('button', { name: 'Next: Publish' }))
    const changed = screen.getByRole('region', { name: 'What changed' })
    expect(within(changed).getByText('Same band · 6.2 → 6.5')).toBeInTheDocument()
    expect(screen.getByText('Each player sees their band and your note to them. Their family sees the band, never the note. Nobody sees another player’s.')).toBeInTheDocument()

    // A failed publish keeps everything entered; the next one sends exactly the same.
    failNext = 1
    await user().click(screen.getByRole('button', { name: 'Publish to 2 players' }))
    expect(await screen.findByText("Couldn't publish the evaluation. Check your connection and try again; everything you entered is still here.")).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'What changed' })).getByText('Same band · 6.2 → 6.5')).toBeInTheDocument()
    await user().click(screen.getByRole('button', { name: 'Publish to 2 players' }))
    expect(await screen.findByText('Published to 2 players.')).toBeInTheDocument()
    const sent = {
      p_plan_id: 'plan-1', p_due_on: due.dueOn, p_objectives: [],
      p_players: [
        { squad_player_id: 'pat', work_rate: 9, tactical: 6, attitude: 6, technical: 6, physical: 6, coachability: 6, note: '' },
        { squad_player_id: 'quinn', work_rate: 5, tactical: 5, attitude: 5, technical: 8, physical: 5, coachability: 5, note: 'Great first month.' },
      ],
    }
    expect(published).toEqual([sent, sent])
    expect(screen.getByText(/^The next evaluation opens /)).toBeInTheDocument()
  }, 45_000)

  it('keeps what was entered while the coach is away from the screen', async () => {
    renderApp('/coach/evaluation')
    await user().click(await screen.findByRole('button', { name: /^Quinn Synthetic/ }))
    await user().type(screen.getByLabelText('Note to Quinn'), 'Keep going.')
    await user().click(screen.getByRole('button', { name: 'Done' }))
    cleanup()
    renderApp('/coach/evaluation')
    await user().click(await screen.findByRole('button', { name: /^Quinn Synthetic/ }))
    expect(screen.getByLabelText('Note to Quinn')).toHaveValue('Keep going.')
  }, 30_000)

  it('before its date, says when it opens', async () => {
    evaluations = [{ plan_id: 'plan-1', due_on: expected().due.dueOn! }]
    const { due } = expected()
    renderApp('/coach/evaluation')
    expect(await screen.findByText(new RegExp(`^The next evaluation opens ${evalDay(due.next!, true)}\\.`))).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Players' })).toBeNull()
  }, 30_000)
})

describe('TRAK-364 the rhythm', () => {
  it('step 1 asks how often and on which day, shows the first date, and saves it', async () => {
    plan = { ...plan, shared_at: null, last_shared_at: null, eval_every: 'month', eval_day: 0 }
    renderApp('/coach/season-plan')
    const every = await screen.findByRole('group', { name: 'Evaluate each player' })
    expect(within(every).getByRole('button', { name: 'Every month' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(screen.getByRole('group', { name: 'On the last' })).getByRole('button', { name: 'Sunday' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText(/^First evaluation \w{3} \d+ \w{3} \d{4}: each player’s six ratings/)).toBeInTheDocument()
    await user().click(within(every).getByRole('button', { name: 'Every 2 weeks' }))
    await user().click(within(screen.getByRole('group', { name: 'On a' })).getByRole('button', { name: 'Saturday' }))
    await user().click(screen.getByRole('button', { name: 'Save draft' }))
    await waitFor(() => expect(patches.at(-1)).toMatchObject({ eval_every: '2w', eval_day: 6 }))
  }, 30_000)

  it('after sharing, View plan says it with an Edit; a new rhythm waits under Not shared yet as the evaluation dates', async () => {
    evaluations = [{ plan_id: 'plan-1', due_on: expected().due.dueOn! }]
    renderApp('/coach/season-plan')
    const season = await screen.findByRole('region', { name: 'Season' })
    expect(await within(season).findByText(/^Every 2 weeks, on Sunday · Next evaluation /)).toBeInTheDocument()
    await user().click(within(season).getByRole('button', { name: 'Edit how often you evaluate' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Evaluation' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    await user().click(screen.getByRole('button', { name: 'Every 6 weeks' }))
    await user().click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Not shared yet: evaluation dates.')).toBeInTheDocument()
    expect(patches).toEqual([{ eval_every: '6w', eval_day: 0 }])
  }, 30_000)
})

/* TRAK-365 (Season plan 17/18): the evaluation also asks how each open objective is going. Every open objective needs a
   status before Publish; Met closes one and makes room for another; the publish sends it all in one call. */
describe('TRAK-365 objectives in the evaluation', () => {
  const objective = (id: string, title: string, slot: number) => ({
    id, squad_player_id: 'pat', slot, title, source: 'own', season_objective_id: null, status: 'open', retired_at: null, created_at: '2026-09-01T08:00:00Z',
  })
  const ratings = { work_rate: 6, tactical: 6, attitude: 6, technical: 6, physical: 6, coachability: 6, created_at: '2026-08-20T10:00:00Z', published_at: '2026-08-20T10:00:00Z' }

  it('asks Progress for each objective, lets Met free a place for another, and sends it all at once', async () => {
    server.use(
      table('coach_assessments', [{ ...ratings, squad_player_id: 'pat' }, { ...ratings, squad_player_id: 'quinn' }]),
      table('player_objectives', [objective('oa', 'Win it back within 5 seconds', 1), objective('ob', 'Scan before receiving', 2)]),
    )
    const { due } = expected()
    renderApp('/coach/evaluation')
    const list = await screen.findByRole('list', { name: 'Players' })
    expect(within(list).getByRole('button', { name: /^Pat Synthetic/ })).toHaveTextContent('Objectives to rate')
    expect(within(list).getByRole('button', { name: /^Quinn Synthetic/ })).not.toHaveTextContent('Objectives to rate')

    await user().click(screen.getByRole('button', { name: 'Next: Publish' }))
    expect(screen.getByRole('button', { name: 'Publish to 2 players' })).toBeDisabled()
    expect(screen.getByText('Say how Pat is doing on their objectives first.')).toBeInTheDocument()
    await user().click(screen.getByRole('button', { name: 'Players' }))

    await user().click(await screen.findByRole('button', { name: /^Pat Synthetic/ }))
    const first = screen.getByRole('group', { name: 'Progress on Win it back within 5 seconds' })
    const second = screen.getByRole('group', { name: 'Progress on Scan before receiving' })
    // Two are open, so there is no room to add another yet.
    expect(screen.queryByLabelText('Add another objective')).toBeNull()
    await user().click(within(first).getByRole('button', { name: 'Not yet' }))
    await user().click(within(second).getByRole('button', { name: 'Met' }))
    // Met freed a place: one can be added, then the room is gone again.
    await user().type(await screen.findByLabelText('Add another objective'), 'Run in behind')
    await user().click(screen.getByRole('button', { name: 'Add' }))
    expect(screen.getByText('New: Run in behind')).toBeInTheDocument()
    expect(screen.queryByLabelText('Add another objective')).toBeNull()
    await user().click(screen.getByRole('button', { name: 'Done' }))

    await user().click(screen.getByRole('button', { name: 'Next: Publish' }))
    await user().click(screen.getByRole('button', { name: 'Publish to 2 players' }))
    await waitFor(() => expect(published).toHaveLength(1))
    expect(published[0]).toMatchObject({
      p_plan_id: 'plan-1', p_due_on: due.dueOn,
      p_objectives: [{ squad_player_id: 'pat', progress: [
        { player_objective_id: 'oa', status: 'not_yet' }, { player_objective_id: 'ob', status: 'met' },
      ], add: ['Run in behind'] }],
    })
  }, 45_000)

  it('shows a stuck objective on Home with its three choices, and Make it simpler sends the easier version', async () => {
    const resolved: Record<string, unknown>[] = []
    server.use(
      table('player_objectives', [objective('oa', 'Win it back within 5 seconds', 1)]),
      rpc('stuck_player_objectives', () => [{ player_objective_id: 'oa', squad_player_id: 'pat' }]),
      http.post(`${SUPABASE_URL}/rest/v1/rpc/resolve_stuck_objective`, async ({ request }) => {
        resolved.push(await request.json() as Record<string, unknown>)
        return new HttpResponse(null, { status: 204 })
      }),
    )
    renderApp('/coach/home')
    const card = (await screen.findByText('Pat is stuck on an objective')).closest('div')!.parentElement!
    expect(within(card).getByText('“Win it back within 5 seconds”: Not yet three times in a row.')).toBeInTheDocument()
    await user().click(within(card).getByRole('button', { name: 'Choose' }))
    expect(await screen.findByRole('button', { name: 'Keep going' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Swap it' })).toBeInTheDocument()
    await user().click(screen.getByRole('button', { name: 'Make it simpler' }))
    // Prefilled with the current wording: the same wording can't be saved as the easier version.
    expect(screen.getByLabelText('The easier version')).toHaveValue('Win it back within 5 seconds')
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    await user().clear(screen.getByLabelText('The easier version'))
    await user().type(screen.getByLabelText('The easier version'), 'Win it back within 8 seconds')
    await user().click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(resolved).toEqual([{ p_player_objective_id: 'oa', p_choice: 'simpler', p_title: 'Win it back within 8 seconds' }]))
  }, 30_000)
})
