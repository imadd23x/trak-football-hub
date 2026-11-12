import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { renderApp } from '../../../../tests/support/render-app'
import { signInAs } from '../../../../tests/support/session'
import { server } from '../../../../tests/msw/server'
import { table, rpc, SUPABASE_URL } from '../../../../tests/msw/supabase'
import { localTodayISO, toInstant } from '@/lib/event-time'
import { pickDate, pickTime } from '../../../../tests/support/arc-pickers'
import { eventStep, saveEventWith } from '../../../../tests/support/event-steps'
import { openNewEvent } from '../../../../tests/support/schedule-actions'

/**
 * TRAK-218 (20 Oct live run, S1): an 8-week series was refused on Publish
 * because one week overlapped Game Day. The refusal was a toast that went
 * away and didn't say which week, and every week stayed a draft. Now the
 * coach is told which week clashes and that nothing went out, each clashing
 * draft says so on the schedule, and Publish again is one all-or-nothing
 * update of the same drafts, never a second set.
 */

const COACH = { id: 'coach-1' }
const today = localTodayISO()
const shift = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)
const day = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
const EVENTS = `${SUPABASE_URL}/rest/v1/coach_calendar_events`
const CLASH = 'This overlaps Game Day, 17:00–18:30. Change the time or cancel one.'
const MONDAY = shift(today, 14 + ((8 - new Date(`${today}T00:00:00Z`).getUTCDay()) % 7))

const row = (id: string, date: string, over: Record<string, unknown> = {}) => ({
  id, coach_user_id: COACH.id, title: 'Training', event_type: 'training', starts_at: toInstant(date, '18:00'),
  ends_at: null, event_date: date, start_time: '18:00:00', end_time: '19:30:00', venue: 'Main Venue',
  opponent: null, notes: null, published: false, source: 'manual', meet_time: null, kit: null, home_away: null,
  status: 'scheduled', cancel_reason: null, series_id: null, ...over,
})
const game = (date: string) => row('game', date, { title: 'Game Day', event_type: 'match', published: true,
  start_time: '17:00:00', end_time: '18:30:00', starts_at: toInstant(date, '17:00') })

type Write = { method: string; query: string; body: unknown }
let writes: Write[]
let rows: Record<string, unknown>[]
let refuse: boolean

function fixtures(start: Record<string, unknown>[]) {
  writes = []
  rows = [...start]
  refuse = true
  server.use(
    table('profiles', [{ id: 'p', user_id: COACH.id, role: 'coach', full_name: 'Dora', invite_code: 'ABCD' }]),
    http.get(EVENTS, () => HttpResponse.json(rows)),
    table('coach_sessions', []),
    table('squad_players', []),
    rpc('feature_on', () => true),
    // The insert is stored, so the next read has the new drafts.
    http.post(EVENTS, async ({ request }) => {
      const body = await request.json() as Record<string, unknown>[]
      writes.push({ method: 'post', query: '', body })
      const made = body.map((r, i) => ({ ...r, id: `new-${i}` }))
      rows = [...rows, ...made]
      return HttpResponse.json(made.map(r => ({ id: r.id })), { status: 201 })
    }),
    http.patch(EVENTS, async ({ request }) => {
      writes.push({ method: 'patch', query: decodeURIComponent(new URL(request.url).search), body: await request.json() })
      if (refuse) return HttpResponse.json({ code: 'P0001', message: CLASH, details: null, hint: null }, { status: 400 })
      return HttpResponse.json([{ id: 'w1' }, { id: 'w2' }, { id: 'w3' }])
    }),
    http.post(`${SUPABASE_URL}/functions/v1/send-event-emails`, () => HttpResponse.json({ accepted: true }, { status: 202 })),
  )
}

async function open(text: string, selector = 'p') {
  renderApp('/coach/schedule')
  await screen.findByText(text, { selector })
  await waitFor(() => expect(screen.queryByRole('note', { name: 'This screen is coming soon' })).toBeNull())
}

describe('TRAK-218: a series refused for an overlap', { timeout: 30_000 }, () => {
  afterEach(() => { server.events.removeAllListeners() })
  beforeEach(() => signInAs(COACH))

  it('a draft that would clash says so on the schedule, before Publish is tapped', async () => {
    fixtures([game(today), row('d-clash', today), row('d-free', today, { title: 'Recovery', start_time: '19:00:00', end_time: '20:00:00' })])
    await open('Game Day')
    const card = (title: string) => screen.getByText(title, { selector: 'p' }).closest('div.rounded-\\[14px\\]') as HTMLElement
    expect(within(card('Training')).getByText('Clashes with Game Day, 17:00–18:30. Change the time to publish it.')).toBeInTheDocument()
    expect(within(card('Recovery')).queryByText(/Clashes with/)).toBeNull()
    expect(within(card('Game Day')).queryByText(/Clashes with/)).toBeNull()
  })

  it('Publish from Review, refused: it stays on screen, names the week, and says nothing went out', async () => {
    fixtures([game(shift(MONDAY, 7))])
    await open('Nothing planned', 'span')
    await openNewEvent()
    const sheet = screen.getByRole('dialog', { name: 'New event' })
    await eventStep(sheet, 'When')
    await pickDate(userEvent, 'Date', MONDAY)
    await pickTime(userEvent, 'Start', '18:00')
    await userEvent.click(within(sheet).getByRole('button', { name: 'Repeats weekly' }))
    await pickDate(userEvent, 'Ends on', shift(MONDAY, 14))
    await saveEventWith(sheet, 'Publish 3')

    const box = await screen.findByRole('dialog', { name: 'Not published' })
    expect(box).toHaveTextContent('None of the 3 events went out. They’re saved as drafts only you can see.')
    expect(box).toHaveTextContent(`${day(shift(MONDAY, 7))} overlaps Game Day, 17:00–18:30.`)
    expect(box).toHaveTextContent('Change that week’s time, or cancel Game Day. Then tap Publish on the first week and choose This and following weeks.')
    // One insert and one refused publish of all three: nothing half-published.
    expect(writes.map(w => w.method)).toEqual(['post', 'patch'])
    expect(writes[1].query).toBe('?id=in.(new-0,new-1,new-2)&select=id')

    await userEvent.click(within(box).getByRole('button', { name: `Show ${day(shift(MONDAY, 7))}` }))
    expect(screen.queryByRole('dialog', { name: 'Not published' })).toBeNull()
    expect(await screen.findByText('Clashes with Game Day, 17:00–18:30. Change the time to publish it.')).toBeInTheDocument()
  })

  it('Publish again from the list is one update of the same drafts: refused, it names the week; cleared, all go', async () => {
    const SERIES = { series_id: 'series-1' }
    fixtures([game(shift(today, 7)),
      row('w1', today, SERIES), row('w2', shift(today, 7), SERIES), row('w3', shift(today, 14), SERIES)])
    await open('Training')

    await userEvent.click(screen.getByRole('button', { name: 'Publish Training' }))
    await userEvent.click(await screen.findByRole('button', { name: 'This and following weeks' }))
    expect(await screen.findByText(
      `None of the 3 drafts went out: ${day(shift(today, 7))} overlaps Game Day, 17:00–18:30. Change that week’s time, or cancel Game Day, then publish again.`,
    )).toBeInTheDocument()

    refuse = false
    await userEvent.click(screen.getByRole('button', { name: 'This and following weeks' }))
    expect(await screen.findByText('Published 3 events to the squad')).toBeInTheDocument()
    expect(writes.map(w => w.method)).toEqual(['patch', 'patch'])
    expect(writes.every(w => w.query.startsWith(`?series_id=eq.series-1&event_date=gte.${today}&published=eq.false&status=eq.scheduled`))).toBe(true)
  })
})
