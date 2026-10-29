import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { renderApp } from '../../../../tests/support/render-app'
import { signInAs } from '../../../../tests/support/session'
import { server } from '../../../../tests/msw/server'
import { table, rpc, SUPABASE_URL } from '../../../../tests/msw/supabase'
import { localTodayISO, toInstant } from '@/lib/event-time'
import { dateHeld, pickDate, pickTime } from '../../../../tests/support/arc-pickers'
import { eventStep } from '../../../../tests/support/event-steps'

/**
 * TRAK-127 (J8.4), live run 3 (16 Oct): Imad created a match dated two days
 * back with New event and published it. It asked for no score, said
 * "Attending" for a game that was over, and offered Share and Cancel. Decided
 * (Imad, 16 Oct): New event is for what's coming; what already happened is
 * logged. A past date says so and offers the two logs. Today still works. A
 * past event isn't edited at all (TRAK-230).
 */

const COACH = { id: 'coach-127' }
const EVENTS = `${SUPABASE_URL}/rest/v1/coach_calendar_events`
const today = localTodayISO()
const shift = (iso: string, days: number) => {
  const [y, m, d] = iso.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d + days))
  return t.toISOString().slice(0, 10)
}
const yesterday = shift(today, -1)
const PASSED = 'This date has passed: log it instead'

const OLD = {
  id: 'old-1', coach_user_id: COACH.id, title: 'Finishing', event_type: 'training', starts_at: toInstant(yesterday, '17:00'),
  ends_at: null, event_date: yesterday, start_time: '17:00:00', end_time: null, venue: 'Academy Pitch 2', opponent: null,
  notes: null, published: true, source: 'manual', meet_time: null, kit: null, home_away: null, status: 'scheduled',
  cancel_reason: null, series_id: null,
}

let posts: unknown[]
beforeEach(() => {
  signInAs(COACH)
  posts = []
  server.use(
    table('profiles', [{ id: 'p', user_id: COACH.id, role: 'coach', full_name: 'Coach', invite_code: 'ABCD' }]),
    http.get(EVENTS, () => HttpResponse.json([OLD])),
    http.post(EVENTS, async ({ request }) => { posts.push(await request.json()); return HttpResponse.json([{ id: 'new-1' }], { status: 201 }) }),
    http.patch(EVENTS, () => HttpResponse.json([{ id: 'old-1' }])),
    table('coach_sessions', []),
    table('squad_players', []),
    table('session_attendance', []),
    table('event_absences', []),
    // TRAK-288: Games off, so a match is still logged as today.
    rpc('feature_on', ({ p_feature }) => p_feature !== 'games'),
    rpc('coach_squad_player_consent_required', () => false),
  )
})
afterEach(() => { server.events.removeAllListeners() })

/** The training log's date: a date box today, Arc's picker once #336 (TRAK-157) lands. */
async function expectTrainingDate(day: string) {
  const field = await screen.findByLabelText('Session date', { selector: 'input, button' })
  if (field instanceof HTMLInputElement) return waitFor(() => expect(field).toHaveValue(day))
  await userEvent.click(field)
  const dialog = await screen.findByRole('dialog', { name: 'Session date calendar' })
  expect(dialog.querySelector('[data-present] [aria-selected="true"]')?.getAttribute('data-date')).toBe(day)
}

async function newEventOn(day: string) {
  renderApp('/coach/schedule')
  await userEvent.click(await screen.findByRole('button', { name: 'Add event' }))
  const sheet = screen.getByRole('dialog', { name: 'New event' })
  await eventStep(sheet, 'When')
  if (day !== today) await pickDate(userEvent, 'Date', day)
  await pickTime(userEvent, 'Start', '17:00')
  return sheet
}

describe('TRAK-127: New event is for what is coming', { timeout: 30_000 }, () => {
  it('a past date says so, offers both logs, and stops Next, Save draft and Publish', async () => {
    const sheet = await newEventOn(yesterday)
    expect(await within(sheet).findByText(PASSED)).toBeInTheDocument()
    expect(within(sheet).getByRole('button', { name: 'Log match' })).toBeInTheDocument()
    expect(within(sheet).getByRole('button', { name: 'Log training' })).toBeInTheDocument()
    await userEvent.click(within(sheet).getByRole('button', { name: 'Next' }))
    // Still on When: nothing past this step, so no Save draft or Publish to press.
    expect(sheet.querySelector('[aria-current="step"]')?.textContent).toContain('When')
    expect(within(sheet).queryByRole('button', { name: 'Save draft' })).toBeNull()
    expect(within(sheet).queryByRole('button', { name: 'Publish' })).toBeNull()
    expect(posts).toHaveLength(0)
  })

  it('Log training from there opens the training log on that date', async () => {
    const sheet = await newEventOn(yesterday)
    await userEvent.click(await within(sheet).findByRole('button', { name: 'Log training' }))
    await expectTrainingDate(yesterday)
    expect(screen.getByRole('button', { name: /^Technical/ })).toBeInTheDocument()
  })

  it('Log match from there opens the match log on that date', async () => {
    const sheet = await newEventOn(yesterday)
    await userEvent.click(await within(sheet).findByRole('button', { name: 'Log match' }))
    expect(await screen.findByPlaceholderText('Opponent name')).toBeInTheDocument()
    expect(await dateHeld(userEvent, 'Session date')).toBe(yesterday)
  })

  it('today still works', async () => {
    const sheet = await newEventOn(today)
    expect(within(sheet).queryByText(PASSED)).toBeNull()
    await eventStep(sheet, 'Review')
    expect(within(sheet).getByRole('button', { name: 'Save draft' })).toBeEnabled()
    expect(within(sheet).getByRole('button', { name: 'Publish' })).toBeEnabled()
  })

  // TRAK-230 (Kostas, 21 Oct, option A) replaces "an edit that keeps a past event's own date
  // still saves": once an event has started it isn't edited at all, only logged.
  it("a past event isn't edited: Edit's link says it has started, and no form opens", async () => {
    // Home's event sheet hands Edit to Schedule this way (TRAK-182).
    renderApp('/coach/schedule?edit=old-1')
    expect(await screen.findByText("This event has started, so it can't be changed. Use its register or match log instead.")).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'Edit event' })).toBeNull()
  })
})

describe('TRAK-127: Quick add New event is for what is coming', { timeout: 30_000 }, () => {
  it('a past date says so, offers both logs, and Save draft stays shut', async () => {
    renderApp('/coach/schedule')
    await userEvent.click(await screen.findByRole('button', { name: 'Quick add' }))
    const menu = await screen.findByRole('menu', { name: 'Quick add' })
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'New event' }))
    const form = await screen.findByRole('dialog', { name: 'New event' })
    await pickDate(userEvent, 'Date', yesterday)
    await pickTime(userEvent, 'Start', '17:00')
    expect(await within(form).findByText(PASSED)).toBeInTheDocument()
    expect(within(form).getByRole('button', { name: 'Save draft' })).toBeDisabled()
    // Log match stays inside "+", with the date kept.
    await userEvent.click(within(form).getByRole('button', { name: 'Log match' }))
    expect(await screen.findByRole('dialog', { name: 'Log a match' })).toBeInTheDocument()
    expect(posts).toHaveLength(0)
  })
})
