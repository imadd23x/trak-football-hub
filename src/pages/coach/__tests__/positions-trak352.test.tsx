/**
 * TRAK-352 (Season plan 4/18, spec TRAK-348): step 2, Positions. The coach answers "Do you know where they play
 * yet?", then places every consented player with taps only, and the count follows. Not yet saves with nobody placed.
 * Nobody gets a midfielder default, a failed tap goes back and says so, and children waiting for consent are
 * counted, not listed. Home's Needs you asks for anyone unplaced. Moving between steps keeps what was typed.
 * Synthetic people.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { renderApp } from '../../../../tests/support/render-app'
import { signInAs } from '../../../../tests/support/session'
import { server } from '../../../../tests/msw/server'
import { table, rpc, SUPABASE_URL } from '../../../../tests/msw/supabase'

type Plan = { id: string; squad: string; starts_on: string | null; ends_on: string | null; shared_at: string | null; positions_known: string | null }
type Row = { id: string; coach_user_id: string; player_name: string; age_group: string; status: string; shirt_number: number; position: string | null; created_at: string; linked_player_id: string | null }

let n = 0
let COACH = { id: 'coach-352' }
let plans: Plan[] = []
let squad: Row[] = []
let waiting = new Set<string>()
let placed: { id: string; position: string }[] = []
let planWrites: unknown[] = []
let failPlacing = false
let switchOn = true
let switchAnswered = false

const param = (url: URL, key: string) => url.searchParams.get(key)?.replace(/^eq\./, '') ?? null
const child = (i: number, position: string | null = null): Row => ({
  id: `p${i}`, coach_user_id: COACH.id, player_name: `Synthetic Player ${String(i).padStart(2, '0')}`, age_group: 'U16', status: 'active',
  shirt_number: i, position, created_at: '2026-10-01T08:00:00Z', linked_player_id: `child-${i}`,
})

beforeEach(() => {
  COACH = { id: `coach-352-${++n}` }
  plans = []
  squad = []
  waiting = new Set()
  placed = []
  planWrites = []
  failPlacing = false
  switchOn = true
  switchAnswered = false
  signInAs(COACH)
  server.use(
    // TRAK-355: who the coach is watching; no one.
    table('player_watches', []),
    table('profiles', [{ id: 'p', user_id: COACH.id, role: 'coach', full_name: 'Synthetic Coach', invite_code: 'ABCD' }]),
    table('coach_details', [{ user_id: COACH.id, coach_role: 'Head Coach', team: 'U16', organization_id: 'org-1' }]),
    table('organizations', [{ id: 'org-1', name: 'Rehearsal FC', logo_url: null }]),
    http.get(`${SUPABASE_URL}/rest/v1/squad_players`, () => HttpResponse.json(squad)),
    rpc('coach_squad_player_consent_required', args => waiting.has(String(args.p_squad_player_id))),
    rpc('feature_on', args => { if (args.p_feature === 'season_plan') switchAnswered = true; return args.p_feature !== 'season_plan' || switchOn }),
    http.post(`${SUPABASE_URL}/rest/v1/rpc/set_player_position`, async ({ request }) => {
      const { p_squad_player_id: id, p_position: position } = await request.json() as { p_squad_player_id: string; p_position: string }
      if (failPlacing) return HttpResponse.json({ message: 'down' }, { status: 503 })
      placed.push({ id, position })
      squad = squad.map(row => (row.id === id ? { ...row, position } : row))
      return HttpResponse.json(position)
    }),
    http.get(`${SUPABASE_URL}/rest/v1/season_plans`, ({ request }) => {
      const wanted = param(new URL(request.url), 'squad')
      return HttpResponse.json(plans.filter(p => !wanted || p.squad === wanted))
    }),
    http.post(`${SUPABASE_URL}/rest/v1/season_plans`, async ({ request }) => {
      const body = await request.json() as Partial<Plan>
      planWrites.push(body)
      plans.push({ id: `plan-${plans.length + 1}`, starts_on: null, ends_on: null, shared_at: null, positions_known: null, squad: 'U16', ...body })
      return HttpResponse.json({ id: `plan-${plans.length}` }, { status: 201 })
    }),
    http.patch(`${SUPABASE_URL}/rest/v1/season_plans`, async ({ request }) => {
      const url = new URL(request.url), body = await request.json() as Partial<Plan>
      planWrites.push(body)
      plans = plans.map(p => (p.id === param(url, 'id') ? { ...p, ...body } : p))
      return new HttpResponse(null, { status: 204 })
    }),
    table('season_objectives', []),
    http.post(`${SUPABASE_URL}/rest/v1/season_objectives`, () => new HttpResponse(null, { status: 201 })),
    table('training_notes', []),
    table('squad_player_profiles', []),
    // TRAK-353: the player's Can also play and roles; none.
    table('squad_player_also_plays', []), table('squad_player_roles', []),
    // TRAK-354: step 3 and the player's page read the players' objectives; none.
    table('player_objectives', []),
    rpc('coach_player_birth_dates', () => []),
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
const groupOf = (name: string) => screen.getByRole('group', { name: `${name}'s position` })

async function answer(label: RegExp) {
  await user().click(await screen.findByRole('radio', { name: label }))
  await user().click(screen.getByRole('button', { name: 'Continue' }))
}

describe('TRAK-352 positions', () => {
  it('asks first, then places all 22 with taps only, and the count follows', async () => {
    squad = Array.from({ length: 24 }, (_, i) => child(i + 1))
    waiting = new Set(['p23', 'p24'])
    renderApp('/coach/season-plan/positions')

    expect(await screen.findByRole('heading', { name: 'Do you know where they play yet?' })).toBeInTheDocument()
    expect(screen.getByText('22 players in U16. You can change your answer any time.')).toBeInTheDocument()
    await answer(/^Yes/)
    await waitFor(() => expect(planWrites).toEqual([{ squad: 'U16', positions_known: 'yes' }]))

    expect(await screen.findByRole('heading', { name: '0 of 22 placed' })).toBeInTheDocument()
    expect(screen.getByText(/^2 players are waiting for consent/)).toBeInTheDocument()
    expect(screen.queryByText('Synthetic Player 23')).not.toBeInTheDocument()
    expect(screen.queryByText('Synthetic Player 24')).not.toBeInTheDocument()

    const pick = ['Goalkeeper', 'Goalkeeper', ...Array(7).fill('Defender'), ...Array(7).fill('Midfielder'), ...Array(6).fill('Attacker')]
    const tapper = user()
    for (const [i, position] of pick.entries()) {
      const name = `Synthetic Player ${String(i + 1).padStart(2, '0')}`
      await tapper.click(within(groupOf(name)).getByRole('button', { name: position }))
      expect(await screen.findByRole('heading', { name: `${i + 1} of 22 placed` })).toBeInTheDocument()
    }
    expect(screen.getByText('Everyone is placed.')).toBeInTheDocument()
    expect(placed).toHaveLength(22)
    expect(placed.map(p => p.position)).toEqual(pick)
    for (const [line, count] of [['Goalkeepers', 2], ['Defenders', 7], ['Midfielders', 7], ['Attackers', 6]] as const) {
      expect(screen.getByRole('heading', { name: `${line} · ${count}` })).toBeInTheDocument()
    }
    expect(within(groupOf('Synthetic Player 01')).getByRole('button', { name: 'Goalkeeper' })).toHaveAttribute('aria-pressed', 'true')
  // 22 taps: 1.9 s here, over Vitest's 5 s default on CI's runner (5 Nov). Long journeys here get their own limit.
  }, 30_000)

  it('saves Not yet with nobody placed, and Place some now opens the list', async () => {
    squad = [child(1), child(2)]
    renderApp('/coach/season-plan/positions')
    await answer(/^Not yet/)
    expect(await screen.findByRole('heading', { name: "You'll place them later" })).toBeInTheDocument()
    expect(planWrites).toEqual([{ squad: 'U16', positions_known: 'not_yet' }])
    expect(placed).toEqual([])

    await user().click(screen.getByRole('button', { name: 'Place some now' }))
    expect(await screen.findByRole('heading', { name: '0 of 2 placed' })).toBeInTheDocument()
    expect(planWrites.at(-1)).toEqual({ positions_known: 'some' })
  })

  it('gives nobody a midfielder default: an unplaced player has no button pressed', async () => {
    squad = [child(1), child(2, 'Defender')]
    plans = [{ id: 'plan-1', squad: 'U16', starts_on: null, ends_on: null, shared_at: null, positions_known: 'some' }]
    renderApp('/coach/season-plan/positions')
    expect(await screen.findByRole('heading', { name: '1 of 2 placed' })).toBeInTheDocument()
    expect(within(groupOf('Synthetic Player 01')).queryAllByRole('button', { pressed: true })).toEqual([])
    expect(within(groupOf('Synthetic Player 02')).getByRole('button', { pressed: true })).toHaveAccessibleName('Defender')
    expect(screen.getByRole('heading', { name: 'Midfielders · 0' })).toBeInTheDocument()
  })

  it('puts a failed tap back and says so', async () => {
    squad = [child(1)]
    plans = [{ id: 'plan-1', squad: 'U16', starts_on: null, ends_on: null, shared_at: null, positions_known: 'yes' }]
    failPlacing = true
    renderApp('/coach/season-plan/positions')
    await user().click(within(await screen.findByRole('group', { name: "Synthetic Player 01's position" })).getByRole('button', { name: 'Attacker' }))
    expect(await screen.findByText("Couldn't save Synthetic Player 01's position. Check your connection and tap again.")).toBeInTheDocument()
    expect(within(groupOf('Synthetic Player 01')).getByRole('button', { name: 'Attacker' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('heading', { name: '0 of 1 placed' })).toBeInTheDocument()
  })

  it('keeps step 1 typed while the coach looks at Positions, and Next saves it first', async () => {
    squad = [child(1)]
    renderApp('/coach/season-plan')
    await user().click(await screen.findByRole('button', { name: /Stay compact/ }))
    await user().click(within(screen.getByLabelText('Season plan steps')).getByRole('button', { name: /Positions/ }))
    expect(await screen.findByRole('heading', { name: 'Do you know where they play yet?' })).toBeInTheDocument()
    await user().click(screen.getByRole('button', { name: 'Season and objectives' }))
    expect(await screen.findByLabelText('Objective 1')).toHaveValue('Stay compact')
    expect(planWrites).toEqual([])

    await user().click(screen.getByRole('button', { name: 'Next: Positions' }))
    expect(await screen.findByRole('heading', { name: 'Do you know where they play yet?' })).toBeInTheDocument()
    expect(planWrites).toEqual([{ squad: 'U16', starts_on: null, ends_on: null }])
  })

  it("asks on Home for consented players with no position, and the card goes once they're placed", async () => {
    squad = [child(1), child(2), child(3)]
    waiting = new Set(['p3'])
    renderApp('/coach/home')
    expect(await screen.findByText('2 players need a position')).toBeInTheDocument()
    await user().click(screen.getByRole('button', { name: 'Place them' }))
    await answer(/^Yes/)
    await user().click(within(await screen.findByRole('group', { name: "Synthetic Player 01's position" })).getByRole('button', { name: 'Goalkeeper' }))
    await user().click(within(groupOf('Synthetic Player 02')).getByRole('button', { name: 'Defender' }))
    expect(await screen.findByRole('heading', { name: '2 of 2 placed' })).toBeInTheDocument()
    // TRAK-354: Positions goes on to Player objectives; TRAK-356: then on to Share. Home no longer asks.
    await user().click(screen.getByRole('button', { name: 'Next: Player objectives' }))
    await user().click(await screen.findByRole('button', { name: 'Next: Share' }))
    expect(await screen.findByRole('heading', { name: 'What goes out' })).toBeInTheDocument()
    cleanup()
    renderApp('/coach/home')
    expect(await screen.findByRole('heading', { name: /^Needs you/ })).toBeInTheDocument()
    expect(screen.queryByText(/players? needs? a position$/)).not.toBeInTheDocument()
  })

  it('marks unplaced players "No position yet" in Squad where the season plan is on', async () => {
    squad = [child(1), child(2, 'Attacker'), child(3)]
    waiting = new Set(['p3'])
    renderApp('/coach/squad')
    // The mark follows the switch, which answers after the roster.
    await waitFor(() => expect(screen.getByRole('button', { name: /Synthetic Player 01/ })).toHaveTextContent('No position yet'))
    expect(screen.getByRole('button', { name: /Synthetic Player 02/ })).toHaveTextContent('Attacker')
    expect(screen.getByRole('button', { name: /Synthetic Player 03/ })).not.toHaveTextContent('No position yet')
  })

  it('leaves Squad as it was where the season plan is off', async () => {
    squad = [child(1)]
    switchOn = false
    renderApp('/coach/squad')
    const row = await screen.findByRole('button', { name: /Synthetic Player 01/ })
    await waitFor(() => expect(switchAnswered).toBe(true))
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(row).not.toHaveTextContent('No position yet')
  })

  it('shows no position card where the season plan is off', async () => {
    squad = [child(1), child(2)]
    switchOn = false
    renderApp('/coach/home')
    expect(await screen.findByRole('heading', { name: /^Needs you/ })).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText(/players? needs? a position$/)).not.toBeInTheDocument())
  })
})
