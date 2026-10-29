/**
 * TRAK-287 (Games 5/8): locked at kick-off. With the page open, the plan turns read-only at kick-off, with no reload:
 * an alert says so, Save and Share go, the fields read only, and the pickers show their choice in words. The alert
 * says what wasn't shared (Imad, 28 Oct). Home's plan card closes at kick-off too. Test people are named after
 * footballers.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { renderApp } from '../../../../tests/support/render-app'
import { signInAs } from '../../../../tests/support/session'
import { server } from '../../../../tests/msw/server'
import { table, rpc, SUPABASE_URL } from '../../../../tests/msw/supabase'

const phoneTZ = process.env.TZ
beforeAll(() => { process.env.TZ = 'Asia/Dubai' })
afterAll(() => { process.env.TZ = phoneTZ })

const MINUTE = 60_000
let n = 0
let COACH = { id: 'coach-287' }

/** A match kicking off `ms` from now (negative: it has), on the academy's clock (Dubai, UTC+4). */
function game(ms: number) {
  const kickOff = Date.now() + ms
  const at = new Date(kickOff + 4 * 60 * MINUTE).toISOString()
  return {
    id: 'g1', coach_user_id: COACH.id, squad: 'U16', title: 'vs Parkview Athletic', event_type: 'match', published: true, status: 'scheduled',
    starts_at: new Date(kickOff).toISOString(), ends_at: new Date(kickOff + 90 * MINUTE).toISOString(),
    event_date: at.slice(0, 10), start_time: `${at.slice(11, 19)}`, end_time: null, meet_time: null,
    opponent: 'Parkview Athletic', home_away: 'home', venue: 'Rehearsal Park', kit: null, kit_snapshot: null,
    family_note: null, notes: null, series_id: null, training_theme: null, cancel_reason: null,
  }
}
const child = (id: string, name: string, shirt: number) =>
  ({ id, coach_user_id: COACH.id, player_name: name, age_group: 'U16', status: 'active', shirt_number: shirt, position: 'Midfielder', created_at: '2026-10-01T08:00:00Z' })
const PLAN = {
  event_id: 'g1', strength: 'similar', their_formation: '4-3-3', key_players: [], scouting: 'Their 9 is quick.', format: 11, formation: '4-4-2',
  goals: [{ title: 'Win the second ball', looks_like: 'First to every loose ball in midfield.' }],
  created_at: '2026-10-28T09:00:00Z', updated_at: '2026-10-28T09:00:00Z',
}
const LINE_UP = [{ event_id: 'g1', squad_player_id: 'zagorakis', role: 'starter', slot: 4, job: 'Stay tight to their winger.',
  note: 'Second game at right-back. Proud of you.', context: ['out_of_position'], expectation: 'stretch' }]

function setup({ kickOffIn, shared = false, changes = [] as string[] }: { kickOffIn: number; shared?: boolean; changes?: string[] }) {
  server.use(
    table('coach_calendar_events', [game(kickOffIn)]),
    table('game_plans', [PLAN]),
    table('game_plan_players', LINE_UP),
    table('game_shares', shared ? [{ event_id: 'g1', shared_at: '2026-10-27T15:30:00Z' }] : []),
    rpc('game_plan_changes', () => changes.map(squad_player_id => ({ event_id: 'g1', squad_player_id }))),
    // A write here would mean the page still lets the coach change a locked plan.
    http.post(`${SUPABASE_URL}/rest/v1/game_plans`, () => { throw new Error('a locked plan was written') }),
  )
}

beforeEach(() => {
  COACH = { id: `coach-287-${++n}` }
  signInAs(COACH)
  server.use(
    table('profiles', [{ id: 'p', user_id: COACH.id, role: 'coach', full_name: 'Otto Rehhagel', invite_code: 'ABCD' }]),
    table('coach_details', [{ user_id: COACH.id, coach_role: 'Head Coach', team: 'U16', organization_id: 'org-1' }]),
    table('organizations', [{ id: 'org-1', name: 'Rehearsal FC', logo_url: null }]),
    table('squad_players', [child('zagorakis', 'Theodoros Zagorakis', 7), child('charisteas', 'Angelos Charisteas', 9)]),
    table('event_confirmations', []),
    table('event_absences', []),
    rpc('coach_squad_player_consent_required', () => false),
    table('coach_assessments', []),
    table('coach_sessions', []),
    table('session_attendance', []),
    table('notification_settings', []),
    table('training_plans', []),
    rpc('feature_on', () => true),
    // TRAK-288: no evaluation yet.
    table('game_evaluations', []),
    table('game_evaluation_players', []),
    table('game_evaluation_notes', []),
  )
})
afterEach(() => { vi.useRealTimers(); cleanup(); localStorage.clear() })

describe('TRAK-287: locked at kick-off', { timeout: 30_000 }, () => {
  it('with the page open, kick-off turns the plan read-only, with no reload', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    setup({ kickOffIn: 30_000 })
    renderApp('/coach/games/g1?tab=plan')
    const goal = await screen.findByRole('textbox', { name: 'Goal' })
    expect(goal).not.toHaveAttribute('readonly')
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Strength' })).toBeInTheDocument()

    await act(async () => { await vi.advanceTimersByTimeAsync(31_000) })

    expect(await screen.findByText(/^Locked at kick-off, \d\d:\d\d$/)).toBeInTheDocument()
    expect(screen.getByRole('timer', { name: 'Kick-off in' })).toHaveTextContent('Locked')
    expect(screen.getByText(/Jobs and expectations are fixed, so the evaluation reads against what you expected before the game\./)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save draft' })).toBeNull()
    expect(screen.getByRole('textbox', { name: 'Goal' })).toHaveAttribute('readonly')
    expect(screen.queryByRole('button', { name: /Add a goal|Add a key player/ })).toBeNull()
    // The pickers show their choice in words.
    expect(screen.queryByRole('group', { name: 'Strength' })).toBeNull()
    expect(screen.getByText('Similar')).toBeInTheDocument()
    expect(screen.getByText('4-3-3')).toBeInTheDocument()
  })

  it('locked as a draft, the alert says only the coach saw it, and Share is gone', async () => {
    const user = userEvent.setup()
    setup({ kickOffIn: -MINUTE })
    renderApp('/coach/games/g1?tab=plan&step=share')
    expect(await screen.findByText(/It wasn’t shared, so only you saw it\./)).toBeInTheDocument()
    expect(await screen.findByRole('region', { name: 'Not shared' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Share now' })).toBeNull()
    // The preview still shows what it would have said.
    expect(within(screen.getByRole('region', { name: 'Preview' })).getByText('Stay tight to their winger.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(await screen.findByRole('heading', { name: '4-4-2' })).toBeInTheDocument()
  })

  it('shared with changes still unshared, the alert counts who didn\'t get them; there is no Share the changes', async () => {
    setup({ kickOffIn: -MINUTE, shared: true, changes: ['zagorakis', 'charisteas'] })
    renderApp('/coach/games/g1?tab=plan&step=share')
    expect(await screen.findByText(/2 players didn’t get your last changes\./)).toBeInTheDocument()
    const shared = screen.getByRole('region', { name: 'Shared' })
    expect(within(shared).queryByRole('button', { name: /Share the changes/ })).toBeNull()
    expect(shared).not.toHaveTextContent('Edits stay with you')
  })

  it('the player\'s sheet only shows: the job reads only, context and expectation are words, nothing moves', async () => {
    const user = userEvent.setup()
    setup({ kickOffIn: -MINUTE })
    renderApp('/coach/games/g1?tab=plan')
    await user.click(await screen.findByRole('button', { name: 'Next: Line-up and jobs' }))
    await user.click(await screen.findByRole('button', { name: /^Theodoros Zagorakis, slot 4/ }))
    const sheet = await screen.findByRole('complementary', { name: 'Theodoros Zagorakis' })
    expect(within(sheet).getByRole('textbox', { name: /^Job · / })).toHaveAttribute('readonly')
    expect(within(sheet).getByText('Out of position')).toBeInTheDocument()
    expect(within(sheet).getByText('Stretch')).toBeInTheDocument()
    expect(within(sheet).queryByRole('button', { name: 'Take off the pitch' })).toBeNull()
    expect(within(sheet).queryByRole('group', { name: /Expectation/ })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Slot 1, empty' }))
    expect(await screen.findByText('Nobody was placed here before kick-off.')).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'Who plays here?' })).toBeNull()
  })

  it('Home\'s plan card closes at kick-off, with Home open', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    setup({ kickOffIn: 30_000 })
    server.use(table('game_plans', []), table('game_plan_players', []))
    renderApp('/coach/home')
    const needs = await screen.findByRole('region', { name: /Needs you/ }, { timeout: 5000 })
    expect(await within(needs).findByText('vs Parkview Athletic')).toBeInTheDocument()
    await act(async () => { await vi.advanceTimersByTimeAsync(31_000) })
    expect(within(needs).queryByText('vs Parkview Athletic')).toBeNull()
  })
})
