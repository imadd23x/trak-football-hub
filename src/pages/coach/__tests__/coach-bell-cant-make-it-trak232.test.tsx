import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { renderApp } from '../../../../tests/support/render-app'
import { signInAs } from '../../../../tests/support/session'
import { server } from '../../../../tests/msw/server'
import { table, rpc, SUPABASE_URL } from '../../../../tests/msw/supabase'

/**
 * TRAK-232 (live run, 20 Oct, S5): when a guardian or a player says Can't make
 * it, the coach hears it in a bell at the top right of Home (TRAK-233,
 * Imad's option A). One alert per player per event, no reason text, gone
 * after Undo, and "Open event" opens that event's day on Schedule.
 */
const NOW = new Date('2026-10-21T08:00:00Z')
let COACH = { id: 'coach-232' }
const row = (over: Record<string, unknown>) => ({
  coach_user_id: COACH.id, event_type: 'training', starts_at: '2026-10-24T14:00:00Z', ends_at: null,
  event_date: '2026-10-24', start_time: '17:00:00', venue: 'Municipal Ground', opponent: null, notes: null,
  published: true, source: 'manual', meet_time: null, kit: null, home_away: null, status: 'scheduled',
  cancel_reason: null, series_id: null, squad: null, ...over,
})
const EVENTS = [
  row({ id: 'ev-sat', title: 'Training' }),
  row({ id: 'ev-sun', title: 'vs PAOK U16', event_type: 'match', event_date: '2026-10-25', starts_at: '2026-10-25T09:00:00Z' }),
  row({ id: 'ev-past', title: 'Old training', event_date: '2026-10-19', starts_at: '2026-10-19T14:00:00Z' }),
  row({ id: 'ev-off', title: 'Cancelled training', status: 'cancelled', event_date: '2026-10-26', starts_at: '2026-10-26T14:00:00Z' }),
]
const absence = (event_id: string, squad_player_id: string, reported_at = '2026-10-21T07:30:00Z') =>
  ({ event_id, squad_player_id, reported_at, reason: 'Ill with a fever', reported_by: 'guardian-1' })

let absences: Record<string, unknown>[]
function fixtures(id: string) {
  COACH = { id } // the app's query cache outlives a test
  signInAs(COACH)
  server.use(
    // TRAK-355: who the coach is watching; no one.
    table('player_watches', []),
    table('profiles', [{ id: 'p', user_id: COACH.id, role: 'coach', full_name: 'Angelos Basinas', invite_code: 'ABCD' }]),
    table('coach_details', []),
    // TRAK-261: no row means the coach's "Can't make it" switch is on.
    table('notification_settings', []),
    table('coach_calendar_events', EVENTS),
    table('coach_sessions', []),
    table('session_attendance', []),
    table('squad_players', [
      { id: 'sp-1', player_name: 'Nikos Synthetic', status: 'active' },
      { id: 'sp-2', player_name: 'Eleni Synthetic', status: 'active' },
    ]),
    http.get(`${SUPABASE_URL}/rest/v1/event_absences`, () => HttpResponse.json(absences)),
    rpc('feature_on', () => true),
    // TRAK-286: no game plan, shared or not.
    table('game_plans', []),
    table('game_shares', []),
    rpc('game_plan_changes', () => []),
    rpc('coach_squad_player_consent_required', () => false),
  )
}

async function openBell() {
  await userEvent.click(await screen.findByRole('button', { name: /^Alerts/ }))
  return screen.findByRole('dialog', { name: 'Alerts' })
}

describe("TRAK-232: the coach's bell says who can't make it", { timeout: 20_000 }, () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW); localStorage.clear() })
  afterEach(() => vi.useRealTimers())

  it('shows one unread alert per player per event, with the event and day but never the reason', async () => {
    absences = [absence('ev-sat', 'sp-1'), absence('ev-sun', 'sp-1', '2026-10-21T07:45:00Z'), absence('ev-sat', 'sp-2')]
    fixtures('coach-232-list')
    renderApp('/coach/home')
    expect(await screen.findByRole('button', { name: /^Alerts.*3 unread/ })).toBeInTheDocument()
    const panel = await openBell()
    expect(within(panel).getAllByText("Nikos can't make it")).toHaveLength(2)
    expect(within(panel).getByText("Eleni can't make it")).toBeInTheDocument()
    expect(within(panel).getByText('vs PAOK U16, Sun 25 Oct')).toBeInTheDocument()
    expect(within(panel).getAllByText('Training, Sat 24 Oct')).toHaveLength(2)
    expect(within(panel).queryByText(/fever/)).toBeNull()
  })

  // TRAK-261: the coach's "Can't make it" switch in Settings.
  it('shows none while the coach has turned the alerts off', async () => {
    absences = [absence('ev-sat', 'sp-1'), absence('ev-sat', 'sp-2')]
    fixtures('coach-232-off')
    server.use(table('notification_settings', [{ user_id: COACH.id, event_reminders: true, cant_make_it_alerts: false, needs_you: true }]))
    renderApp('/coach/home')
    const panel = await openBell()
    await waitFor(() => expect(within(panel).queryByText(/can't make it/)).toBeNull())
    expect(screen.queryByRole('button', { name: /unread/ })).toBeNull()
  })

  it("leaves out past and cancelled events: the register covers what's passed", async () => {
    absences = [absence('ev-past', 'sp-1'), absence('ev-off', 'sp-2')]
    fixtures('coach-232-past')
    renderApp('/coach/home')
    const panel = await openBell()
    expect(within(panel).queryByText(/can't make it/)).toBeNull()
  })

  it('drops the alert once the family undoes it', async () => {
    absences = [absence('ev-sat', 'sp-1')]
    fixtures('coach-232-undo')
    renderApp('/coach/home')
    expect(within(await openBell()).getByText("Nikos can't make it")).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    expect(screen.getByRole('button', { name: 'Alerts, 1 unread' })).toBeInTheDocument()
    absences = []
    // Opening the bell re-reads. (The row animates out, which jsdom never
    // finishes, so the bell's own count is the check.)
    await openBell()
    expect(await screen.findByRole('button', { name: 'Alerts' })).toBeInTheDocument()
  })

  it("opens the event's day on Schedule, with who can't make it on its card", async () => {
    absences = [absence('ev-sun', 'sp-2')]
    fixtures('coach-232-open')
    renderApp('/coach/home')
    const panel = await openBell()
    await userEvent.click(within(panel).getByRole('button', { name: /^Eleni can't make it, unread\. Show details$/ }))
    await userEvent.click(within(panel).getByRole('button', { name: 'Open event' }))
    expect(await screen.findByText("1 can't make it: Eleni Synthetic")).toBeInTheDocument()
    expect(window.location.pathname).toBe('/coach/schedule')
    expect(window.location.search).toBe('')
  })
})
