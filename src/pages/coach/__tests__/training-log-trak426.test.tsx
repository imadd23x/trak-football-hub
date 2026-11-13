/**
 * TRAK-426 (Kostas, 12 Nov): where Training is on, "+" › Log training follows Training's way, as Log match follows
 * Matches': New event as a training, and one already held is saved, published and opened on its register (Who's here).
 * Where Training and Matches are both on, the old log's pages retire: the Log page and Full session open New event as a
 * training, Sessions history and Edit session open Training › Past trainings. Nothing is deleted. Driven through the
 * rendered app, the clock pinned to 18:00 in Dubai (as TRAK-288's checks). Test people are named after footballers.
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
import { openNewEvent } from '../../../../tests/support/schedule-actions'

const DAY = '2026-10-14'
const YESTERDAY = '2026-10-13'
const NOW = new Date('2026-10-14T14:00:00Z')
const EVENTS = `${SUPABASE_URL}/rest/v1/coach_calendar_events`
let n = 0
let COACH = { id: 'coach-426-log' }
// Kicked off at 15:00 in Dubai; full time was 16:30.
const played = () => ({
  id: 'match-1', coach_user_id: COACH.id, title: 'vs Synthetic Rovers', event_type: 'match', squad: null,
  starts_at: '2026-10-14T11:00:00Z', ends_at: null, event_date: DAY, start_time: '15:00:00', end_time: null,
  venue: 'Academy Pitch 2', opponent: 'Synthetic Rovers', notes: null, published: true, source: 'manual', competition: 'league',
  meet_time: null, kit: null, kit_snapshot: null, family_note: null, home_away: 'home', status: 'scheduled', cancel_reason: null, series_id: null,
})

let posts: Record<string, unknown>[]
let patches: { url: URL; body: unknown }[]
function fixtures({ evaluated = false, games = true } = {}) {
  posts = []
  patches = []
  server.use(
    // TRAK-355: who the coach is watching; no one.
    table('player_watches', []),
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
    // Training on, and Games unless a check turns it off.
    rpc('feature_on', ({ p_feature }) => p_feature !== 'games' || games),
    rpc('coach_squad_player_consent_required', () => false),
  )
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  COACH = { id: `coach-426-log-${++n}` }
  signInAs(COACH)
})
afterEach(() => { vi.useRealTimers(); server.events.removeAllListeners() })

const path = () => window.location.pathname + window.location.search

describe('TRAK-426: Log training follows Training\'s way', { timeout: 30_000 }, () => {
  it('the "+" Log training opens New event with Training picked, not the old Full session', async () => {
    fixtures()
    renderApp('/coach/schedule')
    await userEvent.click(await screen.findByRole('button', { name: 'Quick add' }))
    const menu = await screen.findByRole('menu', { name: 'Quick add' })
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Log training' }))
    const sheet = await screen.findByRole('dialog', { name: 'New event' })
    expect(within(sheet).getByRole('button', { name: 'Training' })).toHaveAttribute('aria-pressed', 'true')
    expect(path()).toBe('/coach/schedule')
  })

  it('a training already held is saved, published and opened on its register, never "log it instead"', async () => {
    fixtures()
    renderApp('/coach/schedule')
    await openNewEvent()
    const sheet = screen.getByRole('dialog', { name: 'New event' })
    await userEvent.click(within(sheet).getByRole('button', { name: 'Training' }))
    await eventStep(sheet, 'When')
    await pickDate(userEvent, 'Date', YESTERDAY)
    await pickTime(userEvent, 'Start', '17:00')
    expect(within(sheet).queryByText('This date has passed: log it instead')).toBeNull()
    // A training already held is one event: no weekly repeat.
    expect(within(sheet).queryByRole('button', { name: 'Repeats weekly' })).toBeNull()
    await eventStep(sheet, 'Review')
    expect(within(sheet).queryByRole('button', { name: 'Save draft' })).toBeNull()
    expect(within(sheet).queryByRole('button', { name: 'Publish' })).toBeNull()
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save and take the register' }))
    await waitFor(() => expect(path()).toBe('/coach/training/new-1/here'))
    expect(posts).toHaveLength(1)
    expect(posts[0]).toMatchObject({ event_type: 'training', event_date: YESTERDAY })
    expect(patches.map(p => p.body)).toEqual([{ published: true }])
  })

  it('the old log\'s addresses open New event as a training, or Past trainings', async () => {
    for (const [from, to] of [['/coach/sessions', '/coach/schedule'], ['/coach/sessions/add', '/coach/schedule'],
      ['/coach/sessions/list', '/coach/training/past'], ['/coach/sessions/s-1', '/coach/training/past']] as const) {
      fixtures()
      const view = renderApp(from)
      await waitFor(() => expect(window.location.pathname, from).toBe(to))
      if (to === '/coach/schedule') {
        const sheet = await screen.findByRole('dialog', { name: 'New event' })
        expect(within(sheet).getByRole('button', { name: 'Training' })).toHaveAttribute('aria-pressed', 'true')
      }
      view.unmount()
    }
  })

  it('with Matches off, the old log stays: it still records that academy\'s matches', async () => {
    fixtures({ games: false })
    renderApp('/coach/sessions')
    expect(await screen.findByText('What are you logging?')).toBeInTheDocument()
    expect(path()).toBe('/coach/sessions')
  })
})
