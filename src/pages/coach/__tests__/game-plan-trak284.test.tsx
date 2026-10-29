/**
 * TRAK-284 (Games 2/8): plan step 1, opponent and goals, saved as a draft only the coach sees. The draft saves and
 * reloads; a fourth goal can't be added; a failed save keeps the form. Switching tabs keeps what was typed:
 * e2e/games.spec.ts checks that in a browser, where the panel's exit animation runs. Test people are named after
 * footballers.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, screen, within } from '@testing-library/react'
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
const DAY = 24 * 60 * MINUTE
let n = 0
let COACH = { id: 'coach-284' }

/** A Dubai academy's match five days out (UTC+4 all year). */
function game() {
  const kickOff = Math.ceil((Date.now() + 5 * DAY) / MINUTE) * MINUTE
  const at = new Date(kickOff + 4 * 60 * MINUTE).toISOString()
  return {
    id: 'g1', coach_user_id: COACH.id, squad: 'U16', title: 'vs Parkview Athletic', event_type: 'match', published: true, status: 'scheduled',
    starts_at: new Date(kickOff).toISOString(), ends_at: new Date(kickOff + 90 * MINUTE).toISOString(),
    event_date: at.slice(0, 10), start_time: `${at.slice(11, 16)}:00`, end_time: null, meet_time: null,
    opponent: 'Parkview Athletic', home_away: 'home', venue: 'Rehearsal Park', kit: null, kit_snapshot: null,
    family_note: null, notes: null, series_id: null, training_theme: null, cancel_reason: null,
  }
}

/** game_plans as the database keeps it for this coach: one row per match, written by the app's upsert. */
function plans({ failSaves = false } = {}) {
  const store = new Map<string, Record<string, unknown>>()
  const saves: Record<string, unknown>[] = []
  const state = { failSaves }
  server.use(
    http.get(`${SUPABASE_URL}/rest/v1/game_plans`, ({ request }) => {
      const id = new URL(request.url).searchParams.get('event_id')?.replace('eq.', '')
      return HttpResponse.json([...store.values()].filter(row => !id || row.event_id === id))
    }),
    http.post(`${SUPABASE_URL}/rest/v1/game_plans`, async ({ request }) => {
      if (state.failSaves) return HttpResponse.json({ message: 'Failed to fetch' }, { status: 503 })
      const body = await request.json() as Record<string, unknown>
      saves.push(body)
      store.set(body.event_id as string, { ...body, created_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      return new HttpResponse(null, { status: 201 })
    }),
  )
  return { saves, state }
}

beforeEach(() => {
  COACH = { id: `coach-284-${++n}` }
  signInAs(COACH)
  server.use(
    table('profiles', [{ id: 'p', user_id: COACH.id, role: 'coach', full_name: 'Otto Rehhagel', invite_code: 'ABCD' }]),
    table('coach_details', [{ user_id: COACH.id, coach_role: 'Head Coach', team: 'U16', organization_id: 'org-1' }]),
    table('organizations', [{ id: 'org-1', name: 'Rehearsal FC', logo_url: null }]),
    table('squad_players', [{ id: 'sp-1', coach_user_id: COACH.id, player_name: 'Angelos Charisteas', age_group: 'U16', status: 'active' }]),
    table('coach_sessions', []),
    table('session_attendance', []),
    table('event_absences', []),
    table('coach_calendar_events', [game()]),
    table('game_plan_players', []),
    table('event_confirmations', []),
    table('coach_assessments', []),
    rpc('coach_squad_player_consent_required', () => false),
    rpc('feature_on', () => true),
    // TRAK-288: no evaluation yet.
    table('game_evaluations', []),
    table('game_evaluation_players', []),
    table('game_evaluation_notes', []),
    table('game_shares', []),
    rpc('game_plan_changes', () => []),
  )
})
afterEach(() => { cleanup(); localStorage.clear() })

const goal = (number: number) => screen.getByRole('group', { name: `Goal ${number}` })
const keyPlayer = (number: number) => screen.getByRole('group', { name: `Key player ${number}` })

describe('TRAK-284: plan step 1, opponent and goals', { timeout: 30_000 }, () => {
  it('saves a draft only the coach sees, and it comes back when the page opens again', async () => {
    const user = userEvent.setup()
    const { saves } = plans()
    renderApp('/coach/games/g1?tab=plan')
    expect(await screen.findByRole('heading', { name: 'Your goals' })).toBeInTheDocument()
    expect(screen.getByText('Plan not written')).toBeInTheDocument()
    const steps = screen.getByRole('navigation', { name: 'Game plan' })
    expect(steps).toHaveTextContent(/Opponent and goals.*Line-up and jobs.*Share/)
    expect(steps.querySelector('[aria-current="step"]')).toHaveTextContent('Opponent and goals')

    await user.type(within(goal(1)).getByLabelText('Goal'), 'Win it back in their half')
    await user.type(within(goal(1)).getByLabelText('What it looks like'), 'Press when their keeper plays short.')
    await user.click(screen.getByRole('radio', { name: /Stronger/ }))
    screen.getByRole('combobox', { name: 'Their formation' }).focus()
    await user.keyboard('{Enter}')
    await user.click(await screen.findByRole('option', { name: '4-3-3' }))
    await user.click(screen.getByRole('button', { name: 'Add a key player' }))
    await user.type(within(keyPlayer(1)).getByLabelText('Number'), 'a9')
    await user.type(within(keyPlayer(1)).getByLabelText('Position'), 'Striker')
    await user.type(within(keyPlayer(1)).getByLabelText('Note'), 'Quick. Runs in behind.')
    await user.type(screen.getByLabelText('What you know about them'), 'Their keeper plays short.')
    await user.click(screen.getByRole('button', { name: 'Save draft' }))

    expect(await screen.findByRole('button', { name: 'Saved' })).toBeInTheDocument()
    expect(saves).toEqual([{
      event_id: 'g1', strength: 'stronger', their_formation: '4-3-3', scouting: 'Their keeper plays short.',
      key_players: [{ number: 9, position: 'Striker', note: 'Quick. Runs in behind.' }],
      goals: [{ title: 'Win it back in their half', looks_like: 'Press when their keeper plays short.' }],
      format: 11, formation: null,
    }])
    expect(await screen.findByText('Plan not shared')).toBeInTheDocument()

    await user.type(screen.getByLabelText('What you know about them'), ' Their 7 drifts inside.')
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeInTheDocument()

    cleanup()
    renderApp('/coach/games/g1?tab=plan')
    expect(await screen.findByDisplayValue('Win it back in their half')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /Stronger/ })).toBeChecked()
    expect(screen.getByRole('combobox', { name: 'Their formation' })).toHaveTextContent('4-3-3')
    expect(within(keyPlayer(1)).getByLabelText('Number')).toHaveValue('9')
    expect(screen.getByLabelText('What you know about them')).toHaveValue('Their keeper plays short.')
    expect(screen.getByText('Plan not shared')).toBeInTheDocument()
  })

  it('takes up to three goals: a fourth can\'t be added, and one can be removed', async () => {
    const user = userEvent.setup()
    plans()
    renderApp('/coach/games/g1?tab=plan')
    await user.click(await screen.findByRole('button', { name: 'Add a goal' }))
    await user.click(screen.getByRole('button', { name: 'Add a goal' }))
    expect(screen.getAllByRole('group', { name: /^Goal \d$/ })).toHaveLength(3)
    expect(screen.queryByRole('button', { name: 'Add a goal' })).toBeNull()

    await user.type(within(goal(3)).getByLabelText('Goal'), 'Keeper owns the box')
    await user.click(screen.getByRole('button', { name: 'Remove goal 2' }))
    expect(screen.getAllByRole('group', { name: /^Goal \d$/ })).toHaveLength(2)
    expect(within(goal(2)).getByLabelText('Goal')).toHaveValue('Keeper owns the box')
    expect(screen.getByRole('button', { name: 'Add a goal' })).toBeInTheDocument()
  })

  it('a failed save keeps everything typed and says so; saving again works', async () => {
    const user = userEvent.setup()
    const { saves, state } = plans({ failSaves: true })
    renderApp('/coach/games/g1?tab=plan')
    await user.type(within(await screen.findByRole('group', { name: 'Goal 1' })).getByLabelText('Goal'), 'Switch play to the free side')
    await user.click(screen.getByRole('button', { name: 'Save draft' }))

    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't save the plan. Check your connection and try again; everything you typed is still here.")
    expect(within(goal(1)).getByLabelText('Goal')).toHaveValue('Switch play to the free side')
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeInTheDocument()
    expect(screen.getByText('Plan not written')).toBeInTheDocument()

    state.failSaves = false
    await user.click(screen.getByRole('button', { name: 'Save draft' }))
    expect(await screen.findByRole('button', { name: 'Saved' })).toBeInTheDocument()
    expect(saves).toHaveLength(1)
  })

  it('a shirt number is 1 to 99 or blank; a 0 stops the save and says where', async () => {
    const user = userEvent.setup()
    const { saves } = plans()
    renderApp('/coach/games/g1?tab=plan')
    await user.click(await screen.findByRole('button', { name: 'Add a key player' }))
    await user.type(within(keyPlayer(1)).getByLabelText('Number'), '0')
    await user.click(screen.getByRole('button', { name: 'Save draft' }))
    expect(await screen.findByText('A shirt number goes from 1 to 99. Fix the one marked above, then save.')).toBeInTheDocument()
    expect(within(keyPlayer(1)).getByLabelText('Number')).toHaveAccessibleDescription('From 1 to 99')
    expect(saves).toHaveLength(0)

    await user.type(within(keyPlayer(1)).getByLabelText('Number'), '7')
    await user.click(within(keyPlayer(1)).getByRole('button', { name: 'Remove key player 1' }))
    expect(screen.getByText('No key players yet.')).toBeInTheDocument()
  })
})
