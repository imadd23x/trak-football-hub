import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { renderApp } from '../../../../tests/support/render-app'
import { signInAs } from '../../../../tests/support/session'
import { server } from '../../../../tests/msw/server'
import { table, rpc, SUPABASE_URL } from '../../../../tests/msw/supabase'
import { toInstant } from '@/lib/event-time'
import { pickTime } from '../../../../tests/support/arc-pickers'
import { eventStep, saveEventWith } from '../../../../tests/support/event-steps'
import { openNewEvent } from '../../../../tests/support/schedule-actions'

/**
 * TRAK-255 (Tarek, 22 Oct, from his Calendar mockups). The coach's page is
 * called Schedule. Its legend names Cancelled (the hollow red ring) and Needs
 * you (an amber corner on a day with a register to take or a match to log).
 * Each event in the day list says its state in colour and opens its venue in
 * Maps. A venue is a name; a map link goes in its own box and is never shown
 * as the name.
 */

const COACH = { id: 'coach-1' }
const EVENTS = `${SUPABASE_URL}/rest/v1/coach_calendar_events`
const TODAY = '2026-10-22'

const row = (over: Record<string, unknown>) => ({
  coach_user_id: COACH.id, event_type: 'training', starts_at: toInstant(TODAY, '18:00'), ends_at: null,
  event_date: TODAY, start_time: '18:00:00', venue: 'Main pitch', opponent: null, notes: null,
  published: false, source: 'manual', meet_time: null, kit: null, home_away: null, status: 'scheduled',
  cancel_reason: null, series_id: null, ...over,
})
const MATCH = row({
  id: 'match-1', title: 'vs AEK Athens U16', event_type: 'match', opponent: 'AEK Athens U16', published: true,
  starts_at: toInstant(TODAY, '16:00'), start_time: '16:00:00', venue: 'Municipal Stadium https://maps.app.goo.gl/abc123',
})
const DRAFT = row({ id: 'draft-1', title: 'Shooting' })
// Started yesterday, published, no register yet: it needs the coach.
const YESTERDAY = row({
  id: 'past-1', title: 'Recovery', published: true, event_date: '2026-10-21',
  starts_at: toInstant('2026-10-21', '10:00'), start_time: '10:00:00',
})
// Saved before TRAK-255 with only a link as its venue.
const LINK_ONLY = row({
  id: 'old-1', title: 'Passing', published: true, event_date: '2026-10-14',
  starts_at: toInstant('2026-10-14', '18:00'), venue: 'https://maps.app.goo.gl/zzz999',
})

let writes: { method: string; body: unknown }[]

function fixtures() {
  writes = []
  server.use(
    table('profiles', [{ id: 'p', user_id: COACH.id, role: 'coach', full_name: 'Coach', invite_code: 'ABCD' }]),
    http.get(EVENTS, () => HttpResponse.json([MATCH, DRAFT, YESTERDAY, LINK_ONLY])),
    table('coach_sessions', []),
    table('squad_players', []),
    rpc('feature_on', () => true),
    http.post(EVENTS, async ({ request }) => {
      writes.push({ method: 'post', body: await request.json() })
      return HttpResponse.json([{ id: 'written' }], { status: 201 })
    }),
    http.post(`${SUPABASE_URL}/functions/v1/send-event-emails`, () => HttpResponse.json({ accepted: true }, { status: 202 })),
  )
}

const card = (title: string) => screen.getByText(title, { selector: 'p' }).closest('div.rounded-\\[14px\\]') as HTMLElement
const cell = (date: string) => document.querySelector(`[data-present] [data-date="${date}"]`) as HTMLElement

async function open() {
  renderApp('/coach/schedule')
  await screen.findByText('vs AEK Athens U16', { selector: 'p' })
}

describe('TRAK-255: the coach\'s Events', { timeout: 20_000 }, () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 9, 22, 9, 0, 0))
    signInAs(COACH)
    fixtures()
  })
  afterEach(() => vi.useRealTimers())

  it('is called Events, and its legend names Cancelled and Needs you', async () => {
    await open()
    expect(screen.getByRole('heading', { level: 1, name: 'Events' })).toBeInTheDocument()
    const key = screen.getByRole('group', { name: 'Colour key' })
    for (const label of ['Training', 'Match', 'Other', 'Cancelled', 'Needs you']) expect(within(key).getByText(label)).toBeInTheDocument()
  })

  it('each event says its state and opens its venue in Maps', async () => {
    await open()
    const match = card('vs AEK Athens U16')
    expect(within(match).getByText('Published')).toBeInTheDocument()
    expect(within(match).getByText(/Municipal Stadium/)).toBeInTheDocument()
    expect(match.textContent).not.toContain('maps.app.goo.gl')
    expect(within(match).getByRole('link', { name: /Open in Maps/ })).toHaveAttribute('href', 'https://maps.app.goo.gl/abc123')

    const draft = card('Shooting')
    expect(within(draft).getByText(/^Draft/)).toBeInTheDocument()
    expect(within(draft).getByRole('link', { name: /Open in Maps/ }).getAttribute('href')).toMatch(/^https:\/\/www\.google\.com\/maps\/search\/.*Main%20pitch/)
  })

  it('a day with a register to take is marked Needs you, and the event says it has started', async () => {
    await open()
    expect(cell('2026-10-21')).toHaveAccessibleName(/needs you/i)
    expect(cell('2026-10-22')).not.toHaveAccessibleName(/needs you/i)
    await userEvent.click(cell('2026-10-21'))
    const past = card('Recovery')
    expect(within(past).getByText(/^Started/)).toBeInTheDocument()
    expect(within(past).getByRole('button', { name: 'Take register for Recovery' })).toBeInTheDocument()
  })

  it('the venue is a name; a map link goes in its own box, and a saved name brings its link', async () => {
    await open()
    await openNewEvent()
    const sheet = screen.getByRole('dialog', { name: 'New event' })
    const venue = within(sheet).getByLabelText('Venue')
    const link = within(sheet).getByLabelText('Map link (optional)')

    // Saved venues are offered by name, never as a bare link.
    const offered = [...document.querySelectorAll('#saved-venues option')].map(o => o.getAttribute('value'))
    expect(offered).toEqual(['Main pitch', 'Municipal Stadium']) // most recently used first, as before

    // A saved name brings its map link with it.
    await userEvent.type(venue, 'Municipal Stadium')
    expect(link).toHaveValue('https://maps.app.goo.gl/abc123')
    await userEvent.clear(venue)
    await userEvent.clear(link)

    // A link pasted into the name box moves to the link box.
    await userEvent.click(venue)
    await userEvent.paste('https://maps.app.goo.gl/new777')
    expect(venue).toHaveValue('')
    expect(link).toHaveValue('https://maps.app.goo.gl/new777')
    await userEvent.type(venue, 'Rizoupoli')

    await eventStep(sheet, 'When')
    await pickTime(userEvent, 'Start', '18:00')
    await saveEventWith(sheet, 'Save draft')
    await waitFor(() => expect(writes).toHaveLength(1))
    const body = writes[0].body as Record<string, unknown> | Record<string, unknown>[]
    const saved = Array.isArray(body) ? body[0] : body
    // Stored as before (TRAK-225): the name, then the link. Families, emails and the feed are unchanged.
    expect(saved.venue).toBe('Rizoupoli https://maps.app.goo.gl/new777')
  })
})

/**
 * TRAK-270 (Tarek, 23 Oct, on the live Schedule): the page had two add buttons, a green "+" at the top and
 * "+ Add" by the chosen day, opening the same form. Tarek kept the green "+"; it opens New event on the
 * chosen day. And "needs you" is a clear yellow (its own token), not the warning amber.
 */
describe('TRAK-270, TRAK-424: one add button, and needs you in yellow', { timeout: 20_000 }, () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 9, 22, 9, 0, 0))
    signInAs(COACH)
    fixtures()
  })
  afterEach(() => vi.useRealTimers())

  // TRAK-424: Schedule's own green "+" and the phone's Back beside the avatar are gone; the frame's "+" is the one way
  // to add, and it still opens New event on the day picked here.
  it('has no add button of its own and no Back, and the frame\'s "+" opens New event on the chosen day', async () => {
    await open()
    expect(screen.queryByRole('button', { name: 'Add event' })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Back$/ })).toBeNull()
    expect(screen.getAllByRole('button', { name: 'Quick add' })).toHaveLength(1)
    await userEvent.click(cell('2026-10-21'))
    await openNewEvent()
    const sheet = screen.getByRole('dialog', { name: 'New event' })
    await eventStep(sheet, 'When')
    expect(within(sheet).getByRole('button', { name: /^Date\b/ })).toHaveTextContent(/21 Oct/)
  })
  // The yellow itself is checked in a real browser (arc-refresh-screens.spec.ts): jsdom drops colours written with var().
})
