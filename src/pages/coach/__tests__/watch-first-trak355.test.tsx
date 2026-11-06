/**
 * TRAK-355 (Season plan 7/18, spec TRAK-348): watch first. The coach sets the squad's reminder (trainings offered only
 * where the squad has them, Tarek 6 Nov), watches a player instead of setting them up, and Squad shows them as
 * Watching. When the reminder is due, Home's Needs you brings them back, and the card opens the step where they were
 * left with their sheet open; once they're set up, the card goes. Save · next passes over a player still watched.
 * Synthetic people; the stand-in backend remembers what's saved.
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

type Row = { id: string; coach_user_id: string; player_name: string; age_group: string; status: string; shirt_number: number; position: string | null; created_at: string; linked_player_id: string | null }
type Watch = { squad_player_id: string; since: string }

let n = 0
let COACH = { id: 'coach-355' }
let squad: Row[] = []
let watches: Watch[] = []
let held: { id: string; squad_player_id: string; title: string; source: string; season_objective_id: string | null; created_at: string }[] = []
let plan = { id: 'plan-1', squad: 'U16', starts_on: null, ends_on: null, shared_at: null, positions_known: 'yes', watch_rule: 'w2' }
let watchCalls: string[][] = []
let ruleWrites: unknown[] = []
let trainings: { squad: string | null; status: string }[] = []

const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString()
const child = (i: number, name: string, position: string | null): Row => ({
  id: `p${i}`, coach_user_id: COACH.id, player_name: name, age_group: 'U16', status: 'active',
  shirt_number: i, position, created_at: '2026-10-01T08:00:00Z', linked_player_id: `child-${i}`,
})

beforeEach(() => {
  localStorage.clear()
  COACH = { id: `coach-355-${++n}` }
  squad = [child(1, 'Omar Synthetic', null), child(2, 'Bea Synthetic', 'Defender'), child(3, 'Cal Synthetic', 'Attacker'), child(4, 'Dee Synthetic', 'Midfielder')]
  watches = []
  held = [{ id: 'o1', squad_player_id: 'p3', title: 'Runs in behind', source: 'library', season_objective_id: null, created_at: '2026-11-01T08:00:00Z' }]
  plan = { id: 'plan-1', squad: 'U16', starts_on: null, ends_on: null, shared_at: null, positions_known: 'yes', watch_rule: 'w2' }
  watchCalls = []
  ruleWrites = []
  trainings = []
  signInAs(COACH)
  server.use(
    table('profiles', [{ id: 'p', user_id: COACH.id, role: 'coach', full_name: 'Synthetic Coach', invite_code: 'ABCD' }]),
    table('coach_details', [{ user_id: COACH.id, coach_role: 'Head Coach', team: 'U16', organization_id: 'org-1' }]),
    table('organizations', [{ id: 'org-1', name: 'Rehearsal FC', logo_url: null, time_zone: 'Asia/Dubai' }]),
    http.get(`${SUPABASE_URL}/rest/v1/squad_players`, () => HttpResponse.json(squad)),
    rpc('coach_squad_player_consent_required', () => false),
    rpc('feature_on', () => true),
    http.get(`${SUPABASE_URL}/rest/v1/season_plans`, () => HttpResponse.json([plan])),
    http.patch(`${SUPABASE_URL}/rest/v1/season_plans`, async ({ request }) => {
      const body = await request.json() as { watch_rule?: string }
      ruleWrites.push(body)
      plan = { ...plan, ...body } as typeof plan
      return new HttpResponse(null, { status: 204 })
    }),
    table('season_objectives', []),
    http.get(`${SUPABASE_URL}/rest/v1/player_watches`, () => HttpResponse.json(watches)),
    http.post(`${SUPABASE_URL}/rest/v1/rpc/watch_players`, async ({ request }) => {
      const { p_squad_player_ids: ids } = await request.json() as { p_squad_player_ids: string[] }
      watchCalls.push(ids)
      const watched = ids.filter(id => !held.some(o => o.squad_player_id === id))
      watches = [...watches.filter(w => !watched.includes(w.squad_player_id)), ...watched.map(id => ({ squad_player_id: id, since: new Date().toISOString() }))]
      return HttpResponse.json(watched.length)
    }),
    http.get(`${SUPABASE_URL}/rest/v1/player_objectives`, () => HttpResponse.json(held)),
    http.post(`${SUPABASE_URL}/rest/v1/rpc/save_player_objectives`, async ({ request }) => {
      const body = await request.json() as { p_squad_player_id: string; p_objectives: { title: string; source: string; season_objective_id: string | null }[] }
      held = [...held.filter(o => o.squad_player_id !== body.p_squad_player_id), ...body.p_objectives.map((o, i) => ({ ...o, id: `o-${body.p_squad_player_id}-${i}`, squad_player_id: body.p_squad_player_id, created_at: new Date().toISOString() }))]
      // As the database does: objectives end the watch.
      if (body.p_objectives.length) watches = watches.filter(w => w.squad_player_id !== body.p_squad_player_id)
      return new HttpResponse(null, { status: 204 })
    }),
    http.get(`${SUPABASE_URL}/rest/v1/coach_calendar_events`, ({ request }) =>
      HttpResponse.json(new URL(request.url).searchParams.get('event_type') === 'eq.training' ? trainings : [])),
    table('coach_sessions', []),
    table('session_attendance', []),
    table('squad_player_also_plays', []),
    table('squad_player_roles', []),
    table('training_notes', []),
    table('squad_player_profiles', []),
    rpc('coach_player_birth_dates', () => []),
    rpc('coach_squad_season', () => []),
    table('coach_assessments', []),
    table('coach_assessment_notes', []),
    table('coach_shared_feedback', []),
    table('event_absences', []),
    table('event_confirmations', []),
    table('notification_settings', []),
    table('game_plans', []),
    table('game_evaluations', []),
    rpc('game_plan_changes', () => []),
    http.get(`${SUPABASE_URL}/rest/v1/game_shares`, () => HttpResponse.json([])),
  )
})
afterEach(() => { cleanup(); forgetScreens(); localStorage.clear() })

const user = () => userEvent.setup()
const rulePicker = () => screen.getByRole('group', { name: /^Remind me/ })

describe('TRAK-355 watch first', () => {
  it('Not yet watches everyone, and the reminder is the squad\'s: weeks only where it has no trainings', async () => {
    plan = { ...plan, positions_known: null as unknown as string }
    renderApp('/coach/season-plan/positions')
    await user().click(await screen.findByRole('radio', { name: /^Not yet/ }))
    await user().click(screen.getByRole('button', { name: 'Continue' }))
    await waitFor(() => expect(watchCalls).toEqual([['p1', 'p2', 'p4', 'p3']]))
    expect(await screen.findByText('Watching 3 players first. Nothing goes out until you share the plan.')).toBeInTheDocument()
    // No trainings on the schedule or in the register: weeks only.
    await waitFor(() => expect(within(rulePicker()).getAllByRole('button').map(b => b.textContent)).toEqual(['1 week', '2 weeks', '4 weeks']))
    expect(within(rulePicker()).getByRole('button', { name: '2 weeks' })).toHaveAttribute('aria-pressed', 'true')
    await user().click(within(rulePicker()).getByRole('button', { name: '4 weeks' }))
    // The answer saved first; then the reminder.
    await waitFor(() => expect(ruleWrites).toEqual([{ positions_known: 'not_yet' }, { watch_rule: 'w4' }]))
  }, 30_000)

  it('offers trainings where the squad has them on its schedule', async () => {
    trainings = [{ squad: 'U16', status: 'scheduled' }]
    watches = [{ squad_player_id: 'p4', since: daysAgo(1) }]
    renderApp('/coach/season-plan/objectives')
    await waitFor(() => expect(within(rulePicker()).getAllByRole('button').map(b => b.textContent)).toEqual(['1 week', '2 weeks', '4 weeks', '2 trainings', '4 trainings']))
  })

  it('Watch first from a player\'s sheet: they wait apart, Save · next passes over them, and Squad shows Watching', async () => {
    renderApp('/coach/season-plan/objectives')
    await user().click(await screen.findByRole('button', { name: /^Dee Synthetic/ }))
    const sheet = await screen.findByRole('dialog', { name: "Dee's objectives" })
    await user().click(within(sheet).getByRole('button', { name: 'Watch first' }))
    await waitFor(() => expect(watchCalls).toEqual([['p4']]))
    // The sheet moves on to Bea, and her Save · next has no one left: Dee is watched and Cal is set up.
    const bea = await screen.findByRole('dialog', { name: "Bea's objectives" })
    expect(within(bea).getByRole('button', { name: 'Save · back to the list' })).toBeInTheDocument()
    await user().click(within(bea).getByRole('button', { name: 'Cancel' }))
    const watching = await screen.findByRole('region', { name: /^Watching/ })
    expect(within(watching).getByRole('button', { name: /^Dee Synthetic/ })).toHaveTextContent('WatchingWatching: 0 of 2 weeks so far')

    cleanup()
    renderApp('/coach/squad')
    expect(await screen.findByRole('button', { name: /Dee Synthetic/ })).toHaveTextContent('Watching')
  }, 30_000)

  it('when the reminder is due, Home brings the player back; the card opens their sheet, and setting them up ends it', async () => {
    watches = [{ squad_player_id: 'p2', since: daysAgo(15) }]
    renderApp('/coach/home')
    const card = await screen.findByText('Watched 2 weeks · Set Bea up')
    expect(card).toBeInTheDocument()
    await user().click(within(card.closest('li, article, section, div[role="listitem"]') ?? document.body).getAllByRole('button', { name: 'Set up' })[0])
    await waitFor(() => expect(window.location.pathname).toBe('/coach/season-plan/objectives'))
    const sheet = await screen.findByRole('dialog', { name: "Bea's objectives" })
    expect(within(sheet).getByRole('button', { name: 'Keep watching' })).toBeInTheDocument()
    await user().click(within(within(sheet).getByRole('group', { name: /^Objectives for/ })).getByRole('button', { name: /^Wins their headers/ }))
    await user().click(within(sheet).getByRole('button', { name: /^Save/ }))
    await waitFor(() => expect(watches).toEqual([]))

    cleanup()
    renderApp('/coach/home')
    await screen.findByRole('heading', { name: /^Needs you/ })
    expect(screen.queryByText(/Set Bea up$/)).toBeNull()
  }, 30_000)

  it('a due player with no position goes back to Positions, their sheet open; the 4-week net brings them', async () => {
    // Four trainings asked for, none attended: only the safety net brings Omar back.
    plan = { ...plan, watch_rule: 't4' }
    trainings = [{ squad: 'U16', status: 'scheduled' }]
    watches = [{ squad_player_id: 'p1', since: daysAgo(29) }]
    renderApp('/coach/home')
    const card = await screen.findByText('Watched 4 weeks · Set Omar up')
    await user().click(within(card.closest('li, article, section, div[role="listitem"]') ?? document.body).getAllByRole('button', { name: 'Set up' })[0])
    await waitFor(() => expect(window.location.pathname).toBe('/coach/season-plan/positions'))
    expect(await screen.findByRole('dialog', { name: "Omar's position and roles" })).toBeInTheDocument()
  }, 30_000)
})
