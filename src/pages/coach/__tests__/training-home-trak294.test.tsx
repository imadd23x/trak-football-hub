/**
 * TRAK-294 (Training 1/5, spec TRAK-293): with the academy's training switch on, Training takes Library's place in
 * the coach's nav. Training home lists the coach's own trainings of the squad in view (TRAK-339 redid it: see
 * training-home-trak339);
 * Drills is the Drill Library (TRAK-387, training-library-trak387). With the switch off, the nav keeps Library and
 * Training is parked. Test people are named after footballers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { pickSquad } from '../../../../tests/support/squad-switcher'
import { renderApp } from '../../../../tests/support/render-app'
import { signInAs } from '../../../../tests/support/session'
import { server } from '../../../../tests/msw/server'
import { table, tableError, rpc, SUPABASE_URL } from '../../../../tests/msw/supabase'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const onTheMinute = (ms: number) => Math.ceil(ms / MINUTE) * MINUTE
const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10)
const hm = (ms: number) => new Date(ms).toISOString().slice(11, 16)

let n = 0
let COACH = { id: 'coach-294' }
function training(id: string, squad: string | null, start: number, over: Record<string, unknown> = {}) {
  return {
    id, coach_user_id: COACH.id, squad, title: `Training ${id}`, event_type: 'training', published: true, status: 'scheduled',
    starts_at: new Date(start).toISOString(), ends_at: new Date(start + 90 * MINUTE).toISOString(),
    event_date: ymd(start), start_time: `${hm(start)}:00`, venue: 'Pitch 2', ...over,
  }
}
/** The events read answers with these rows and keeps what each request asked for. */
function eventsRead(rows: Record<string, unknown>[]) {
  const asked: URL[] = []
  server.use(http.get(`${SUPABASE_URL}/rest/v1/coach_calendar_events`, ({ request }) => {
    asked.push(new URL(request.url))
    return HttpResponse.json(rows)
  }))
  return asked
}
beforeEach(() => {
  COACH = { id: `coach-294-${++n}` }
  signInAs(COACH)
  server.use(
    table('profiles', [{ id: 'p', user_id: COACH.id, role: 'coach', full_name: 'Jürgen Klopp', invite_code: 'ABCD' }]),
    table('coach_details', [{ user_id: COACH.id, coach_role: 'Head Coach', team: 'U16', organization_id: 'org-1' }]),
    table('organizations', [{ id: 'org-1', name: 'Rehearsal FC', logo_url: null }]),
    table('squad_players', [
      { id: 'sp-1', coach_user_id: COACH.id, player_name: 'Thierry Henry', age_group: 'U14', status: 'active' },
      { id: 'sp-2', coach_user_id: COACH.id, player_name: 'Patrick Vieira', age_group: 'U16', status: 'active' },
    ]),
    table('coach_sessions', []),
    table('session_attendance', []),
    table('event_absences', []),
    table('training_plans', []),
    table('training_notes', []),
    table('training_plan_drafts', []),
    table('coach_drills', []),
    rpc('feature_on', () => true),
  )
})
afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals() })

describe('TRAK-294: Training home', { timeout: 20_000 }, () => {
  it('with the switch on, Training takes Library’s place in the nav, and the Library’s pages mark it', async () => {
    eventsRead([])
    renderApp('/coach/training')
    expect(await screen.findByRole('heading', { level: 1, name: 'Training' })).toBeInTheDocument()
    const nav = screen.getByRole('tablist', { name: 'Coach' })
    await waitFor(() => expect(within(nav).getByRole('tab', { name: 'Training' })).toHaveAttribute('aria-selected', 'true'))
    expect(within(nav).queryByRole('tab', { name: 'Library' })).toBeNull()
  })

  it("with no training coming up, Add a training opens Schedule's New event", async () => {
    eventsRead([])
    renderApp('/coach/training')
    await userEvent.click(await screen.findByRole('button', { name: 'Add a training' }))
    await waitFor(() => expect(window.location.pathname).toBe('/coach/schedule'))
    expect(await screen.findByRole('dialog', { name: 'New event' }, { timeout: 5000 })).toBeInTheDocument()
  })

  it('a failed read says so with Retry, never "No training coming up"', async () => {
    server.use(tableError('coach_calendar_events', 500, { message: 'unavailable' }))
    renderApp('/coach/training')
    const failure = await screen.findByRole('alert', {}, { timeout: 5000 })
    expect(within(failure).getByRole('button', { name: /Retry/ })).toBeInTheDocument()
    expect(screen.queryByText('No training coming up')).toBeNull()
  })

  it('with the switch off, the nav keeps Library and Training is parked', async () => {
    server.use(rpc('feature_on', ({ p_feature }) => p_feature === 'events'))
    eventsRead([])
    renderApp('/coach/training')
    expect(await screen.findByRole('note', { name: 'This screen is coming soon' })).toBeInTheDocument()
    const nav = screen.getByRole('tablist', { name: 'Coach' })
    expect(within(nav).getByRole('tab', { name: 'Library' })).toBeInTheDocument()
    expect(within(nav).queryByRole('tab', { name: 'Training' })).toBeNull()
  })
})

// TRAK-387: Drills is the new Library, with no coach-made drills: see training-library-trak387.
