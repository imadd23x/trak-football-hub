/**
 * TRAK-624 (Other events → To-do 4/6, spec TRAK-620): a to-do added from an event (Add to To-do) shows in Home's To-do
 * on its day, like the coach's own, and says which event it's for: "Drinks · Wed 4 Nov · 19:00 · Café Nikos". A tap on
 * that line opens the event's sheet. A cancelled event says Cancelled first. Done ticks it. Test people are named after
 * footballers. Now is Wed 4 Nov at midday.
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
let COACH = { id: 'coach-624' }

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
  COACH = { id: `coach-624-${++n}` }
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
const drinks = (over: Record<string, unknown> = {}) => event('ev-drinks', 'other', '2026-11-04T19:00', { title: 'Drinks', venue: 'Café Nikos', ...over })
const linked = (over: Partial<Own> = {}): Own => ({ id: 'own-ev', coach_user_id: COACH.id, title: 'Invite the team · Drinks', due_on: '2026-11-04',
  urgent: false, done_at: null, created_at: '2026-11-03T08:00:00Z', calendar_event_id: 'ev-drinks', ...over })
const rowOf = async (text: string) => (await within(await todo()).findByText(text, {}, { timeout: 5000 })).closest('li')!

describe('TRAK-624: a to-do added from an event, in Home\'s To-do', { timeout: 20_000 }, () => {
  it('says which event it is for, in place of "Added by you", with Done', async () => {
    home({ events: [drinks()] })
    ownTodos()
    mine = [linked()]
    renderApp('/coach/home')
    const row = await rowOf('Invite the team · Drinks')
    expect(within(row).getByRole('button', { name: 'Drinks · Wed 4 Nov · 19:00 · Café Nikos' })).toBeInTheDocument()
    expect(row).not.toHaveTextContent('Added by you')
    expect(within(row).getByRole('button', { name: 'Done' })).toBeInTheDocument()
  })

  it("a tap on the event's line opens its sheet", async () => {
    home({ events: [drinks()] })
    ownTodos()
    mine = [linked()]
    renderApp('/coach/home')
    const row = await rowOf('Invite the team · Drinks')
    await userEvent.click(within(row).getByRole('button', { name: /^Drinks · Wed 4 Nov/ }))
    expect(await screen.findByRole('dialog', { name: 'Drinks' })).toBeInTheDocument()
  })

  it('a cancelled event says so first; the to-do can still be ticked', async () => {
    home({ events: [drinks({ status: 'cancelled', cancel_reason: 'Rain' })] })
    ownTodos()
    mine = [linked()]
    renderApp('/coach/home')
    const row = await rowOf('Invite the team · Drinks')
    expect(within(row).getByRole('button', { name: 'Cancelled · Drinks · Wed 4 Nov · 19:00 · Café Nikos' })).toBeInTheDocument()
    await userEvent.click(within(row).getByRole('button', { name: 'Done' }))
    await waitFor(() => expect(patched).toEqual([expect.objectContaining({ id: 'own-ev', done_at: expect.any(String) })]))
  })

  it('one for a later day is not in today\'s To-do yet', async () => {
    home({ events: [drinks({ event_date: '2026-11-06', starts_at: '2026-11-06T19:00:00.000Z' })] })
    ownTodos()
    mine = [linked({ due_on: '2026-11-05' })]
    renderApp('/coach/home')
    await todo()
    await waitFor(() => expect(screen.queryByText('Loading your to-do…')).toBeNull(), { timeout: 5000 })
    expect(within(await todo()).queryByText('Invite the team · Drinks')).toBeNull()
  })
})
