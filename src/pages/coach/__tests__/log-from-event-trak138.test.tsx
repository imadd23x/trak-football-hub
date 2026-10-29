import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { renderApp } from '../../../../tests/support/render-app'
import { logStep, saveLog } from '../../../../tests/support/log-steps'
import { signInAs } from '../../../../tests/support/session'
import { server } from '../../../../tests/msw/server'
import { table, rpc, SUPABASE_URL } from '../../../../tests/msw/supabase'

/**
 * TRAK-138 (J8.15), live run 3 (16 Oct): "Log match" on a published match
 * saved a second session with no event_id, so the week showed two pills for one
 * game and Log match stayed on offer. Decided (Imad, 16 Oct): a past event and
 * its log are one item, and everyone counts as there except those the coach
 * taps (or whose family said "Can't make it"). Driven through the rendered app,
 * clock pinned to 18:00 in Dubai.
 */

const COACH = { id: 'coach-1' }
const DAY = '2026-10-14'
const NOW = new Date('2026-10-14T14:00:00Z')

const MATCH = {
  id: 'match-1', coach_user_id: COACH.id, title: 'vs Synthetic Rovers', event_type: 'match',
  starts_at: '2026-10-14T11:00:00Z', ends_at: null, event_date: DAY, start_time: '15:00:00',
  venue: 'Academy Pitch 2', opponent: 'Synthetic Rovers', notes: null, published: true, source: 'manual',
  meet_time: null, kit: null, home_away: 'home', status: 'scheduled', cancel_reason: null, series_id: null,
}

const SQUAD = [
  { id: 'sp-1', player_name: 'Ade Okafor', linked_player_id: 'u-1', position: 'Attacker', age_group: 'U16', age: 15 },
  { id: 'sp-2', player_name: 'Bea Lin', linked_player_id: 'u-2', position: 'Defender', age_group: 'U16', age: 15 },
  { id: 'sp-3', player_name: 'Cal Moss', linked_player_id: 'u-3', position: 'Midfielder', age_group: 'U16', age: 15 },
]

let sessions: Record<string, unknown>[]
let inserted: Record<string, unknown>[]
let insertReply: () => Response
let logged: Record<string, unknown>[]

function fixtures() {
  sessions = []
  inserted = []
  logged = []
  insertReply = () => HttpResponse.json({ id: 'session-1', ...inserted[inserted.length - 1] }, { status: 201 })
  server.use(
    table('profiles', [{ id: 'p', user_id: COACH.id, role: 'coach', full_name: 'Coach', invite_code: 'ABCD' }]),
    table('coach_calendar_events', [MATCH]),
    http.get(`${SUPABASE_URL}/rest/v1/coach_sessions`, () => HttpResponse.json(sessions)),
    http.post(`${SUPABASE_URL}/rest/v1/coach_sessions`, async ({ request }) => {
      const raw = await request.json()
      inserted.push((Array.isArray(raw) ? raw[0] : raw) as Record<string, unknown>)
      return insertReply()
    }),
    http.post(`${SUPABASE_URL}/rest/v1/session_attendance`, () => HttpResponse.json(null, { status: 201 })),
    table('session_attendance', []),
    table('squad_players', SQUAD),
    // Bea's family said "Can't make it".
    table('event_absences', [{ squad_player_id: 'sp-2', reason: 'Ill' }]),
    // TRAK-288: Games off, so a match is still logged as today.
    rpc('feature_on', ({ p_feature }) => p_feature !== 'games'),
    rpc('coach_squad_player_consent_required', () => false),
    rpc('coach_match_score_clash', () => []),
    rpc('log_match_for_player', args => { logged.push(args); return null }),
  )
}

const toastText = () => [...document.querySelectorAll('[data-sonner-toast]')].map(t => t.textContent ?? '').join(' | ')

/** Schedule → Log match on the event → the match's score → its Squad step. */
async function logFromEvent(user: ReturnType<typeof userEvent.setup>) {
  renderApp('/coach/schedule')
  await user.click(await screen.findByRole('button', { name: 'Log match for vs Synthetic Rovers' }))
  await waitFor(() => expect(screen.getByPlaceholderText('Opponent name')).toHaveValue('Synthetic Rovers'))
  const [us, them] = screen.getAllByPlaceholderText('0')
  await user.type(us, '1')
  await user.type(them, '0')
  await logStep('Squad')
}

/** No goals or assists for each player already marked played (the quick log asks no minutes, TRAK-198). */
async function completePlayed(user: ReturnType<typeof userEvent.setup>, names: string[]) {
  for (const name of names) {
    await user.click(screen.getByRole('button', { name: `One fewer goals for ${name}` }))
    await user.click(screen.getByRole('button', { name: `One fewer assists for ${name}` }))
  }
}

describe('TRAK-138: a match logged from its event is that event', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    signInAs(COACH)
  })
  afterEach(() => vi.useRealTimers())

  it('opens with everyone marked played except a "Can\'t make it"', async () => {
    fixtures()
    const user = userEvent.setup()
    await logFromEvent(user)
    await waitFor(() => expect(screen.getByText(/SQUAD · 2 played/)).toBeInTheDocument())
    expect(screen.getAllByRole('button', { name: 'Remove' })).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: 'Mark played' })).toHaveLength(1)
  }, 30_000)

  // #334 review: a failed "Can't make it" read must not guess who played. It
  // pre-marks nobody, so the coach marks each player who did.
  it('pre-marks nobody as played when the "Can\'t make it" read fails', async () => {
    fixtures()
    server.use(http.get(`${SUPABASE_URL}/rest/v1/event_absences`, () =>
      HttpResponse.json({ message: 'Synthetic failure' }, { status: 500 })))
    const user = userEvent.setup()
    await logFromEvent(user)
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Mark played' })).toHaveLength(3))
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull()
  }, 30_000)

  it('saves one session that carries the event id', async () => {
    fixtures()
    const user = userEvent.setup()
    await logFromEvent(user)
    await waitFor(() => expect(screen.getByText(/SQUAD · 2 played/)).toBeInTheDocument())
    // The rows open so their facts can be typed; J4 still invents none.
    for (const name of ['Ade Okafor', 'Cal Moss']) {
      await user.click(screen.getByRole('button', { name: `Details for ${name}` }))
    }
    await completePlayed(user, ['Ade Okafor', 'Cal Moss'])
    await saveLog('Save match')
    await waitFor(() => expect(logged).toHaveLength(2))
    expect(inserted).toHaveLength(1)
    expect(inserted[0].event_id).toBe('match-1')
  }, 30_000)

  it('a second log of the same event is refused by name, and no player is logged twice', async () => {
    fixtures()
    insertReply = () => HttpResponse.json(
      { code: '23505', message: 'duplicate key value violates unique constraint "coach_sessions_one_per_event"' },
      { status: 409 })
    const user = userEvent.setup()
    await logFromEvent(user)
    await waitFor(() => expect(screen.getByText(/SQUAD · 2 played/)).toBeInTheDocument())
    for (const name of ['Ade Okafor', 'Cal Moss']) await user.click(screen.getByRole('button', { name: `Details for ${name}` }))
    await completePlayed(user, ['Ade Okafor', 'Cal Moss'])
    await saveLog('Save match')
    await waitFor(() => expect(toastText()).toContain('This match is already logged'))
    expect(logged).toHaveLength(0)
  }, 30_000)

  it('once logged, the event offers no second Log match and says it is logged', async () => {
    fixtures()
    sessions = [{ id: 'session-1', title: 'vs Synthetic Rovers', session_type: 'match', session_date: DAY,
      competition: 'League', venue: 'Home', notes: '1-0', event_id: 'match-1' }]
    renderApp('/coach/schedule')
    expect(await screen.findByText('Match logged')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Log match for vs Synthetic Rovers' })).toBeNull()
  }, 20_000)
})

describe('TRAK-138: a logged training starts with everyone present', () => {
  beforeEach(() => signInAs(COACH))

  it('Log training opens Attendance with the whole ready squad ticked', async () => {
    fixtures()
    const user = userEvent.setup()
    renderApp('/coach/sessions/add')
    await user.click(await screen.findByRole('button', { name: /^Technical/ }))
    await logStep('Attendance')
    expect(await screen.findByText('ATTENDED · 3/3')).toBeInTheDocument()
  }, 20_000)
})

// TRAK-235 (20 Oct live run): logging a planned match left its opponent
// editable, so the log could name a different team from the event it belongs to.
describe('TRAK-235: a match logged from its event keeps the event\'s opponent', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    signInAs(COACH)
  })
  afterEach(() => vi.useRealTimers())

  it('shows the opponent read-only and saves the event\'s name', async () => {
    fixtures()
    const user = userEvent.setup()
    renderApp('/coach/schedule')
    await user.click(await screen.findByRole('button', { name: 'Log match for vs Synthetic Rovers' }))
    const opponent = await screen.findByRole('textbox', { name: 'Opponent' })
    await waitFor(() => expect(opponent).toHaveValue('Synthetic Rovers'))
    expect(opponent).toHaveAttribute('readonly')
    await user.type(opponent, ' Reserves')
    expect(opponent).toHaveValue('Synthetic Rovers')
    expect(screen.getByText(/from the planned match/i)).toBeInTheDocument()

    const [us, them] = screen.getAllByPlaceholderText('0')
    await user.type(us, '1')
    await user.type(them, '0')
    await logStep('Squad')
    await waitFor(() => expect(screen.getByText(/SQUAD · 2 played/)).toBeInTheDocument())
    for (const name of ['Ade Okafor', 'Cal Moss']) await user.click(screen.getByRole('button', { name: `Details for ${name}` }))
    await completePlayed(user, ['Ade Okafor', 'Cal Moss'])
    await saveLog('Save match')
    await waitFor(() => expect(logged).toHaveLength(2))
    expect(inserted[0]).toMatchObject({ event_id: 'match-1', title: 'vs Synthetic Rovers' })
    expect(logged.map(call => call.p_opponent)).toEqual(['Synthetic Rovers', 'Synthetic Rovers'])
  }, 30_000)

  it('a match logged without an event still takes a typed opponent', async () => {
    fixtures()
    const user = userEvent.setup()
    renderApp('/coach/sessions/add')
    await user.click(await screen.findByRole('button', { name: 'Match' }))
    const opponent = await screen.findByRole('textbox', { name: 'Opponent' })
    expect(opponent).not.toHaveAttribute('readonly')
    await user.type(opponent, 'Olympiakos U14')
    expect(opponent).toHaveValue('Olympiakos U14')
  }, 30_000)
})
