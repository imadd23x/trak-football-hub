/**
 * TRAK-183 (Imad, 15 Oct): a player who consents for themselves (at or above
 * their academy's consent age) says "Can't make it" on their own event page,
 * as a guardian does. Younger players don't see it: their guardian reports.
 * The database decides (absence_target); the page shows its answer.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { renderApp } from '../../../../tests/support/render-app'
import { signInAs } from '../../../../tests/support/session'
import { server } from '../../../../tests/msw/server'
import { table, rpc, rpcRows, SUPABASE_URL } from '../../../../tests/msw/supabase'

// One player per test: the app's query cache is shared, keyed by user.
let PLAYER = { id: 'player-own-absence' }
// Far enough ahead that the page never treats it as past.
const EVENT = {
  id: 'ev-1', coach_user_id: 'coach-1', published: true, event_type: 'training', title: 'Training',
  event_date: '2099-11-14', start_time: '10:00:00', starts_at: '2099-11-14T06:00:00Z',
  venue: 'Main pitch', opponent: null, meet_time: null, kit: null, home_away: null,
  status: 'scheduled', cancel_reason: null, sequence: 0,
}
// The Home test pins the clock to a Wednesday midday, and builds "today" from
// that same clock, as the week strip does (Kostas, #320; the #306 pattern):
// a date taken from Dubai while the strip used the runner's clock failed
// every evening from 20:00 UTC.
const NOW = new Date(2026, 9, 14, 12, 0)
const today = `${NOW.getFullYear()}-${String(NOW.getMonth() + 1).padStart(2, '0')}-${String(NOW.getDate()).padStart(2, '0')}`
const TODAY_EVENT = { ...EVENT, id: 'ev-today', title: 'Finishing', event_date: today, start_time: '18:00:00', starts_at: new Date(2026, 9, 14, 18, 0).toISOString() }
let reported: Record<string, unknown>[]
let absent: boolean
let statusAsked: boolean

function setup(age: number, consentAge: number) {
  reported = []
  absent = false
  statusAsked = false
  server.use(
    table('profiles', [{ id: 'p', user_id: PLAYER.id, role: 'player', full_name: 'Synthetic Player' }]),
    table('player_details', []),
    // Home's other reads, answered empty.
    table('matches', []), table('coach_assessments', []), table('recognition_awards', []),
    rpc('get_player_invites_for_current_user', () => []),
    rpc('family_training_history', () => []),
    rpcRows('child_events', [EVENT]),
    rpc('my_consent_status', () => {
      statusAsked = true
      return { required: false, age, consent_age: consentAge, threshold: 18, own_choice: true }
    }),
    http.get(`${SUPABASE_URL}/rest/v1/squad_players`, () => HttpResponse.json([{ id: 'squad-1' }])),
    // TRAK-436: Home's bell reads his game plans and reviews.
    http.get(`${SUPABASE_URL}/rest/v1/game_for_family`, () => HttpResponse.json([])),
    http.get(`${SUPABASE_URL}/rest/v1/game_for_player`, () => HttpResponse.json([])),
    http.get(`${SUPABASE_URL}/rest/v1/game_review_for_family`, () => HttpResponse.json([])),
    http.get(`${SUPABASE_URL}/rest/v1/event_absences`, () => HttpResponse.json(absent ? [{ reason: 'school' }] : [])),
    http.post(`${SUPABASE_URL}/rest/v1/rpc/report_cant_make_it`, async ({ request }) => {
      reported.push(await request.json() as Record<string, unknown>)
      absent = true
      return new HttpResponse(null, { status: 204 })
    }),
  )
}

let n = 0
beforeEach(() => { PLAYER = { id: `player-own-absence-${++n}` }; signInAs(PLAYER) })
afterEach(() => { vi.useRealTimers() })

describe('TRAK-183: a player who consents for themselves says Can\'t make it', () => {
  it('a 16-year-old at a consent-age-15 academy reports for themselves', async () => {
    setup(16, 15)
    const user = userEvent.setup()
    renderApp('/player/event/ev-1')
    const attendance = await screen.findByRole('region', { name: 'Attendance' })
    expect(await within(attendance).findByText("Everyone counts as coming. Only say if you can't.")).toBeInTheDocument()
    await user.click(within(attendance).getByRole('button', { name: "Can't make it" }))
    await user.click(within(attendance).getByRole('radio', { name: 'School' }))
    await user.click(within(attendance).getByRole('button', { name: 'Tell the coach' }))
    await waitFor(() => expect(reported).toEqual([{ p_event_id: 'ev-1', p_child: PLAYER.id, p_reason: 'school' }]))
    expect(await within(attendance).findByText("You told the coach you can't make it.")).toBeInTheDocument()
  })

  it('a 14-year-old there sees no button: their guardian reports', async () => {
    setup(14, 15)
    renderApp('/player/event/ev-1')
    expect(await screen.findByText('Main pitch', { exact: false })).toBeInTheDocument()
    // The page has its answer before we look for the button.
    await waitFor(() => expect(statusAsked).toBe(true))
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(screen.queryByRole('region', { name: 'Attendance' })).toBeNull()
    expect(screen.queryByRole('button', { name: "Can't make it" })).toBeNull()
  })

  // TRAK-183 follow-up: the same button in the Home event sheet (#310).
  it('the Home event sheet offers it too, for themselves', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    setup(16, 15)
    // The mock ignores the page's id filter, so Home gets its own list.
    server.use(rpcRows('child_events', [TODAY_EVENT]))
    const user = userEvent.setup()
    renderApp('/player/home')
    await user.click(await screen.findByRole('button', { name: /Finishing/ }, { timeout: 5000 }))
    const sheet = await screen.findByRole('dialog', { name: 'Finishing' })
    const attendance = await within(sheet).findByRole('region', { name: 'Attendance' })
    expect(await within(attendance).findByText("Everyone counts as coming. Only say if you can't.")).toBeInTheDocument()
  })
})
