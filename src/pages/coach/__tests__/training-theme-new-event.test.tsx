import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { renderApp } from '../../../../tests/support/render-app'
import { signInAs } from '../../../../tests/support/session'
import { server } from '../../../../tests/msw/server'
import { table, rpc, SUPABASE_URL } from '../../../../tests/msw/supabase'
import { localTodayISO, toInstant } from '@/lib/event-time'
import { pickTime } from '../../../../tests/support/arc-pickers'
import { eventStep, saveEventWith } from '../../../../tests/support/event-steps'
import { atMorningToday } from '../../../../tests/support/clock'
import { openNewEvent } from '../../../../tests/support/schedule-actions'

/**
 * [scope] Training theme on New event: setting up a training, the coach picks
 * its theme from the catalogue's seven libraries (radio buttons) and can open
 * the Coaching Session Catalogue on that theme to find sessions for it.
 */

const COACH = { id: 'coach-theme' }
const EVENTS = `${SUPABASE_URL}/rest/v1/coach_calendar_events`
const today = localTodayISO()
const SAVED = {
  id: 'ev-1', coach_user_id: COACH.id, title: 'Training', event_type: 'training', starts_at: toInstant(today, '23:00'),
  ends_at: null, event_date: today, start_time: '23:00:00', end_time: null, venue: null, opponent: null,
  notes: null, published: false, source: 'manual', meet_time: null, kit: null, home_away: null, status: 'scheduled',
  cancel_reason: null, series_id: null, training_theme: 'goalkeeping',
}

let posts: unknown[]
let patches: unknown[]
// TRAK-419: whether the academy's Training switch is on (every other feature is on).
let trainingOn: boolean
beforeEach(() => {
  trainingOn = false
  // TRAK-253: the saved event is today 23:00, which has started (and is locked, TRAK-230)
  // once a CI runner passes 19:00 UTC. The Schedule suites run at 09:00 today.
  atMorningToday()
  signInAs(COACH)
  posts = []
  patches = []
  server.use(
    table('profiles', [{ id: 'p', user_id: COACH.id, role: 'coach', full_name: 'Coach', invite_code: 'ABCD' }]),
    http.get(EVENTS, () => HttpResponse.json([SAVED])),
    http.post(EVENTS, async ({ request }) => { posts.push(await request.json()); return HttpResponse.json([{ id: 'new-1' }], { status: 201 }) }),
    http.patch(EVENTS, async ({ request }) => { patches.push(await request.json()); return HttpResponse.json([{ id: 'ev-1' }]) }),
    table('coach_sessions', []),
    table('squad_players', []),
    table('session_attendance', []),
    table('event_absences', []),
    rpc('feature_on', ({ p_feature }) => p_feature !== 'training' || trainingOn),
    rpc('coach_squad_player_consent_required', () => false),
  )
})
afterEach(() => { server.events.removeAllListeners(); vi.useRealTimers() })

async function newEvent() {
  renderApp('/coach/schedule')
  await openNewEvent()
  return screen.getByRole('dialog', { name: 'New event' })
}

describe('Training theme on New event', { timeout: 30_000 }, () => {
  it('a training offers the seven themes as radio buttons, none picked', async () => {
    const sheet = await newEvent()
    const group = within(sheet).getByRole('radiogroup', { name: 'Theme' })
    const radios = within(group).getAllByRole('radio')
    expect(radios).toHaveLength(7)
    for (const name of ['Technical', 'Attacking', 'Defending', 'Transition', 'Goalkeeping', 'Physical & movement', 'Psychological & social']) {
      expect(within(group).getByRole('radio', { name: new RegExp(`^${name}`) })).not.toBeChecked()
    }
    expect(within(group).getByText('82 sessions · 4 topics')).toBeInTheDocument()
  })

  it('links to the catalogue, on the picked theme once there is one', async () => {
    const sheet = await newEvent()
    const link = () => within(sheet).getByRole('link', { name: /Trainings Catalogue/ })
    expect(link()).toHaveAttribute('href', '/coach/trainings')
    expect(link()).toHaveAttribute('target', '_blank')
    await userEvent.click(within(sheet).getByRole('radio', { name: /^Defending/ }))
    expect(link()).toHaveAttribute('href', '/coach/trainings/defending')
  })

  // TRAK-419 (11 Nov review): where Training is on, Drills is the one library. The link opens Training › Drills, on the
  // theme's drills where Drills can show them, and the old catalogue's counts go (they are not Drills' counts).
  it('with Training on, links to Training › Drills, on the picked theme, without the catalogue counts', async () => {
    trainingOn = true
    // A coach of their own, so the app's cache never carries the earlier tests' "off" into this one.
    signInAs({ id: 'coach-theme-training' })
    server.use(table('profiles', [{ id: 'p', user_id: 'coach-theme-training', role: 'coach', full_name: 'Coach', invite_code: 'ABCD' }]))
    const sheet = await newEvent()
    const group = within(sheet).getByRole('radiogroup', { name: 'Theme' })
    // The switch answers after the sheet opens.
    expect(await within(sheet).findByRole('link', { name: /Training › Drills/ })).toHaveTextContent('Browse all drills in Training › Drills')
    const link = () => within(sheet).getByRole('link', { name: /Training › Drills/ })
    expect(within(group).queryByText('82 sessions · 4 topics')).toBeNull()
    expect(within(sheet).queryByRole('link', { name: /Catalogue/ })).toBeNull()
    expect(link()).toHaveAttribute('href', '/coach/training/drills')
    expect(link()).toHaveAttribute('target', '_blank')
    await userEvent.click(within(group).getByRole('radio', { name: /^Goalkeeping/ }))
    expect(link()).toHaveTextContent('Find Goalkeeping drills in Training › Drills')
    expect(link()).toHaveAttribute('href', '/coach/training/drills/all?show=Goalkeeping')
    await userEvent.click(within(group).getByRole('radio', { name: /^Defending/ }))
    expect(link()).toHaveAttribute('href', '/coach/training/drills/all?q=defend')
    await userEvent.click(within(group).getByRole('radio', { name: /^Psychological/ }))
    expect(link()).toHaveAttribute('href', '/coach/training/drills')
  })

  it('a match or other event has no theme', async () => {
    const sheet = await newEvent()
    await userEvent.click(within(sheet).getByRole('button', { name: 'Match' }))
    expect(within(sheet).queryByRole('radiogroup', { name: 'Theme' })).toBeNull()
    await userEvent.click(within(sheet).getByRole('button', { name: 'Other' }))
    expect(within(sheet).queryByRole('radiogroup', { name: 'Theme' })).toBeNull()
  })

  it('saves the picked theme and shows it on Review', async () => {
    const sheet = await newEvent()
    await userEvent.click(within(sheet).getByRole('radio', { name: /^Transition/ }))
    await eventStep(sheet, 'When')
    await pickTime(userEvent, 'Start', '23:00')
    await eventStep(sheet, 'Review')
    expect(within(sheet).getByText('Theme').nextElementSibling).toHaveTextContent('Transition')
    await saveEventWith(sheet, 'Save draft')
    expect(posts).toHaveLength(1)
    expect(posts[0]).toEqual([expect.objectContaining({ event_type: 'training', training_theme: 'transition' })])
  })

  it('an edit opens with the saved theme picked', async () => {
    renderApp('/coach/schedule?edit=ev-1')
    const sheet = await screen.findByRole('dialog', { name: 'Edit event' })
    expect(within(sheet).getByRole('radio', { name: /^Goalkeeping/ })).toBeChecked()
  })
})
