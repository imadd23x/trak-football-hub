import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { renderApp } from '../../../../tests/support/render-app'
import { signInAs } from '../../../../tests/support/session'
import { server } from '../../../../tests/msw/server'
import { table, rpc, SUPABASE_URL } from '../../../../tests/msw/supabase'
import { dateHeld } from '../../../../tests/support/arc-pickers'

/**
 * TRAK-138 (J8.15), part 2: after the event, the coach takes the register
 * from the schedule and it becomes the completed session. It opens pre-filled
 * from J8.14's "can't make it": everyone present except those, and never a
 * child who can't be recorded (Coach OS ticked a player who had declined).
 * The coach taps to fix it; Save calls take_event_register(), which repeats
 * every rule. A match opens the J4 match log with its date and opponent.
 * Driven through the rendered app, with the clock pinned to 18:00 in Dubai.
 */

const COACH = { id: 'coach-1' }
const DAY = '2026-10-14'
const NOW = new Date('2026-10-14T14:00:00Z') // 18:00 in Dubai

const row = (over: Record<string, unknown>) => ({
  coach_user_id: COACH.id, event_type: 'training', starts_at: '2026-10-14T13:00:00Z', ends_at: null,
  event_date: DAY, start_time: '17:00:00', venue: 'Academy Pitch 2', opponent: null, notes: null,
  published: true, source: 'manual', meet_time: null, kit: null, home_away: null, status: 'scheduled',
  cancel_reason: null, series_id: null, ...over,
})
const PAST = row({ id: 'past-1', title: 'Finishing' })
const LATER = row({ id: 'later-1', title: 'Evening session', starts_at: '2026-10-14T15:00:00Z', start_time: '19:00:00' })
const DRAFT = row({ id: 'draft-1', title: 'Draft drill', published: false, start_time: '16:00:00' })
const OFF = row({ id: 'off-1', title: 'Rained off', status: 'cancelled', start_time: '15:00:00' })
const MATCH = row({
  id: 'match-1', title: 'vs Synthetic Rovers', event_type: 'match', opponent: 'Synthetic Rovers', home_away: 'away',
  start_time: '15:00:00', starts_at: '2026-10-14T11:00:00Z',
})

const SQUAD = [
  { id: 'sp-1', player_name: 'Ade Okafor', status: 'active' },
  { id: 'sp-2', player_name: 'Bea Lin', status: 'active' },
  { id: 'sp-3', player_name: 'Cal Moss', status: 'active' },
  { id: 'sp-4', player_name: 'Dan Roe', status: 'active' },
  { id: 'sp-5', player_name: 'Eli Fox', status: 'active' },
  { id: 'sp-6', player_name: 'Wes Wait', status: 'active' }, // consent not given yet
]

let saved: Record<string, unknown>[]
let registerReply: () => unknown
let sessions: Record<string, unknown>[]
let attendance: Record<string, unknown>[]

function fixtures() {
  saved = []
  registerReply = () => 'session-1'
  server.use(
    table('profiles', [{ id: 'p', user_id: COACH.id, role: 'coach', full_name: 'Coach', invite_code: 'ABCD' }]),
    table('coach_calendar_events', [PAST, LATER, DRAFT, OFF, MATCH]),
    http.get(`${SUPABASE_URL}/rest/v1/coach_sessions`, () => HttpResponse.json(sessions)),
    http.get(`${SUPABASE_URL}/rest/v1/session_attendance`, () => HttpResponse.json(attendance)),
    table('squad_players', SQUAD),
    table('event_absences', [{ squad_player_id: 'sp-2', reason: 'Ill' }, { squad_player_id: 'sp-4', reason: null }]),
    // TRAK-288: Games off, so a match is still logged as today.
    rpc('feature_on', ({ p_feature }) => p_feature !== 'games'),
    rpc('coach_squad_player_consent_required', args => args.p_squad_player_id === 'sp-6'),
    rpc('take_event_register', args => { saved.push(args); return registerReply() }),
  )
}

const toastText = () => [...document.querySelectorAll('[data-sonner-toast]')].map(t => t.textContent ?? '').join(' | ')
const mark = (name: string) => screen.getByRole('button', { name: new RegExp(`^${name}:`) })

async function openRegister(user: ReturnType<typeof userEvent.setup>, title = 'Finishing') {
  renderApp('/coach/schedule')
  await user.click(await screen.findByRole('button', { name: `Take register for ${title}` }))
  return screen.findByRole('dialog', { name: 'Take register' })
}

describe('J8.15: the coach takes the register from the schedule', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    sessions = []
    attendance = []
    signInAs(COACH)
  })
  afterEach(() => vi.useRealTimers())

  it('only an event that went ahead and has started offers a register; never a draft, a cancelled or a later one', async () => {
    fixtures()
    renderApp('/coach/schedule')
    expect(await screen.findByRole('button', { name: 'Take register for Finishing' })).toBeInTheDocument()
    for (const title of ['Evening session', 'Draft drill', 'Rained off', 'vs Synthetic Rovers']) {
      expect(screen.queryByRole('button', { name: `Take register for ${title}` })).toBeNull()
    }
  }, 20_000)

  it('a training with 2 "can\'t make it": those 2 absent, the rest present; 3 taps fix it and Save sends exactly that list', async () => {
    fixtures()
    const user = userEvent.setup()
    const sheet = await openRegister(user)
    await waitFor(() => expect(mark('Ade Okafor')).toHaveAttribute('aria-pressed', 'true'))
    expect(mark('Bea Lin')).toHaveAttribute('aria-pressed', 'false')
    expect(mark('Dan Roe')).toHaveAttribute('aria-pressed', 'false')
    for (const name of ['Cal Moss', 'Eli Fox']) expect(mark(name)).toHaveAttribute('aria-pressed', 'true')
    // The family's word is shown, with its reason when there is one.
    expect(within(sheet).getByText("Can't make it · Ill")).toBeInTheDocument()
    // Never tickable: no button, and the reason is said.
    expect(screen.queryByRole('button', { name: /^Wes Wait:/ })).toBeNull()
    expect(within(sheet).getByText(/Not recorded until a parent approves: Wes Wait/)).toBeInTheDocument()
    expect(within(sheet).getByText('3 present, 2 absent')).toBeInTheDocument()

    // Bea came after all; Cal and Eli didn't.
    await user.click(mark('Bea Lin'))
    await user.click(mark('Cal Moss'))
    await user.click(mark('Eli Fox'))
    expect(within(sheet).getByText('2 present, 3 absent')).toBeInTheDocument()
    await user.click(within(sheet).getByRole('button', { name: 'Save register' }))

    await waitFor(() => expect(saved).toHaveLength(1))
    expect(saved[0].p_event_id).toBe('past-1')
    expect([...(saved[0].p_present as string[])].sort()).toEqual(['sp-1', 'sp-2'])
    await waitFor(() => expect(toastText()).toMatch(/Register saved: 2 present/))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Take register' })).toBeNull())
  }, 20_000)

  it("a child whose consent couldn't be checked is never offered or pre-ticked", async () => {
    // The PR's own rule (Coach OS ticked a player who had declined): a failed
    // check counts as not confirmed, so that child can't be marked present.
    fixtures()
    server.use(http.post(`${SUPABASE_URL}/rest/v1/rpc/coach_squad_player_consent_required`, async ({ request }) => {
      const { p_squad_player_id } = await request.json() as { p_squad_player_id: string }
      if (p_squad_player_id === 'sp-3') return HttpResponse.json({ message: 'Synthetic failure' }, { status: 500 })
      return HttpResponse.json(p_squad_player_id === 'sp-6')
    }))
    const user = userEvent.setup()
    const sheet = await openRegister(user)
    expect(await within(sheet).findByText(/Cal Moss/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Cal Moss:/ })).toBeNull()
    await user.click(within(sheet).getByRole('button', { name: 'Save register' }))
    await waitFor(() => expect(saved).toHaveLength(1))
    expect(saved[0].p_present).not.toContain('sp-3')
  }, 20_000)

  it('a register already taken reopens as it was saved, not from the absences, and the session isn\'t listed twice', async () => {
    fixtures()
    sessions = [{ id: 'session-1', title: 'Finishing', session_type: 'training', session_date: DAY, event_id: 'past-1' }]
    attendance = [{ squad_player_id: 'sp-4', status: 'present' }, { squad_player_id: 'sp-5', status: 'present' }]
    const user = userEvent.setup()
    renderApp('/coach/schedule')
    // One entry for the event, marked as taken; the linked session isn't a second "Logged" one.
    await user.click(await screen.findByRole('button', { name: 'Edit register for Finishing' }))
    expect(screen.getAllByText('Finishing')).toHaveLength(1)
    expect(screen.queryByText('Logged')).toBeNull()
    await screen.findByRole('dialog', { name: 'Take register' })
    await waitFor(() => expect(mark('Dan Roe')).toHaveAttribute('aria-pressed', 'true'))
    expect(mark('Eli Fox')).toHaveAttribute('aria-pressed', 'true')
    for (const name of ['Ade Okafor', 'Bea Lin', 'Cal Moss']) expect(mark(name)).toHaveAttribute('aria-pressed', 'false')
  }, 20_000)

  it('a refusal says why, by name, and keeps the ticks; a lost connection says to save again', async () => {
    fixtures()
    registerReply = () => ({ status: 400, body: { code: 'P0001', message: 'Waiting for parent: nothing is recorded about player sp-3 until a parent approves' } })
    const user = userEvent.setup()
    const sheet = await openRegister(user)
    await waitFor(() => expect(mark('Ade Okafor')).toHaveAttribute('aria-pressed', 'true'))
    await user.click(within(sheet).getByRole('button', { name: 'Save register' }))
    expect(await within(sheet).findByRole('alert')).toHaveTextContent('Waiting for parent: nothing is recorded about Cal Moss until a parent approves')
    expect(mark('Cal Moss')).toHaveAttribute('aria-pressed', 'true')

    registerReply = () => ({ status: 503, body: { message: 'upstream timeout' } })
    await user.click(within(sheet).getByRole('button', { name: 'Save register' }))
    await waitFor(() => expect(within(sheet).getByRole('alert')).toHaveTextContent("Couldn't save the register. Check your connection and save again; your ticks are still here."))
  }, 20_000)

  it('a squad or absences that fail to load offer a retry, never a guessed register', async () => {
    fixtures()
    server.use(http.get(`${SUPABASE_URL}/rest/v1/event_absences`, () => HttpResponse.json({ message: 'boom' }, { status: 500 })))
    const user = userEvent.setup()
    const sheet = await openRegister(user)
    expect(await within(sheet).findByText(/Couldn't load the register/)).toBeInTheDocument()
    expect(within(sheet).queryByRole('button', { name: 'Save register' })).toBeNull()
    server.use(table('event_absences', []))
    await user.click(within(sheet).getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(mark('Bea Lin')).toHaveAttribute('aria-pressed', 'true'))
  }, 20_000)

  it('a match that has kicked off opens the match log with its date, opponent and away', async () => {
    fixtures()
    const user = userEvent.setup()
    renderApp('/coach/schedule')
    await user.click(await screen.findByRole('button', { name: 'Log match for vs Synthetic Rovers' }))
    const opponent = await screen.findByPlaceholderText('Opponent name')
    // The screen fills it in just after it first draws.
    await waitFor(() => expect(opponent).toHaveValue('Synthetic Rovers'))
    expect(await dateHeld(user, 'Session date')).toBe(DAY)
    expect(screen.getByRole('button', { name: 'Away' })).toHaveAttribute('aria-pressed', 'true')
  }, 20_000)
})
