/**
 * TRAK-283 (Games 1/8): Games home lists the coach's own matches of the squad in view, upcoming soonest first, and
 * each opens its game page. The countdown counts to the event's instant whatever the phone's zone. With no match,
 * Add a match opens Schedule's New event with Match picked. With the switch off, Games is parked like any other
 * screen. Test people are named after footballers.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { renderApp } from '../../../../tests/support/render-app'
import { signInAs } from '../../../../tests/support/session'
import { server } from '../../../../tests/msw/server'
import { table, tableError, rpc, SUPABASE_URL } from '../../../../tests/msw/supabase'

// The phone is in New York and the academy in Athens, so a time that followed the phone's zone would show.
const phoneTZ = process.env.TZ
beforeAll(() => { process.env.TZ = 'America/New_York' })
afterAll(() => { process.env.TZ = phoneTZ })

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const onTheMinute = (ms: number) => Math.ceil(ms / MINUTE) * MINUTE
const athens = (ms: number) => Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Athens', year: 'numeric',
  month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms)).map(p => [p.type, p.value]))

let n = 0
let COACH = { id: 'coach-283' }
/** An Athens academy's match: the wall clock the coach typed and the instant the database stamps from it. */
function match(id: string, squad: string | null, kickOff: number, over: Record<string, unknown> = {}) {
  const at = athens(kickOff)
  return {
    id, coach_user_id: COACH.id, squad, title: 'Match', event_type: 'match', published: true, status: 'scheduled',
    starts_at: new Date(kickOff).toISOString(), ends_at: new Date(kickOff + 90 * MINUTE).toISOString(),
    event_date: `${at.year}-${at.month}-${at.day}`, start_time: `${at.hour}:${at.minute}:00`,
    opponent: `Opponent ${id}`, home_away: 'home', venue: 'Rehearsal Park', ...over,
  }
}
/** The events read answers with these rows and keeps what each request asked for. */
function eventsRead(rows: Record<string, unknown>[]) {
  const asked: URL[] = []
  server.use(http.get(`${SUPABASE_URL}/rest/v1/coach_calendar_events`, ({ request }) => {
    asked.push(new URL(request.url))
    return HttpResponse.json(rows)
  }))
  return asked
}

beforeEach(() => {
  COACH = { id: `coach-283-${++n}` }
  signInAs(COACH)
  server.use(
    table('profiles', [{ id: 'p', user_id: COACH.id, role: 'coach', full_name: 'Fernando Santos', invite_code: 'ABCD' }]),
    table('coach_details', [{ user_id: COACH.id, coach_role: 'Head Coach', team: 'U16', organization_id: 'org-1' }]),
    table('organizations', [{ id: 'org-1', name: 'Rehearsal FC', logo_url: null }]),
    table('squad_players', [
      { id: 'sp-1', coach_user_id: COACH.id, player_name: 'Giorgos Karagounis', age_group: 'U14', status: 'active' },
      { id: 'sp-2', coach_user_id: COACH.id, player_name: 'Angelos Charisteas', age_group: 'U16', status: 'active' },
    ]),
    table('coach_sessions', []),
    table('session_attendance', []),
    table('event_absences', []),
    table('game_plans', []),
    rpc('feature_on', () => true),
    // TRAK-288: no evaluation yet.
    table('game_evaluations', []),
    table('game_evaluation_players', []),
    table('game_evaluation_notes', []),
    table('game_shares', []),
    rpc('game_plan_changes', () => []),
  )
})
afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals() })

const cards = () => within(screen.getByRole('region', { name: 'Your games' })).getAllByRole('link')
  .map(card => card.getAttribute('href'))

describe('TRAK-283: Games home', { timeout: 20_000 }, () => {
  it("lists the coach's matches of the squad in view, soonest first, then past ones newest first; each opens its game page", async () => {
    const user = userEvent.setup()
    const now = Date.now()
    const asked = eventsRead([
      match('past-old', 'U16', onTheMinute(now - 20 * DAY)),
      match('later', 'U14', onTheMinute(now + 10 * DAY)),
      match('past-new', null, onTheMinute(now - 3 * DAY)),
      match('soon', 'U16', onTheMinute(now + 3 * DAY), { opponent: 'Parkview Athletic' }),
    ])
    renderApp('/coach/games')
    await screen.findByRole('region', { name: 'Your games' })
    // All squads (TRAK-266): every match, soonest first, then past ones newest first.
    expect(cards()).toEqual(['/coach/games/soon', '/coach/games/later', '/coach/games/past-new', '/coach/games/past-old'])
    const next = screen.getByRole('region', { name: 'Next game' })
    expect(within(next).getByText('vs Parkview Athletic')).toBeInTheDocument()
    expect(within(next).getByText('Plan not written')).toBeInTheDocument()
    expect(within(next).getAllByRole('button').filter(button => button.textContent === 'Write the plan')).toHaveLength(1)

    // Only the coach's own matches, never a cancelled one, are asked for.
    const read = asked.find(url => url.searchParams.get('event_type') === 'eq.match')!
    expect(read.searchParams.get('coach_user_id')).toBe(`eq.${COACH.id}`)
    expect(read.searchParams.get('status')).toBe('neq.cancelled')

    // U14: its own match and the whole roster's; the next game follows.
    await user.click(within(screen.getByRole('group', { name: 'Age group' })).getByRole('button', { name: 'U14' }))
    await waitFor(() => expect(cards()).toEqual(['/coach/games/later', '/coach/games/past-new']))
    expect(within(screen.getByRole('region', { name: 'Next game' })).getByText('vs Opponent later')).toBeInTheDocument()

    await user.click(within(screen.getByRole('region', { name: 'Your games' })).getByRole('link', { name: /vs Opponent past-new/ }))
    await waitFor(() => expect(window.location.pathname).toBe('/coach/games/past-new'))
  })

  it("counts down to the event's instant whatever the phone's zone, and shows the academy's own time", async () => {
    // jsdom never scrolls anything into view; this countdown is on screen.
    vi.stubGlobal('IntersectionObserver', class {
      constructor(private callback: IntersectionObserverCallback) {}
      observe(target: Element) { this.callback([{ target, isIntersecting: true, intersectionRatio: 1 } as IntersectionObserverEntry], this as unknown as IntersectionObserver) }
      unobserve() {}
      disconnect() {}
      takeRecords() { return [] }
    })
    const kickOff = onTheMinute(Date.now() + 3 * DAY + 2 * HOUR + 5 * MINUTE)
    eventsRead([match('soon', 'U16', kickOff, { opponent: 'Parkview Athletic', published: false })])
    renderApp('/coach/games')
    const next = await screen.findByRole('region', { name: 'Next game' })
    expect(within(next).getByText('Logistics not shared')).toBeInTheDocument()
    expect(within(next).getByRole('button', { name: 'Share the logistics' })).toBeInTheDocument()
    await waitFor(() => expect(within(next).getByRole('timer', { name: 'Kick-off in' })).toHaveTextContent(/3 days, 2 hours, [45] minutes/))
    const at = athens(kickOff)
    expect(within(next).getByText(new RegExp(`${at.hour}:${at.minute} Athens time$`))).toBeInTheDocument()

    await userEvent.click(within(next).getByRole('button', { name: 'Share the logistics' }))
    await waitFor(() => expect(window.location.pathname + window.location.search).toBe('/coach/games/soon?tab=logistics'))
  })

  it("with no match, Add a match opens Schedule's New event with Match picked", async () => {
    eventsRead([])
    renderApp('/coach/games')
    await userEvent.click(await screen.findByRole('button', { name: 'Add a match' }))
    await waitFor(() => expect(window.location.pathname).toBe('/coach/schedule'))
    const sheet = await screen.findByRole('dialog', { name: 'New event' }, { timeout: 5000 })
    expect(within(sheet).getByLabelText('Opponent')).toBeInTheDocument()
  })

  it('a failed read says so with Retry, never "No matches yet"', async () => {
    server.use(tableError('coach_calendar_events', 500, { message: 'unavailable' }))
    renderApp('/coach/games')
    const failure = await screen.findByRole('alert', {}, { timeout: 5000 })
    expect(within(failure).getByRole('button', { name: /Retry/ })).toBeInTheDocument()
    expect(screen.queryByText('No matches yet')).toBeNull()
  })

  it('with the switch off, Games is parked like any other screen', async () => {
    server.use(rpc('feature_on', ({ p_feature }) => p_feature === 'events'))
    eventsRead([])
    renderApp('/coach/games')
    expect(await screen.findByRole('note', { name: 'This screen is coming soon' })).toBeInTheDocument()
  })
})
