/**
 * TRAK-622 (Other events → To-do 2/6, spec TRAK-620): the Add to To-do pop-up. It asks what to do and when it shows,
 * says what the To-do will say, and saves one of the coach's own to-dos linked to the event. Cancel saves nothing.
 * Once added, the button is "In To-do", with the day when that's later. Today is Sat 28 Nov.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { server } from '../../../../tests/msw/server'
import { SUPABASE_URL } from '../../../../tests/msw/supabase'
import { EventTodoButton, useEventTodos, type TodoEvent } from '../EventTodo'

// The to-do hooks name the signed-in coach; this renders the button on its own, without the app.
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'coach-622' } }) }))

const TODAY = '2026-11-28'
const drinks: TodoEvent = { id: 'ev-drinks', title: 'Drinks', day: TODAY, time: '19:00', venue: 'Café Nikos' }
const photo: TodoEvent = { id: 'ev-photo', title: 'Team photo', day: '2026-12-01', time: '17:00', venue: 'Pitch 2' }

type Row = { id: string; title: string; due_on: string; urgent: boolean; done_at: string | null; created_at: string; calendar_event_id: string | null }
let rows: Row[] = []
let posted: Record<string, unknown>[] = []
let refuse = false

function Host({ event }: { event: TodoEvent }) {
  const open = useEventTodos('coach-622')
  return <EventTodoButton event={event} today={TODAY} inTodo={open.get(event.id)} />
}
const show = (event: TodoEvent) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><Host event={event} /></QueryClientProvider>)
const openPopup = async (name: string) => {
  await userEvent.click(await screen.findByRole('button', { name }))
  return screen.findByRole('form', { name: 'Add to To-do' })
}

beforeEach(() => {
  rows = []; posted = []; refuse = false
  server.use(
    http.get(`${SUPABASE_URL}/rest/v1/coach_todos`, () => HttpResponse.json(rows)),
    http.post(`${SUPABASE_URL}/rest/v1/coach_todos`, async ({ request }) => {
      const body = await request.json() as Record<string, unknown>
      posted.push(body)
      if (refuse) return HttpResponse.json({ code: '23505', message: 'duplicate key value violates unique constraint "coach_todos_one_open_per_event"', details: null, hint: null }, { status: 409 })
      rows.push({ id: `todo-${rows.length + 1}`, urgent: false, done_at: null, created_at: '2026-11-28T08:00:00Z', calendar_event_id: null, ...body } as Row)
      return new HttpResponse(null, { status: 201 })
    }),
  )
})
afterEach(() => cleanup())

describe('TRAK-622: Add to To-do on an event', { timeout: 15_000 }, () => {
  it('an event today: Invite the team, Today, saved and linked; the button turns into In To-do', async () => {
    show(drinks)
    const form = await openPopup('Add Drinks to To-do')
    expect(screen.getByText('Drinks · Today · 19:00 · Café Nikos')).toBeInTheDocument()
    expect(within(form).getByRole('button', { name: 'Invite the team' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(form).getByRole('button', { name: 'Today' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(form).getByRole('button', { name: 'The day before' })).toBeDisabled()
    expect(within(form).getByRole('button', { name: 'On the day' })).toBeDisabled()
    expect(within(form).getByText('Drinks is today, so it shows in your To-do today.')).toBeInTheDocument()
    expect(within(form).getByRole('status')).toHaveTextContent('Your To-do will sayInvite the team · DrinksShows today')
    await userEvent.click(within(form).getByRole('button', { name: 'Add to To-do' }))
    await waitFor(() => expect(posted).toEqual([{ title: 'Invite the team · Drinks', due_on: TODAY, urgent: false, calendar_event_id: 'ev-drinks' }]))
    expect(await screen.findByText('In To-do')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add Drinks to To-do' })).toBeNull()
  })

  it('an event on Tuesday: Bring or buy starts on the day before, and says the day it shows from', async () => {
    show(photo)
    const form = await openPopup('Add Team photo to To-do')
    await userEvent.click(within(form).getByRole('button', { name: 'Bring or buy something' }))
    expect(within(form).getByRole('button', { name: 'The day before' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(form).getByRole('status')).toHaveTextContent('Bring or buy something · Team photoShows from Mon 30 Nov')
    await userEvent.click(within(form).getByRole('button', { name: 'Be there' }))
    expect(within(form).getByRole('button', { name: 'On the day' })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(within(form).getByRole('button', { name: 'The day before' }))
    await userEvent.click(within(form).getByRole('button', { name: 'Add to To-do' }))
    await waitFor(() => expect(posted).toEqual([{ title: 'Be there · Team photo', due_on: '2026-11-30', urgent: false, calendar_event_id: 'ev-photo' }]))
    expect(await screen.findByText('In To-do · Mon 30 Nov')).toBeInTheDocument()
  })

  it("Something else: the coach's own words, and nothing saves without them", async () => {
    show(photo)
    const form = await openPopup('Add Team photo to To-do')
    await userEvent.click(within(form).getByRole('button', { name: 'Something else' }))
    const add = within(form).getByRole('button', { name: 'Add to To-do' })
    expect(add).toBeDisabled()
    await userEvent.type(within(form).getByRole('textbox', { name: 'Something else' }), 'Collect the shirts')
    expect(within(form).getByRole('status')).toHaveTextContent('Collect the shirts · Team photo')
    await userEvent.click(add)
    await waitFor(() => expect(posted).toEqual([{ title: 'Collect the shirts · Team photo', due_on: '2026-12-01', urgent: false, calendar_event_id: 'ev-photo' }]))
  })

  it('Cancel closes it and saves nothing', async () => {
    show(drinks)
    const form = await openPopup('Add Drinks to To-do')
    await userEvent.click(within(form).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('form', { name: 'Add to To-do' })).toBeNull())
    expect(posted).toEqual([])
    expect(screen.getByRole('button', { name: 'Add Drinks to To-do' })).toBeInTheDocument()
  })

  it('an event already In To-do shows that, with no button; a ticked one offers it again', async () => {
    rows = [{ id: 'old', title: 'Invite the team · Drinks', due_on: TODAY, urgent: false, done_at: null, created_at: '2026-11-28T07:00:00Z', calendar_event_id: 'ev-drinks' }]
    const first = show(drinks)
    expect(await screen.findByText('In To-do')).toBeInTheDocument()
    first.unmount()
    rows = [{ ...rows[0], done_at: '2026-11-28T09:00:00Z' }]
    show(drinks)
    expect(await screen.findByRole('button', { name: 'Add Drinks to To-do' })).toBeInTheDocument()
  })

  it('if the event already has a to-do (added on another screen), it says so and closes', async () => {
    refuse = true
    show(drinks)
    const form = await openPopup('Add Drinks to To-do')
    await userEvent.click(within(form).getByRole('button', { name: 'Add to To-do' }))
    await waitFor(() => expect(screen.queryByRole('form', { name: 'Add to To-do' })).toBeNull())
    expect(posted).toHaveLength(1)
  })
})
