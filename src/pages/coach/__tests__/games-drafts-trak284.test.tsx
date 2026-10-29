/**
 * TRAK-284 (Games 2/8): a plan draft shows on Games home, in Open drafts and as "Plan not shared". Home's Needs you
 * lists a match whose logistics are shared, kicking off within 7 days, with no plan shared: "Plan not shared · Write
 * the plan". Neither shows with the games switch off. Test people are named after footballers.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderApp } from '../../../../tests/support/render-app'
import { signInAs } from '../../../../tests/support/session'
import { server } from '../../../../tests/msw/server'
import { table, rpc } from '../../../../tests/msw/supabase'

const phoneTZ = process.env.TZ
beforeAll(() => { process.env.TZ = 'Asia/Dubai' })
afterAll(() => { process.env.TZ = phoneTZ })

const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE
let n = 0
let COACH = { id: 'coach-284-drafts' }

/** A Dubai academy's match `days` from now (UTC+4 all year). */
function game(id: string, opponent: string, days: number, over: Record<string, unknown> = {}) {
  const kickOff = Math.ceil((Date.now() + days * DAY) / MINUTE) * MINUTE
  const at = new Date(kickOff + 4 * 60 * MINUTE).toISOString()
  return {
    id, coach_user_id: COACH.id, squad: 'U16', title: `vs ${opponent}`, event_type: 'match', published: true, status: 'scheduled',
    starts_at: new Date(kickOff).toISOString(), ends_at: new Date(kickOff + 90 * MINUTE).toISOString(),
    event_date: at.slice(0, 10), start_time: `${at.slice(11, 16)}:00`, end_time: null, meet_time: null,
    opponent, home_away: 'home', venue: 'Rehearsal Park', kit: null, kit_snapshot: null, family_note: null, notes: null,
    series_id: null, training_theme: null, cancel_reason: null, ...over,
  }
}
const plan = (event_id: string) => ({
  event_id, strength: null, their_formation: null, key_players: [], scouting: '', goals: [],
  created_at: '2026-10-27T17:00:00Z', updated_at: '2026-10-27T17:40:00Z',
})

beforeEach(() => {
  COACH = { id: `coach-284-drafts-${++n}` }
  signInAs(COACH)
  server.use(
    table('profiles', [{ id: 'p', user_id: COACH.id, role: 'coach', full_name: 'Otto Rehhagel', invite_code: 'ABCD' }]),
    table('coach_details', [{ user_id: COACH.id, coach_role: 'Head Coach', team: 'U16', organization_id: 'org-1' }]),
    table('organizations', [{ id: 'org-1', name: 'Rehearsal FC', logo_url: null }]),
    table('squad_players', [{ id: 'sp-1', coach_user_id: COACH.id, player_name: 'Angelos Charisteas', age_group: 'U16', status: 'active', created_at: '2026-10-01T08:00:00Z' }]),
    table('coach_assessments', []),
    table('coach_sessions', []),
    table('session_attendance', []),
    table('event_absences', []),
    table('notification_settings', []),
    rpc('coach_squad_player_consent_required', () => false),
    rpc('feature_on', () => true),
    // TRAK-288: no evaluation yet.
    table('game_evaluations', []),
    table('game_evaluation_players', []),
    table('game_evaluation_notes', []),
    table('game_plans', []),
    table('game_shares', []),
    rpc('game_plan_changes', () => []),
  )
})
afterEach(() => { cleanup(); localStorage.clear() })

describe('TRAK-284: plan drafts on Games home and in Needs you', { timeout: 30_000 }, () => {
  it('Games home lists an open plan draft and says the plan is not shared; a kicked-off match\'s draft is closed', async () => {
    const user = userEvent.setup()
    server.use(
      table('coach_calendar_events', [game('g1', 'Parkview Athletic', 5), game('g2', 'Riverside Rovers', 8), game('g0', 'Harbour Town', -1)]),
      table('game_plans', [plan('g1'), plan('g0')]),
    )
    renderApp('/coach/games')
    const drafts = await screen.findByRole('region', { name: 'Open drafts' })
    expect(within(drafts).getAllByRole('listitem')).toHaveLength(1)
    expect(within(drafts).getByText('vs Parkview Athletic')).toBeInTheDocument()
    expect(within(drafts).getByText('Game plan · saved Tue 27 Oct, 21:40')).toBeInTheDocument()

    const next = screen.getByRole('region', { name: 'Next game' })
    expect(within(next).getByText('Plan not shared')).toBeInTheDocument()
    const strip = screen.getByRole('region', { name: 'Your games' })
    expect(within(within(strip).getByRole('link', { name: /Riverside Rovers/ })).getByText('Plan not written')).toBeInTheDocument()

    await user.click(within(drafts).getByRole('button', { name: 'Open the plan, vs Parkview Athletic' }))
    expect(window.location.pathname + window.location.search).toBe('/coach/games/g1?tab=plan')
  })

  it('Needs you lists a shared match kicking off within 7 days: "Plan not shared · Write the plan"', async () => {
    server.use(table('coach_calendar_events', [
      game('g1', 'Parkview Athletic', 3), game('g2', 'Riverside Rovers', 8), game('g3', 'Harbour Town', 2, { published: false }),
    ]))
    renderApp('/coach/home')
    const needs = await screen.findByRole('region', { name: /Needs you/ }, { timeout: 5000 })
    const card = (await within(needs).findByText('vs Parkview Athletic')).closest('li')!
    expect(within(card).getByText('Plan not shared')).toBeInTheDocument()
    expect(within(card).getByRole('link', { name: 'Write the plan' })).toHaveAttribute('href', '/coach/games/g1?tab=plan')
    expect(within(needs).queryByText('vs Riverside Rovers')).toBeNull()
    expect(within(needs).queryByText('vs Harbour Town')).toBeNull()
  })

  it('with the games switch off, Needs you has no plan cards', async () => {
    server.use(
      rpc('feature_on', ({ p_feature }) => p_feature === 'events'),
      table('coach_calendar_events', [game('g1', 'Parkview Athletic', 3)]),
    )
    renderApp('/coach/home')
    const needs = await screen.findByRole('region', { name: /Needs you/ }, { timeout: 5000 })
    await within(needs).findByRole('button', { name: /Angelos Charisteas/ })
    expect(within(needs).queryByText('Plan not shared')).toBeNull()
  })
})
