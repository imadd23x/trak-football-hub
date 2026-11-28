import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { renderApp } from '../../../../tests/support/render-app'
import { signInAs } from '../../../../tests/support/session'
import { server } from '../../../../tests/msw/server'
import { table, rpc, SUPABASE_URL } from '../../../../tests/msw/supabase'
import { toAcademyInstant } from '@/lib/event-time'

/**
 * TRAK-623 (Other events → To-do 3/6, spec TRAK-620, Kostas's 28 Nov mockup): an "Other" event's card in Events has
 * Add to To-do beside its next steps, so the coach doesn't need to open it; its sheet has the same button. Once added,
 * both say In To-do. Trainings and matches don't change; a cancelled or finished event has neither. Now is 20:00 on
 * Sat 28 Nov at the academy (evening, so every event is on the same day on the test machine too).
 */

// A new coach for each test, so nothing one test saved is remembered by the next.
let n = 0
let COACH = { id: 'coach-623' }
const TODAY = '2026-11-28'
const row = (over: Record<string, unknown> & { id: string }) => ({
  coach_user_id: 'set-per-test', event_type: 'other', starts_at: toAcademyInstant(TODAY, '21:00'), ends_at: null,
  event_date: TODAY, start_time: '21:00:00', venue: 'Café Nikos', opponent: null, notes: null,
  published: true, source: 'manual', meet_time: null, kit: null, home_away: null, status: 'scheduled',
  cancel_reason: null, series_id: null, squad: null, ...over,
})
const DRINKS = row({ id: 'ev-drinks', title: 'Drinks' })
const TRAINING = row({ id: 'ev-train', title: 'Technical training', event_type: 'training', starts_at: toAcademyInstant(TODAY, '20:30'), start_time: '20:30:00' })
const PHOTO = row({ id: 'ev-photo', title: 'Team photo', status: 'cancelled', cancel_reason: 'Rain' })
const BREAKFAST = row({ id: 'ev-breakfast', title: 'Breakfast', starts_at: toAcademyInstant(TODAY, '10:00'), start_time: '10:00:00', ends_at: toAcademyInstant(TODAY, '11:00') })

type Todo = { id: string; title: string; due_on: string; urgent: boolean; done_at: string | null; created_at: string; calendar_event_id: string | null }
let todos: Todo[] = []
let posted: Record<string, unknown>[] = []

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(toAcademyInstant(TODAY, '20:00')!))
  localStorage.clear()
  COACH = { id: `coach-623-${++n}` }
  signInAs(COACH)
  todos = []; posted = []
  server.use(
    table('profiles', [{ id: 'p', user_id: COACH.id, role: 'coach', full_name: 'Coach', invite_code: 'ABCD' }]),
    http.get(`${SUPABASE_URL}/rest/v1/coach_calendar_events`, ({ request }) => {
      const all = [DRINKS, TRAINING, PHOTO, BREAKFAST].map(e => ({ ...e, coach_user_id: COACH.id }))
      const id = new URL(request.url).searchParams.get('id')?.replace(/^eq\./, '')
      return HttpResponse.json(id ? all.filter(e => e.id === id) : all)
    }),
    table('coach_sessions', []),
    table('squad_players', []),
    table('event_absences', []),
    table('event_confirmations', []),
    table('game_evaluations', []),
    table('coach_details', []),
    table('squad_player_profiles', []),
    table('training_notes', []),
    rpc('feature_on', () => true),
    http.get(`${SUPABASE_URL}/rest/v1/coach_todos`, () => HttpResponse.json(todos)),
    http.post(`${SUPABASE_URL}/rest/v1/coach_todos`, async ({ request }) => {
      const body = await request.json() as Record<string, unknown>
      posted.push(body)
      todos.push({ id: `todo-${todos.length + 1}`, urgent: false, done_at: null, created_at: new Date().toISOString(), calendar_event_id: null, ...body } as Todo)
      return new HttpResponse(null, { status: 201 })
    }),
  )
})
afterEach(() => { vi.useRealTimers(); cleanup() })

const card = (title: string) => screen.getByText(title, { selector: 'p' }).closest('div.rounded-2xl') as HTMLElement

describe('TRAK-623: Add to To-do on an "Other" event in Events', { timeout: 20_000 }, () => {
  it("only the Other event's card offers it; a training, a cancelled and a finished event don't", async () => {
    renderApp('/coach/schedule')
    expect(await screen.findByRole('button', { name: 'Add Drinks to To-do' }, { timeout: 8000 })).toBeInTheDocument()
    expect(within(card('Drinks')).getByRole('button', { name: 'Add Drinks to To-do' })).toBeInTheDocument()
    expect(within(card('Technical training')).queryByRole('button', { name: /to To-do/ })).toBeNull()
    expect(within(card('Team photo')).queryByRole('button', { name: /to To-do/ })).toBeNull()
    expect(within(card('Breakfast')).queryByRole('button', { name: /to To-do/ })).toBeNull()
  })

  it('from the card: saved, linked to the event, and the card says In To-do', async () => {
    renderApp('/coach/schedule')
    await userEvent.click(await screen.findByRole('button', { name: 'Add Drinks to To-do' }, { timeout: 8000 }))
    const form = await screen.findByRole('form', { name: 'Add to To-do' })
    await userEvent.click(within(form).getByRole('button', { name: 'Add to To-do' }))
    await waitFor(() => expect(posted).toEqual([{ title: 'Invite the team · Drinks', due_on: TODAY, urgent: false, calendar_event_id: 'ev-drinks' }]))
    await waitFor(() => expect(within(card('Drinks')).getByText('In To-do')).toBeInTheDocument())
    expect(within(card('Drinks')).queryByRole('button', { name: 'Add Drinks to To-do' })).toBeNull()
  })

  it("from the event's sheet: the same button, and In To-do there once added", async () => {
    renderApp('/coach/schedule')
    await screen.findByRole('button', { name: 'Add Drinks to To-do' }, { timeout: 8000 })
    await userEvent.click(within(card('Drinks')).getByRole('button', { name: 'Drinks' }))
    const sheet = await screen.findByRole('dialog', { name: 'Drinks' })
    await userEvent.click(await within(sheet).findByRole('button', { name: 'Add Drinks to To-do' }, { timeout: 8000 }))
    const form = await screen.findByRole('form', { name: 'Add to To-do' })
    await userEvent.click(within(form).getByRole('button', { name: 'Be there' }))
    await userEvent.click(within(form).getByRole('button', { name: 'Add to To-do' }))
    await waitFor(() => expect(posted).toEqual([{ title: 'Be there · Drinks', due_on: TODAY, urgent: false, calendar_event_id: 'ev-drinks' }]))
    await waitFor(() => expect(within(sheet).getByText('In To-do')).toBeInTheDocument())
  })

  it('an event already in the To-do says so on its card', async () => {
    todos = [{ id: 'old', title: 'Invite the team · Drinks', due_on: TODAY, urgent: false, done_at: null, created_at: '2026-11-28T05:00:00Z', calendar_event_id: 'ev-drinks' }]
    renderApp('/coach/schedule')
    expect(await within(await waitFor(() => card('Drinks'), { timeout: 8000 })).findByText('In To-do', {}, { timeout: 8000 })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add Drinks to To-do' })).toBeNull()
  })
})
