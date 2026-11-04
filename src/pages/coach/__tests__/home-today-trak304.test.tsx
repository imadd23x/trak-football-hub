/**
 * TRAK-304 (Kostas, 28 Oct): when the coach opens Trak on a training or match day, Home shows that day's plan in
 * Squad shape's place, as a quick snapshot: a training's practices and how long each runs, a match's
 * formation and goals. The week above already says the time and place, so the card doesn't. With nothing today, the
 * next one coming up. Only where Training or Games is switched on (without them Home keeps Squad shape, as
 * coach-home-trak197 checks). Test people are named after footballers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { renderApp } from '../../../../tests/support/render-app'
import { signInAs } from '../../../../tests/support/session'
import { server } from '../../../../tests/msw/server'
import { table, rpc, SUPABASE_URL } from '../../../../tests/msw/supabase'
import { forgetScreens } from '@/lib/screen-memory'

// Midday on a Wednesday; today's events are later in the day.
const NOW = new Date('2026-11-04T12:00:00Z')
// Times are UTC, whatever the machine's time zone.
const at = (iso: string) => new Date(`${iso}:00Z`)
let n = 0
let COACH = { id: 'coach-304' }

function event(id: string, type: 'training' | 'match', starts: string, over: Record<string, unknown> = {}) {
  const start = at(starts)
  return {
    id, coach_user_id: COACH.id, squad: 'U16', title: `Training ${id}`, event_type: type, published: true, status: 'scheduled',
    starts_at: start.toISOString(), ends_at: new Date(start.getTime() + 90 * 60_000).toISOString(),
    event_date: starts.slice(0, 10), start_time: `${starts.slice(11, 16)}:00`, venue: 'Pitch 2', opponent: null, home_away: null, ...over,
  }
}
const practice = (event_id: string, position: number, name: string, minutes: number, part = '') => ({
  event_id, position, name, minutes, how: '', tell: '', area: '', numbers: '', direction: '', targets: '', conditions: '',
  source: 'own', drill_id: null, library_session: null, part,
})

function home({ events, practices = [], gamePlans = [], features = ['events', 'training', 'games'] }: {
  events: Record<string, unknown>[]; practices?: Record<string, unknown>[]; gamePlans?: Record<string, unknown>[]; features?: string[]
}) {
  server.use(
    table('profiles', [{ id: 'p', user_id: COACH.id, role: 'coach', full_name: 'Jürgen Klopp', invite_code: 'ABCD' }]),
    table('coach_details', [{ user_id: COACH.id, coach_role: 'Head Coach', team: 'U16', organization_id: 'org-1' }]),
    table('organizations', [{ id: 'org-1', name: 'Rehearsal FC' }]),
    table('squad_players', [{ id: 'sp-1', coach_user_id: COACH.id, player_name: 'Mohamed Salah', age_group: 'U16', status: 'active', created_at: '2026-10-01T08:00:00Z' }]),
    table('coach_assessments', []),
    table('coach_sessions', []),
    table('session_attendance', []),
    table('event_absences', []),
    table('notification_settings', []),
    table('game_shares', []),
    rpc('game_plan_changes', () => []),
    rpc('coach_squad_player_consent_required', () => false),
    rpc('feature_on', ({ p_feature }) => features.includes(String(p_feature))),
    table('training_notes', []),
    http.get(`${SUPABASE_URL}/rest/v1/coach_calendar_events`, ({ request }) => {
      const type = new URL(request.url).searchParams.get('event_type')?.replace(/^eq\./, '')
      return HttpResponse.json(type ? events.filter(e => e.event_type === type) : events)
    }),
    http.get(`${SUPABASE_URL}/rest/v1/training_plans`, () =>
      HttpResponse.json([...new Set(practices.map(p => p.event_id))].map(event_id => ({ event_id, updated_at: '2026-11-01T10:00:00Z' })))),
    table('training_plan_practices', practices),
    http.get(`${SUPABASE_URL}/rest/v1/game_plans`, ({ request }) => {
      const id = new URL(request.url).searchParams.get('event_id')?.replace(/^eq\./, '')
      return HttpResponse.json(id ? gamePlans.filter(p => p.event_id === id) : gamePlans)
    }),
  )
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  COACH = { id: `coach-304-${++n}` }
  signInAs(COACH)
})
afterEach(() => { vi.useRealTimers(); cleanup(); forgetScreens(); localStorage.clear() })

const today = () => screen.findByRole('region', { name: 'Today' }, { timeout: 5000 })

describe('TRAK-304: today’s plan on coach Home', { timeout: 20_000 }, () => {
  it('a planned training today is a quick snapshot: each practice and how long it runs, in Squad shape’s place', async () => {
    home({
      events: [event('t1', 'training', '2026-11-04T16:00', { title: 'Pressing zones' })],
      practices: [practice('t1', 1, 'Rondos 4v1', 15), practice('t1', 2, 'Pressing on the trigger', 25)],
    })
    renderApp('/coach/home')
    const card = await today()
    const training = await within(card).findByRole('article', { name: 'Training, Pressing zones' })
    const list = await within(training).findByRole('list', { name: 'Today’s practices' })
    const rows = within(list).getAllByRole('listitem')
    expect(rows.map(row => row.textContent)).toEqual(['Rondos 4v115 min', 'Pressing on the trigger25 min'])
    expect(within(training).getByText('Training plan')).toBeInTheDocument()
    // Kostas, 29 Oct: no Run it; the training's total time sits where it was, on the right.
    expect(within(training).getByText('40 min')).toBeInTheDocument()
    expect(within(training).queryByRole('link')).toBeNull()
    // Kostas, 28 Oct: the week above already says the time, the place and the title; the card doesn't repeat them.
    expect(within(training).queryByText(/Pitch 2/)).toBeNull()
    expect(within(training).queryByText(/16:/)).toBeNull()
    expect(within(training).queryByText(/Pressing zones/)).toBeNull()
    expect(within(card).queryByText('Your plan for today')).toBeNull()
    expect(screen.queryByRole('region', { name: 'Squad shape' })).toBeNull()
  })

  it('every practice in the plan shows, however many', async () => {
    const names = ['Rondos 4v1', 'Passing square', 'Pressing on the trigger', '3v2 to goal', 'Finishing', 'Game: 8v8']
    home({ events: [event('t1', 'training', '2026-11-04T16:00')], practices: names.map((name, i) => practice('t1', i + 1, name, 10)) })
    renderApp('/coach/home')
    const list = await within(await today()).findByRole('list', { name: 'Today’s practices' })
    expect(within(list).getAllByRole('listitem').map(row => row.textContent)).toEqual(names.map(name => `${name}10 min`))
  })

  it('with two trainings today, each is just its plan, never its name: the week above has it (Kostas, 29 Oct)', async () => {
    home({
      events: [event('t1', 'training', '2026-11-04T10:00', { title: 'Pressing zones' }), event('t2', 'training', '2026-11-04T18:00', { title: 'Finishing' })],
      practices: [practice('t1', 1, 'Rondos 4v1', 15)],
    })
    renderApp('/coach/home')
    const card = await today()
    const pressing = await within(card).findByRole('article', { name: 'Training, Pressing zones' })
    const finishing = within(card).getByRole('article', { name: 'Training, Finishing' })
    // Its total, on the right, and its one practice's minutes.
    await waitFor(() => expect(within(pressing).getAllByText('15 min')).toHaveLength(2))
    for (const training of [pressing, finishing]) expect(within(training).getByText('Training plan')).toBeInTheDocument()
    expect(within(card).queryByText(/Pressing zones|Finishing/)).toBeNull()
  })

  it('with All picked, a coach of two age groups sees which one each plan is for (Kostas, 29 Oct)', async () => {
    home({
      events: [event('t1', 'training', '2026-11-04T10:00', { title: 'Pressing zones' }), event('t2', 'training', '2026-11-04T18:00', { title: 'Finishing', squad: 'U14' })],
      practices: [practice('t1', 1, 'Rondos 4v1', 15)],
    })
    server.use(table('squad_players', [
      { id: 'sp-1', coach_user_id: COACH.id, player_name: 'Mohamed Salah', age_group: 'U16', status: 'active', created_at: '2026-10-01T08:00:00Z' },
      { id: 'sp-2', coach_user_id: COACH.id, player_name: 'Trent Alexander-Arnold', age_group: 'U14', status: 'active', created_at: '2026-10-01T08:00:00Z' },
    ]))
    renderApp('/coach/home')
    const card = await today()
    const u16 = await within(card).findByRole('article', { name: 'Training, Pressing zones' })
    const u14 = within(card).getByRole('article', { name: 'Training, Finishing' })
    await waitFor(() => expect(within(u16).getByText('Training plan · U16')).toBeInTheDocument())
    expect(within(u14).getByText('Training plan · U14')).toBeInTheDocument()
  })

  it('with one age group picked, the plans need no age group: the switcher says it', async () => {
    localStorage.setItem(`trak:coach-squad-all:${COACH.id}`, '0')
    localStorage.setItem(`trak:coach-squad:${COACH.id}`, 'U16')
    home({
      events: [event('t1', 'training', '2026-11-04T10:00', { title: 'Pressing zones' }), event('t2', 'training', '2026-11-04T18:00', { title: 'Finishing', squad: 'U14' })],
      practices: [practice('t1', 1, 'Rondos 4v1', 15)],
    })
    server.use(table('squad_players', [
      { id: 'sp-1', coach_user_id: COACH.id, player_name: 'Mohamed Salah', age_group: 'U16', status: 'active', created_at: '2026-10-01T08:00:00Z' },
      { id: 'sp-2', coach_user_id: COACH.id, player_name: 'Trent Alexander-Arnold', age_group: 'U14', status: 'active', created_at: '2026-10-01T08:00:00Z' },
    ]))
    renderApp('/coach/home')
    const card = await today()
    const u16 = await within(card).findByRole('article', { name: 'Training, Pressing zones' })
    await waitFor(() => expect(within(u16).getByText('Training plan')).toBeInTheDocument())
    expect(within(card).queryByRole('article', { name: 'Training, Finishing' })).toBeNull()
    expect(within(card).queryByText(/U16|U14/)).toBeNull()
  })

  it('on a phone the week comes first, then today’s plan (Kostas, 28 Oct)', async () => {
    home({ events: [event('t1', 'training', '2026-11-04T16:00', { title: 'Pressing zones' })] })
    renderApp('/coach/home')
    const card = await today()
    const week = await screen.findByRole('heading', { name: 'This week' }, { timeout: 5000 })
    expect(week.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // Nothing moves it back up with CSS order.
    const ordered = (el: Element | null): boolean => !!el && ([...el.classList].some(c => /^-?order-/.test(c)) || ordered(el.parentElement))
    expect(ordered(card)).toBe(false)
  })

  it('a training today not planned yet says so, with Plan this session', async () => {
    home({ events: [event('t2', 'training', '2026-11-04T18:00', { title: 'Finishing' })] })
    renderApp('/coach/home')
    const training = await within(await today()).findByRole('article', { name: 'Training, Finishing' })
    await waitFor(() => expect(within(training).getByText('Not planned yet.')).toBeInTheDocument())
    expect(within(training).getByRole('link', { name: 'Plan this session' })).toHaveAttribute('href', '/coach/training/t2')
  })

  it('a match today shows its game plan: formation and goals, with the game a tap away', async () => {
    home({
      events: [event('m1', 'match', '2026-11-04T17:00', { title: 'League', opponent: 'Everton', home_away: 'home' })],
      gamePlans: [{ event_id: 'm1', formation: '4-3-3', format: 11, goals: [{ title: 'Win it back in 5 seconds', looks_like: '' }],
        key_players: [], scouting: '', strength: null, their_formation: null, created_at: '2026-11-01T10:00:00Z', updated_at: '2026-11-01T10:00:00Z' }],
    })
    renderApp('/coach/home')
    const match = await within(await today()).findByRole('article', { name: 'Match, vs Everton' })
    await waitFor(() => expect(within(match).getByText('4-3-3')).toBeInTheDocument())
    expect(within(match).getByText('Win it back in 5 seconds')).toBeInTheDocument()
    expect(within(match).getByRole('link', { name: 'Open the game plan' })).toHaveAttribute('href', '/coach/matches/m1?tab=plan')
  })

  it('a training earlier today stays on the card, closed, as a reminder of what was done', async () => {
    home({
      events: [event('t0', 'training', '2026-11-04T08:00', { title: 'Morning session' }), event('t9', 'training', '2026-11-06T18:00')],
      practices: [practice('t0', 1, 'Rondos 4v1', 15)],
    })
    server.use(table('coach_sessions', [{ id: 's0', event_id: 't0' }]))
    renderApp('/coach/home')
    const card = await today()
    const training = await within(card).findByRole('article', { name: 'Training, Morning session' })
    await waitFor(() => expect(within(training).getByText('Closed · 15 min')).toBeInTheDocument())
    expect(within(training).queryByRole('link')).toBeNull()
    expect(within(card).queryByText('Nothing today')).toBeNull()
    expect(within(training).queryByRole('link', { name: 'Run it' })).toBeNull()
  })

  // TRAK-367: Training's rule on Home too: Notes saved or skipped close a finished training with no register.
  it('a training closed by its Notes reads Closed, with no register taken', async () => {
    home({ events: [event('t0', 'training', '2026-11-04T08:00', { title: 'Morning session' })], practices: [practice('t0', 1, 'Rondos 4v1', 15)] })
    server.use(table('training_notes', [{ event_id: 't0', again: null, note: '' }]))
    renderApp('/coach/home')
    const training = await within(await today()).findByRole('article', { name: 'Training, Morning session' })
    await waitFor(() => expect(within(training).getByText('Closed · 15 min')).toBeInTheDocument())
  })

  it('each row names its part, then its drill; a plan from before parts, just its drill (TRAK-367)', async () => {
    home({ events: [event('t1', 'training', '2026-11-04T16:00', { title: 'Pressing zones' })],
      practices: [practice('t1', 1, 'Rondos 4v1', 15, 'Rondo'), practice('t1', 2, 'Mirror drill', 10)] })
    renderApp('/coach/home')
    const training = await within(await today()).findByRole('article', { name: 'Training, Pressing zones' })
    expect(await within(training).findByText('Rondo · Rondos 4v1')).toBeInTheDocument()
    expect(within(training).getByText('Mirror drill')).toBeInTheDocument()
  })

  it('with nothing today, the next training or match coming up', async () => {
    home({ events: [event('t3', 'training', '2026-11-06T18:00', { title: 'Before Liverpool' })] })
    renderApp('/coach/home')
    const card = await today()
    await waitFor(() => expect(within(card).getByText('Nothing today')).toBeInTheDocument())
    expect(within(card).getByRole('link', { name: /Before Liverpool/ })).toHaveAttribute('href', '/coach/training/t3')
  })

  it('with Training and Games off, Home keeps Squad shape', async () => {
    home({ events: [event('t1', 'training', '2026-11-04T16:00')], features: ['events'] })
    renderApp('/coach/home')
    expect(await screen.findByRole('region', { name: 'Squad shape' }, { timeout: 5000 })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Today' })).toBeNull()
  })
})
