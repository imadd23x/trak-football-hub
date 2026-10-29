/**
 * TRAK-288 (Games 6/8): with the academy's games switch on, no path in the coach app opens the old match log for a
 * match. Schedule's Log match becomes Evaluate; New event asks a match's competition, and a match already played is
 * saved and opened on its evaluation (Imad, 28 Oct), never emailed to families; the "+" Log match takes the same path;
 * the Sessions chooser and the session screen drop the match log; Home's week and Needs you offer Evaluate, then
 * Publish once a draft is saved. Driven through the rendered app, the clock pinned to 18:00 in Dubai. Test people are
 * named after footballers.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { renderApp } from '../../../../tests/support/render-app'
import { signInAs } from '../../../../tests/support/session'
import { server } from '../../../../tests/msw/server'
import { table, rpc, SUPABASE_URL } from '../../../../tests/msw/supabase'
import { pickDate, pickTime } from '../../../../tests/support/arc-pickers'
import { eventStep } from '../../../../tests/support/event-steps'

const DAY = '2026-10-14'
const YESTERDAY = '2026-10-13'
const NOW = new Date('2026-10-14T14:00:00Z')
const EVENTS = `${SUPABASE_URL}/rest/v1/coach_calendar_events`
let n = 0
let COACH = { id: 'coach-288-log' }
// Kicked off at 15:00 in Dubai; full time was 16:30.
const played = () => ({
  id: 'match-1', coach_user_id: COACH.id, title: 'vs Synthetic Rovers', event_type: 'match', squad: null,
  starts_at: '2026-10-14T11:00:00Z', ends_at: null, event_date: DAY, start_time: '15:00:00', end_time: null,
  venue: 'Academy Pitch 2', opponent: 'Synthetic Rovers', notes: null, published: true, source: 'manual', competition: 'league',
  meet_time: null, kit: null, kit_snapshot: null, family_note: null, home_away: 'home', status: 'scheduled', cancel_reason: null, series_id: null,
})

let posts: Record<string, unknown>[]
let patches: { url: URL; body: unknown }[]
function fixtures({ evaluated = false } = {}) {
  posts = []
  patches = []
  server.use(
    table('profiles', [{ id: 'p', user_id: COACH.id, role: 'coach', full_name: 'Otto Rehhagel', invite_code: 'ABCD' }]),
    table('coach_details', [{ user_id: COACH.id, coach_role: 'Head Coach', team: 'U16', organization_id: 'org-1' }]),
    table('organizations', [{ id: 'org-1', name: 'Rehearsal FC', logo_url: null }]),
    http.get(EVENTS, () => HttpResponse.json([played()])),
    http.post(EVENTS, async ({ request }) => {
      const raw = await request.json()
      posts.push((Array.isArray(raw) ? raw[0] : raw) as Record<string, unknown>)
      return HttpResponse.json([{ id: 'new-1' }], { status: 201 })
    }),
    http.patch(EVENTS, async ({ request }) => {
      patches.push({ url: new URL(request.url), body: await request.json() })
      return HttpResponse.json([{ id: 'new-1' }])
    }),
    http.post(`${SUPABASE_URL}/functions/v1/send-event-emails`, () => HttpResponse.json({})),
    table('coach_sessions', []),
    table('squad_players', [{ id: 'sp-1', coach_user_id: COACH.id, player_name: 'Theodoros Zagorakis', age_group: 'U16', status: 'active' }]),
    table('session_attendance', []),
    table('event_absences', []),
    table('event_confirmations', []),
    table('coach_assessments', []),
    table('notification_settings', []),
    table('training_plans', []),
    table('game_plans', []),
    table('game_plan_players', []),
    table('game_shares', []),
    rpc('game_plan_changes', () => []),
    table('game_evaluations', evaluated ? [{ event_id: 'match-1', saved_at: '2026-10-14T13:40:00Z',
      our_score: 1, their_score: 0, goals: [], how_they_scored: '', plan_worked: [], published_at: null }] : []),
    table('game_evaluation_players', []),
    table('game_evaluation_notes', []),
    rpc('feature_on', () => true),
    rpc('coach_squad_player_consent_required', () => false),
  )
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  COACH = { id: `coach-288-log-${++n}` }
  signInAs(COACH)
})
afterEach(() => { vi.useRealTimers(); server.events.removeAllListeners() })

const path = () => window.location.pathname + window.location.search

describe('TRAK-288: with Games on, the evaluation replaces the match log', { timeout: 30_000 }, () => {
  it('Schedule: a played match offers Evaluate, which opens its evaluation, and no Log match', async () => {
    fixtures()
    renderApp('/coach/schedule')
    await userEvent.click(await screen.findByRole('button', { name: 'Evaluate vs Synthetic Rovers' }))
    expect(screen.queryByRole('button', { name: 'Log match for vs Synthetic Rovers' })).toBeNull()
    await waitFor(() => expect(path()).toBe('/coach/games/match-1?tab=evaluation'))
  })

  it('New event asks a match\'s competition before it moves on, and saves it', async () => {
    fixtures()
    renderApp('/coach/schedule')
    await userEvent.click(await screen.findByRole('button', { name: 'Add event' }))
    const sheet = screen.getByRole('dialog', { name: 'New event' })
    await userEvent.click(within(sheet).getByRole('button', { name: 'Match' }))
    await userEvent.type(within(sheet).getByLabelText('Opponent'), 'Synthetic United')
    const competition = within(sheet).getByRole('group', { name: 'Competition' })
    expect(within(competition).getAllByRole('button').map(b => b.textContent)).toEqual(['League', 'Tournament', 'Friendly'])
    await userEvent.click(within(sheet).getByRole('button', { name: 'Next' }))
    expect(await within(sheet).findByText('Pick the competition')).toBeInTheDocument()
    await userEvent.click(within(competition).getByRole('button', { name: 'Tournament' }))
    await eventStep(sheet, 'When')
    await pickTime(userEvent, 'Kickoff', '19:00')
    await eventStep(sheet, 'Review')
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save draft' }))
    await waitFor(() => expect(posts).toHaveLength(1))
    expect(posts[0]).toMatchObject({ event_type: 'match', opponent: 'Synthetic United', competition: 'tournament', published: false })
  })

  it('a match already played is saved, published and opened on its evaluation, never "log it instead"', async () => {
    fixtures()
    renderApp('/coach/schedule')
    await userEvent.click(await screen.findByRole('button', { name: 'Add event' }))
    const sheet = screen.getByRole('dialog', { name: 'New event' })
    await userEvent.click(within(sheet).getByRole('button', { name: 'Match' }))
    await userEvent.type(within(sheet).getByLabelText('Opponent'), 'Synthetic United')
    await userEvent.click(within(within(sheet).getByRole('group', { name: 'Competition' })).getByRole('button', { name: 'Friendly' }))
    await eventStep(sheet, 'When')
    await pickDate(userEvent, 'Date', YESTERDAY)
    await pickTime(userEvent, 'Kickoff', '17:00')
    expect(within(sheet).queryByText('This date has passed: log it instead')).toBeNull()
    await eventStep(sheet, 'Review')
    expect(within(sheet).queryByRole('button', { name: 'Save draft' })).toBeNull()
    expect(within(sheet).queryByRole('button', { name: 'Publish' })).toBeNull()
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save and evaluate' }))
    await waitFor(() => expect(path()).toBe('/coach/games/new-1?tab=evaluation'))
    expect(posts).toHaveLength(1)
    expect(posts[0]).toMatchObject({ event_type: 'match', event_date: YESTERDAY, competition: 'friendly' })
    expect(patches.map(p => p.body)).toEqual([{ published: true }])
  })

  it('a past training still offers only its own log', async () => {
    fixtures()
    renderApp('/coach/schedule')
    await userEvent.click(await screen.findByRole('button', { name: 'Add event' }))
    const sheet = screen.getByRole('dialog', { name: 'New event' })
    await eventStep(sheet, 'When')
    await pickDate(userEvent, 'Date', YESTERDAY)
    await pickTime(userEvent, 'Start', '17:00')
    expect(await within(sheet).findByText('This date has passed: log it instead')).toBeInTheDocument()
    expect(within(sheet).getByRole('button', { name: 'Log training' })).toBeInTheDocument()
    expect(within(sheet).queryByRole('button', { name: 'Log match' })).toBeNull()
  })

  it('the "+" Log match opens New event with Match picked', async () => {
    fixtures()
    renderApp('/coach/schedule')
    await userEvent.click(await screen.findByRole('button', { name: 'Quick add' }))
    const menu = await screen.findByRole('menu', { name: 'Quick add' })
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Log match' }))
    const sheet = await screen.findByRole('dialog', { name: 'New event' })
    expect(within(sheet).getByRole('button', { name: 'Match' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByRole('dialog', { name: 'Log a match' })).toBeNull()
  })

  it('the Sessions chooser has no quick match log, and its old address goes to Games', async () => {
    fixtures()
    renderApp('/coach/sessions')
    expect(await screen.findByText('What are you logging?')).toBeInTheDocument()
    // Gone once the switch answers; a tap before that lands on the redirect below.
    await waitFor(() => expect(screen.queryByText(/Quick/)).toBeNull())
    renderApp('/coach/sessions/quick')
    await waitFor(() => expect(path()).toBe('/coach/games'))
  })

  it('Home: a played match needs an evaluation; once a draft is saved, publishing it is next', async () => {
    fixtures()
    renderApp('/coach/home')
    const needs = await screen.findByRole('region', { name: /Needs you/ }, { timeout: 5000 })
    expect(await within(needs).findByText('Played, not evaluated yet')).toBeInTheDocument()
    await userEvent.click(within(needs).getByRole('button', { name: 'Evaluate' }))
    await waitFor(() => expect(path()).toBe('/coach/games/match-1?tab=evaluation'))
  })

  it('Home: with a draft saved, the card says so and offers Publish', async () => {
    fixtures({ evaluated: true })
    renderApp('/coach/home')
    const needs = await screen.findByRole('region', { name: /Needs you/ }, { timeout: 5000 })
    expect(await within(needs).findByText('Evaluation draft · only you see it')).toBeInTheDocument()
    expect(within(needs).queryByRole('button', { name: 'Log it' })).toBeNull()
    await userEvent.click(within(needs).getByRole('button', { name: 'Publish' }))
    await waitFor(() => expect(path()).toBe('/coach/games/match-1?tab=evaluation'))
  })
})
