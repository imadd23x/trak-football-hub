import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { atMorningToday } from '../../../../tests/support/clock'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { chooseCardAction, endActions } from '../../../../tests/support/schedule-actions'
import { renderApp } from '../../../../tests/support/render-app'
import { signInAs } from '../../../../tests/support/session'
import { server } from '../../../../tests/msw/server'
import { table, rpc, SUPABASE_URL } from '../../../../tests/msw/supabase'
import { localTodayISO, toAcademyInstant, toInstant } from '@/lib/event-time'
import { pickDate, pickTime } from '../../../../tests/support/arc-pickers'
import { eventStep, saveEventWith } from '../../../../tests/support/event-steps'

/**
 * TRAK-128 (J8.5). The coach enters a weekly training once, with an end date,
 * on one or more weekdays; each date is its own row under one series_id.
 * Editing, cancelling, publishing or deleting a week asks: only this week, or
 * this and following weeks. Driven through the rendered app and the real SDK.
 */

const COACH = { id: 'coach-1' }
const today = localTodayISO()
const shift = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)
const EVENTS = `${SUPABASE_URL}/rest/v1/coach_calendar_events`
// A Monday two to three weeks out, and the Wednesday eight weeks on: near
// enough that the date picker reaches it in a tap or two (TRAK-157).
const MONDAY = shift(today, 14 + ((8 - new Date(`${today}T00:00:00Z`).getUTCDay()) % 7))
const LAST_WEDNESDAY = shift(MONDAY, 51)

const week = (id: string, offset: number, over: Record<string, unknown> = {}) => {
  const date = shift(today, offset)
  return {
    id, coach_user_id: COACH.id, title: 'Training', event_type: 'training', series_id: 'series-1',
    starts_at: toInstant(date, '18:00'), ends_at: null, event_date: date, start_time: '18:00:00',
    venue: 'Academy Pitch 2', opponent: null, notes: null, published: true, source: 'manual',
    meet_time: null, kit: null, home_away: null, status: 'scheduled', cancel_reason: null, ...over,
  }
}

type Write = { method: string; query: string; body: unknown }
let writes: Write[]
let rows: Record<string, unknown>[]
let emailNudges: number

function fixtures() {
  writes = []
  emailNudges = 0
  // Last week, this week (today), and two more; the one after next is cancelled.
  rows = [week('w0', -7), week('w1', 0), week('w2', 7, { status: 'cancelled' }), week('w3', 14)]
  const write = (method: string) => async ({ request }: { request: Request }) => {
    const body = method === 'delete' ? null : await request.json()
    writes.push({ method, query: decodeURIComponent(new URL(request.url).search), body })
    const n = Array.isArray(body) ? body.length : 1
    return HttpResponse.json(Array.from({ length: n }, (_, i) => ({ id: `written-${i}` })), { status: method === 'post' ? 201 : 200 })
  }
  server.use(
    table('profiles', [{ id: 'p', user_id: COACH.id, role: 'coach', full_name: 'Coach', invite_code: 'ABCD' }]),
    http.get(EVENTS, () => HttpResponse.json(rows)),
    table('coach_sessions', []),
    // TRAK-176: a new event waits for the coach's squads.
    table('squad_players', []),
    // TRAK-294: Training off, so its nav tab doesn't add a second "Training" to the page.
    // TRAK-288: Games off too: with it on, a new match asks its competition.
    rpc('feature_on', ({ p_feature }) => p_feature !== 'training' && p_feature !== 'games'),
    http.post(EVENTS, write('post')),
    http.patch(EVENTS, write('patch')),
    http.delete(EVENTS, write('delete')),
    // TRAK-135: the app asks the server to send queued family emails.
    http.post(`${SUPABASE_URL}/functions/v1/send-event-emails`, () => {
      emailNudges++
      return HttpResponse.json({ accepted: true }, { status: 202 })
    }),
  )
}

async function open() {
  renderApp('/coach/schedule')
  await screen.findByText('Training')
  await waitFor(() => expect(screen.queryByRole('note', { name: 'This screen is coming soon' })).toBeNull())
}

// Picking through Arc's pickers takes a few seconds on a busy runner (TRAK-157).
describe('J8.5: a weekly training series', { timeout: 20_000 }, () => {
  afterEach(() => { server.events.removeAllListeners(); vi.useRealTimers() })
  beforeEach(() => {
    // TRAK-230: this week's 18:00 training is still to come, so it can be edited.
    atMorningToday()
    signInAs(COACH)
    fixtures()
  })

  it('creates 8 weeks of Monday and Wednesday training in one save: 16 drafts, one series', async () => {
    await open()
    await userEvent.click(screen.getByRole('button', { name: 'Add event' }))
    const sheet = screen.getByRole('dialog', { name: 'New event' })
    await userEvent.type(within(sheet).getByLabelText('Venue'), 'Academy Pitch 2')
    await eventStep(sheet, 'When')
    await pickDate(userEvent, 'Date', MONDAY)
    await pickTime(userEvent, 'Start', '18:00')
    await userEvent.click(within(sheet).getByRole('button', { name: 'Repeats weekly' }))
    const days = within(sheet).getByRole('group', { name: 'Repeat on' })
    expect(within(days).getByRole('button', { name: 'Mon' })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(within(days).getByRole('button', { name: 'Wed' }))
    await pickDate(userEvent, 'Ends on', LAST_WEDNESDAY)
    const lastDay = new Date(`${LAST_WEDNESDAY}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
    expect(lastDay).toMatch(/^Wednesday /)
    expect(within(sheet).getByText(`16 events, last one ${lastDay}`)).toBeInTheDocument()
    await saveEventWith(sheet, 'Save 16 drafts')

    await waitFor(() => expect(writes).toHaveLength(1))
    const inserted = writes[0].body as Record<string, unknown>[]
    expect(writes[0].method).toBe('post')
    expect(inserted).toHaveLength(16)
    expect(new Set(inserted.map(r => r.series_id)).size).toBe(1)
    expect(inserted[0].series_id).toMatch(/^[0-9a-f-]{36}$/)
    expect(inserted.map(r => r.event_date).slice(0, 3)).toEqual([MONDAY, shift(MONDAY, 2), shift(MONDAY, 7)])
    expect(inserted.at(-1)).toMatchObject({ event_date: LAST_WEDNESDAY, starts_at: toAcademyInstant(LAST_WEDNESDAY, '18:00') })
    expect(inserted.every(r => r.published === false && r.start_time === '18:00:00' && r.venue === 'Academy Pitch 2')).toBe(true)
    expect(await screen.findByText(/Saved 16 events as drafts/)).toBeInTheDocument()
  })

  // TRAK-182: Review's Publish puts the whole new series out: one insert, one publish.
  it('publishes a new series from Review', async () => {
    await open()
    await userEvent.click(screen.getByRole('button', { name: 'Add event' }))
    const sheet = screen.getByRole('dialog', { name: 'New event' })
    await eventStep(sheet, 'When')
    await pickDate(userEvent, 'Date', MONDAY)
    await pickTime(userEvent, 'Start', '18:00')
    await userEvent.click(within(sheet).getByRole('button', { name: 'Repeats weekly' }))
    await pickDate(userEvent, 'Ends on', LAST_WEDNESDAY)
    await eventStep(sheet, 'Review')
    expect(within(sheet).getByText('Repeats').nextElementSibling).toHaveTextContent(/^Mon until /)
    await saveEventWith(sheet, 'Publish 8')

    await waitFor(() => expect(writes).toHaveLength(2))
    expect(writes[0].method).toBe('post')
    expect(writes[0].body).toHaveLength(8)
    expect(writes[1]).toMatchObject({ method: 'patch', body: { published: true } })
    expect(writes[1].query).toMatch(/^\?id=in\.\(written-0,written-1,/)
    // TRAK-135: one nudge; the server makes one email per person for the 8 weeks.
    await waitFor(() => expect(emailNudges).toBe(1))
  })

  // Imad's #263 review: the repeat controls hide for a match, but hiding them
  // didn't switch the repeat off, so Save wrote a series of identical matches.
  it('switching a repeating training to a match saves one match, never a series', async () => {
    await open()
    await userEvent.click(screen.getByRole('button', { name: 'Add event' }))
    const sheet = screen.getByRole('dialog', { name: 'New event' })
    await eventStep(sheet, 'When')
    await pickDate(userEvent, 'Date', MONDAY)
    await pickTime(userEvent, 'Start', '18:00')
    await userEvent.click(within(sheet).getByRole('button', { name: 'Repeats weekly' }))
    await pickDate(userEvent, 'Ends on', LAST_WEDNESDAY)
    await eventStep(sheet, 'What')
    await userEvent.click(within(within(sheet).getByRole('group', { name: 'Event type' })).getByRole('button', { name: 'Match' }))
    await userEvent.type(within(sheet).getByLabelText('Opponent'), 'Synthetic Rovers')
    await eventStep(sheet, 'Review')
    expect(within(sheet).queryByRole('button', { name: /^Save \d+ drafts$/ })).toBeNull()
    expect(within(sheet).queryByText('Repeats')).toBeNull()
    await saveEventWith(sheet, 'Save draft')

    await waitFor(() => expect(writes).toHaveLength(1))
    const inserted = writes[0].body as Record<string, unknown>[]
    expect(inserted).toHaveLength(1)
    expect(inserted[0]).toMatchObject({ event_type: 'match', event_date: MONDAY, opponent: 'Synthetic Rovers' })
    expect(inserted[0].series_id ?? null).toBeNull()
  })

  it("won't save a series that ends before it starts, and says so", async () => {
    await open()
    await userEvent.click(screen.getByRole('button', { name: 'Add event' }))
    const sheet = screen.getByRole('dialog', { name: 'New event' })
    await eventStep(sheet, 'When')
    await pickTime(userEvent, 'Start', '18:00')
    await userEvent.click(within(sheet).getByRole('button', { name: 'Repeats weekly' }))
    await pickDate(userEvent, 'Ends on', shift(today, -1))
    // TRAK-182: Next stops on When, where the end date can be fixed.
    await userEvent.click(within(sheet).getByRole('button', { name: 'Next' }))
    expect(within(sheet).getByRole('alert')).toHaveTextContent('The series has to end on or after its first date')
    expect(within(sheet).getByRole('button', { name: 'Repeats weekly' })).toBeInTheDocument()
    expect(writes).toEqual([])
  })

  it('moves this and following weeks to 18:30; each keeps its date, and cancelled and past weeks stay', async () => {
    await open()
    await userEvent.click(screen.getByRole('button', { name: 'Edit Training' }))
    const sheet = screen.getByRole('dialog', { name: 'Edit event' })
    await userEvent.click(within(sheet).getByRole('button', { name: 'This and following weeks' }))
    await eventStep(sheet, 'When')
    expect(within(sheet).getByRole('button', { name: /^Date\b/ })).toBeDisabled()
    await pickTime(userEvent, 'Start', '18:30')
    // The choice is made on the first step now (an edit opens there); Review repeats it.
    await eventStep(sheet, 'Review')
    expect(within(sheet).getByText('Saves this week and the following weeks.')).toBeInTheDocument()
    await saveEventWith(sheet, 'Save changes')

    await waitFor(() => expect(writes).toHaveLength(2))
    const byId = Object.fromEntries(writes.map(w => [w.query.match(/id=eq\.(\w+)/)![1], w.body as Record<string, unknown>]))
    expect(Object.keys(byId).sort()).toEqual(['w1', 'w3'])   // not last week, not the cancelled week
    expect(byId.w1).toMatchObject({ event_date: today, start_time: '18:30:00', starts_at: toAcademyInstant(today, '18:30') })
    expect(byId.w3).toMatchObject({ event_date: shift(today, 14), start_time: '18:30:00' })
    expect(await screen.findByText('Saved 2 weeks. Families see the change.')).toBeInTheDocument()
    // TRAK-135: published weeks changed, so queued family emails are sent.
    expect(emailNudges).toBe(1)
  })

  it('says how many weeks saved when one of "this and following" fails, never "Saved" for all', async () => {
    // One week's update fails (connection, or RLS answering no row): the coach
    // must be told, or that week silently keeps the old time.
    server.use(http.patch(EVENTS, ({ request }) =>
      new URL(request.url).search.includes('w3')
        ? HttpResponse.json({ message: 'Synthetic failure' }, { status: 500 })
        : HttpResponse.json([{ id: 'written-0' }])))
    await open()
    await userEvent.click(screen.getByRole('button', { name: 'Edit Training' }))
    const sheet = screen.getByRole('dialog', { name: 'Edit event' })
    await userEvent.click(within(sheet).getByRole('button', { name: 'This and following weeks' }))
    await eventStep(sheet, 'When')
    await pickTime(userEvent, 'Start', '18:30')
    await saveEventWith(sheet, 'Save changes')

    expect(await within(sheet).findByText(/Saved 1 of 2 weeks/)).toBeInTheDocument()
    expect(screen.queryByText(/Saved 2 weeks/)).not.toBeInTheDocument()
  })

  it('cancels only this week, or this and following weeks', async () => {
    await open()
    await chooseCardAction('Training', 'Cancel')
    let sheet = screen.getByRole('dialog', { name: 'Cancel event' })
    expect(within(sheet).getByRole('button', { name: 'Only this week' })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(within(sheet).getByRole('button', { name: 'Cancel event' }))
    await waitFor(() => expect(writes).toHaveLength(1))
    expect(writes[0]).toMatchObject({ method: 'patch', query: '?id=eq.w1&select=id', body: { status: 'cancelled' } })

    // TRAK-168: one cancelled week is offered to the team group; Done closes it.
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'Event cancelled' })).getByRole('button', { name: 'Done' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await chooseCardAction('Training', 'Cancel')
    sheet = screen.getByRole('dialog', { name: 'Cancel event' })
    await userEvent.click(within(sheet).getByRole('button', { name: 'This and following weeks' }))
    await userEvent.click(within(sheet).getByRole('button', { name: 'Cancel event' }))
    // Imad's #263 review: only published weeks are cancelled. Unpublished
    // drafts in the range are deleted, never left cancelled and undeletable.
    await waitFor(() => expect(writes).toHaveLength(3))
    expect(writes[1]).toMatchObject({
      method: 'patch',
      query: `?series_id=eq.series-1&event_date=gte.${today}&status=eq.scheduled&published=eq.true&select=id`,
      body: { status: 'cancelled' },
    })
    expect(writes[2]).toMatchObject({
      method: 'delete',
      query: `?series_id=eq.series-1&event_date=gte.${today}&published=eq.false&status=eq.scheduled&select=id`,
    })
    // TRAK-135: each cancel asks for the families' email; the series is one email per person.
    await waitFor(() => expect(emailNudges).toBe(2))
    // TRAK-168 (Imad, 18 Oct): the share is still offered, for this week's event
    // only; the following weeks get no message.
    const done = await screen.findByRole('dialog', { name: 'Event cancelled' })
    // What the toast used to say stays: the cancel, and the drafts removed after it.
    expect(done).toHaveTextContent('1 unpublished draft removed.')
    const shared = within(done).getByRole('link', { name: /Share/ })
    const text = decodeURIComponent(new URL(shared.getAttribute('href')!).searchParams.get('text')!)
    expect(text).toContain('/event/w1')
    expect(text.match(/trakfootball\.com\/event\//g)).toHaveLength(1)
  })

  it('publishes this and following draft weeks in one go', async () => {
    rows = rows.map(r => ({ ...r, published: false }))
    await open()
    await userEvent.click(screen.getByRole('button', { name: 'Publish Training' }))
    const sheet = screen.getByRole('dialog', { name: 'Publish event' })
    await userEvent.click(within(sheet).getByRole('button', { name: 'This and following weeks' }))
    await waitFor(() => expect(writes).toHaveLength(1))
    expect(writes[0]).toMatchObject({
      method: 'patch',
      query: `?series_id=eq.series-1&event_date=gte.${today}&published=eq.false&status=eq.scheduled&select=id`,
      body: { published: true },
    })
    await waitFor(() => expect(emailNudges).toBe(1)) // TRAK-135
  })

  it('deletes only this draft week, never a published one', async () => {
    rows = rows.map(r => ({ ...r, published: false }))
    await open()
    await chooseCardAction('Training', 'Delete')
    const sheet = screen.getByRole('dialog', { name: 'Delete draft' })
    await userEvent.click(within(sheet).getByRole('button', { name: 'Only this week' }))
    await waitFor(() => expect(writes).toHaveLength(1))
    expect(writes[0]).toMatchObject({ method: 'delete', query: '?id=eq.w1&select=id' })
  })

  it('marks a series week as Weekly on its card', async () => {
    await open()
    // TRAK-159: the time leads the card.
    // TRAK-255: the type word is in its own colour, so the line is read as a whole.
    expect(screen.getByText((_, el) => el?.tagName === 'P' && /Training · Weekly/.test(el.textContent ?? ''))).toHaveTextContent('18:00 · Training · Weekly')
  })
})
