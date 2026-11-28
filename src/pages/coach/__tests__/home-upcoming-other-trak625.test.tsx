/**
 * TRAK-625 (Other events → To-do 5/6, spec TRAK-620; Makis's gentle reminder): Home's Upcoming gets a third card, Other,
 * from today to 7 days ahead. Each "Other" event shows Add to To-do, or In To-do once it's there. A cancelled one isn't
 * listed; with none, the card says so. Nothing is added for the coach. Now is Wed 4 Nov at midday.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { renderApp } from '../../../../tests/support/render-app'
import { signInAs } from '../../../../tests/support/session'
import { server } from '../../../../tests/msw/server'
import { table, rpc, SUPABASE_URL } from '../../../../tests/msw/supabase'
import { forgetScreens } from '@/lib/screen-memory'

// Midday on a Wednesday; today's events are later in the day.
const NOW = new Date('2026-11-04T12:00:00Z')
// Times are UTC, whatever the machine's time zone.
const at = (iso: string) => new Date(`${iso}:00Z`)
let n = 0
let COACH = { id: 'coach-625' }

function event(id: string, type: 'training' | 'match' | 'other', starts: string, over: Record<string, unknown> = {}) {
  const start = at(starts)
  return {
    id, coach_user_id: COACH.id, squad: 'U16', title: `Training ${id}`, event_type: type, published: true, status: 'scheduled',
    starts_at: start.toISOString(), ends_at: new Date(start.getTime() + 90 * 60_000).toISOString(),
    event_date: starts.slice(0, 10), start_time: `${starts.slice(11, 16)}:00`, venue: 'Pitch 2', opponent: null, home_away: null, ...over,
  }
}
const practice = (event_id: string, position: number, name: string, minutes: number, part = '') => ({
  event_id, position, name, minutes, how: '', tell: '', area: '', numbers: '', direction: '', targets: '', conditions: '',
  source: 'own', drill_id: null, library_session: null, part,
})

function home({ events, practices = [], gamePlans = [], features = ['events', 'training', 'games'] }: {
  events: Record<string, unknown>[]; practices?: Record<string, unknown>[]; gamePlans?: Record<string, unknown>[]; features?: string[]
}) {
  server.use(
    table('profiles', [{ id: 'p', user_id: COACH.id, role: 'coach', full_name: 'Jürgen Klopp', invite_code: 'ABCD' }]),
    table('coach_details', [{ user_id: COACH.id, coach_role: 'Head Coach', team: 'U16', organization_id: 'org-1' }]),
    table('organizations', [{ id: 'org-1', name: 'Rehearsal FC' }]),
    table('squad_players', [{ id: 'sp-1', coach_user_id: COACH.id, player_name: 'Mohamed Salah', age_group: 'U16', status: 'active', created_at: '2026-10-01T08:00:00Z' }]),
    table('coach_assessments', []),
    table('coach_sessions', []),
    table('session_attendance', []),
    table('event_absences', []),
    table('notification_settings', []),
    table('game_shares', []),
    rpc('game_plan_changes', () => []),
    rpc('coach_squad_player_consent_required', () => false),
    rpc('feature_on', ({ p_feature }) => features.includes(String(p_feature))),
    table('training_notes', []),
    table('game_evaluations', []),
    table('coach_home_order', []),
    table('squad_player_profiles', []),
    http.get(`${SUPABASE_URL}/rest/v1/coach_calendar_events`, ({ request }) => {
      const type = new URL(request.url).searchParams.get('event_type')?.replace(/^eq\./, '')
      return HttpResponse.json(type ? events.filter(e => e.event_type === type) : events)
    }),
    http.get(`${SUPABASE_URL}/rest/v1/training_plans`, () =>
      HttpResponse.json([...new Set(practices.map(p => p.event_id))].map(event_id => ({ event_id, updated_at: '2026-11-01T10:00:00Z' })))),
    table('training_plan_practices', practices),
    http.get(`${SUPABASE_URL}/rest/v1/game_plans`, ({ request }) => {
      const id = new URL(request.url).searchParams.get('event_id')?.replace(/^eq\./, '')
      return HttpResponse.json(id ? gamePlans.filter(p => p.event_id === id) : gamePlans)
    }),
  )
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  COACH = { id: `coach-625-${++n}` }
  signInAs(COACH)
})
afterEach(() => { vi.useRealTimers(); cleanup(); forgetScreens(); localStorage.clear() })

type Own = { id: string; coach_user_id: string; title: string; due_on: string; urgent: boolean; done_at: string | null; created_at: string; calendar_event_id?: string | null }
let mine: Own[] = []
let posted: Record<string, unknown>[] = []
let patched: Record<string, unknown>[] = []
let orFilters: string[] = []
function ownTodos() {
  mine = []; posted = []; patched = []; orFilters = []
  server.use(
    http.get(`${SUPABASE_URL}/rest/v1/coach_todos`, ({ request }) => {
      // The read asks for the open ones and the ones ticked lately, the time quoted as PostgREST needs.
      orFilters.push(new URL(request.url).searchParams.get('or') ?? '')
      return HttpResponse.json(mine)
    }),
    http.post(`${SUPABASE_URL}/rest/v1/coach_todos`, async ({ request }) => {
      const body = await request.json() as Record<string, unknown>
      posted.push(body)
      mine.push({ id: `own-${mine.length + 1}`, coach_user_id: COACH.id, done_at: null, created_at: new Date().toISOString(), urgent: false, ...body } as Own)
      return new HttpResponse(null, { status: 201 })
    }),
    http.patch(`${SUPABASE_URL}/rest/v1/coach_todos`, async ({ request }) => {
      const body = await request.json() as Record<string, unknown>
      const id = new URL(request.url).searchParams.get('id')?.replace(/^eq\./, '')
      patched.push({ id, ...body })
      mine = mine.map(row => (row.id === id ? { ...row, ...body } as Own : row))
      return new HttpResponse(null, { status: 204 })
    }),
  )
}
const todo = () => screen.findByRole('region', { name: 'To-do' }, { timeout: 5000 })
const other = (id: string, title: string, starts: string, over: Record<string, unknown> = {}) => event(id, 'other', starts, { title, venue: 'Café Nikos', ...over })
const otherCard = async () => screen.findByRole('region', { name: 'Other' }, { timeout: 5000 })

describe("TRAK-625: Upcoming's Other card", { timeout: 20_000 }, () => {
  it("lists the Other events from today, with Add to To-do; not a cancelled one, nor trainings", async () => {
    home({ events: [
      other('ev-drinks', 'Drinks', '2026-11-04T19:00'),
      other('ev-photo', 'Team photo', '2026-11-07T17:00'),
      other('ev-gone', 'Kit handout', '2026-11-05T17:00', { status: 'cancelled' }),
      event('t1', 'training', '2026-11-05T16:00'),
    ] })
    ownTodos()
    renderApp('/coach/home')
    const card = await otherCard()
    const rows = await within(card).findAllByRole('listitem', {}, { timeout: 5000 })
    expect(rows.map(r => r.textContent)).toEqual([expect.stringContaining('DrinksToday · 19:00'), expect.stringContaining('Team photoSat 7 Nov · 17:00')])
    expect(within(card).getByRole('button', { name: 'Add Drinks to To-do' })).toBeInTheDocument()
    expect(within(card).queryByText('Kit handout')).toBeNull()
    expect(within(card).queryByText('Training t1')).toBeNull()
  })

  it('Add to To-do from Upcoming: saved and linked, and the row says In To-do', async () => {
    home({ events: [other('ev-drinks', 'Drinks', '2026-11-04T19:00')] })
    ownTodos()
    renderApp('/coach/home')
    const card = await otherCard()
    await userEvent.click(await within(card).findByRole('button', { name: 'Add Drinks to To-do' }, { timeout: 5000 }))
    const form = await screen.findByRole('form', { name: 'Add to To-do' })
    await userEvent.click(within(form).getByRole('button', { name: 'Add to To-do' }))
    await waitFor(() => expect(posted).toEqual([{ title: 'Invite the team · Drinks', due_on: '2026-11-04', urgent: false, calendar_event_id: 'ev-drinks' }]))
    expect(await within(card).findByText('In To-do', {}, { timeout: 5000 })).toBeInTheDocument()
  })

  it('an event already in the To-do says In To-do, with its day when later', async () => {
    home({ events: [other('ev-photo', 'Team photo', '2026-11-07T17:00')] })
    ownTodos()
    mine = [{ id: 'own-a', coach_user_id: COACH.id, title: 'Be there · Team photo', due_on: '2026-11-06', urgent: false, done_at: null, created_at: '2026-11-03T08:00:00Z', calendar_event_id: 'ev-photo' }]
    renderApp('/coach/home')
    expect(await within(await otherCard()).findByText('In To-do · Fri 6 Nov', {}, { timeout: 5000 })).toBeInTheDocument()
  })

  it('with none, says so', async () => {
    home({ events: [event('t1', 'training', '2026-11-05T16:00')] })
    ownTodos()
    renderApp('/coach/home')
    expect(await within(await otherCard()).findByText('None this week.', {}, { timeout: 5000 })).toBeInTheDocument()
  })
})
