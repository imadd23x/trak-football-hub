/**
 * TRAK-130 (J8.7): the player sees their squad's upcoming events: a "Next up"
 * card on home that never pushes the coach's message down, a list in the
 * Sessions tab, and an event page. Cancelled stays visible with its reason;
 * a changed event says "Changed" until the player opens it. A failed read
 * says so, never an empty schedule.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { renderApp } from '../../../../tests/support/render-app'
import { signInAs } from '../../../../tests/support/session'
import { server } from '../../../../tests/msw/server'
import { table, tableError, rpc, SUPABASE_URL } from '../../../../tests/msw/supabase'

const PLAYER = { id: 'player-events-j8' }
const ASSESSMENT = { id: 'assessment-1', squad_player_id: 'squad-1', coach_user_id: 'coach-1', created_at: '2026-10-01T10:00:00Z',
  work_rate: 8, tactical: 8, attitude: 8, technical: 8, physical: 8, coachability: 8, coach_rating: 8 }
const event = (id: string, extra: Record<string, unknown> = {}) => ({
  id, coach_user_id: 'coach-1', published: true, event_type: 'training', title: 'Training',
  event_date: '2026-11-14', start_time: '10:00:00', starts_at: '2026-11-14T06:00:00Z',
  venue: 'Main pitch', opponent: null, meet_time: null, kit: null, home_away: null,
  status: 'scheduled', cancel_reason: null, sequence: 0, ...extra,
})
const MATCH_EVENT = event('ev-1', { event_type: 'match', title: 'League', opponent: 'Rivals FC', home_away: 'away',
  venue: 'Rivals Park', meet_time: '09:15:00', kit: 'White' })
const TRAINING_EVENT = event('ev-2', { event_date: '2026-11-17', start_time: '17:30:00', starts_at: '2026-11-17T13:30:00Z' })
const UNTIMED_EVENT = event('ev-3', { event_date: '2026-11-21', start_time: null, starts_at: '2026-11-20T20:00:00Z', title: 'Fitness' })

function setup(events: unknown[] | 'fail' = [MATCH_EVENT, TRAINING_EVENT, UNTIMED_EVENT]) {
  server.use(
    table('profiles', [{ id: 'p', user_id: PLAYER.id, role: 'player', full_name: 'Synthetic Player' }]),
    table('matches', []), table('player_details', []),
    table('squad_players', [{ id: 'squad-1', coach_user_id: 'coach-1' }]),
    table('coach_assessments', [ASSESSMENT]),
    http.get(`${SUPABASE_URL}/rest/v1/coach_shared_feedback`, () => HttpResponse.json({ body: 'Keep scanning before you receive.' })),
    events === 'fail'
      ? tableError('coach_calendar_events', 500, { code: 'XX000', message: 'unavailable' })
      : table('coach_calendar_events', events as Record<string, unknown>[]),
    table('recognition_awards', []),
    rpc('get_player_invites_for_current_user', () => []),
    rpc('family_training_history', () => []),
    rpc('my_consent_status', () => ({ required: false, invited_parent: null })),
  )
}
const seenKey = `trak:player-events-seen:${PLAYER.id}`

beforeEach(() => { signInAs(PLAYER); localStorage.removeItem(seenKey) })
afterEach(() => cleanup())

describe('TRAK-130: player home "Next up"', () => {
  it('shows only the next event, with time, meet time, venue and kit', async () => {
    setup()
    renderApp('/player/home')
    const card = await screen.findByRole('link', { name: /next up/i })
    expect(within(card).getByText('Match vs Rivals FC (away)')).toBeInTheDocument()
    expect(card).toHaveTextContent('Sat 14 Nov')
    expect(card).toHaveTextContent('10:00')
    expect(card).toHaveTextContent('Meet 09:15')
    expect(card).toHaveTextContent('Rivals Park')
    expect(card).toHaveTextContent('Kit: White')
    expect(screen.queryByText('Fitness')).toBeNull()
  })

  it("sits below the coach's message, so it never pushes the message off the first screen", async () => {
    setup()
    renderApp('/player/home')
    const card = await screen.findByRole('link', { name: /next up/i })
    const message = screen.getByText('Keep scanning before you receive.')
    expect(message.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('shows a cancelled next event as Cancelled, with the reason', async () => {
    setup([event('ev-9', { status: 'cancelled', cancel_reason: 'Pitch closed' })])
    renderApp('/player/home')
    const card = await screen.findByRole('link', { name: /next up/i })
    expect(card).toHaveTextContent('Cancelled')
    expect(card).toHaveTextContent('Pitch closed')
  })

  it('marks an event the coach changed after the player saw it, and opening it clears the mark', async () => {
    localStorage.setItem(seenKey, JSON.stringify({ 'ev-1': 0 }))
    setup([{ ...MATCH_EVENT, start_time: '11:00:00', sequence: 1 }])
    renderApp('/player/home')
    const card = await screen.findByRole('link', { name: /next up/i })
    expect(card).toHaveTextContent('Changed')
    expect(card).toHaveTextContent('11:00')

    await userEvent.click(card)
    expect(await screen.findByRole('heading', { name: 'Match vs Rivals FC (away)' })).toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem(seenKey)!)).toEqual({ 'ev-1': 1 })
  })

  it('a failed events read is an error, never an empty schedule', async () => {
    setup('fail')
    renderApp('/player/home')
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /next up/i })).toBeNull()
  })
})

describe('TRAK-130: the Sessions tab lists what is coming up', () => {
  it('lists every upcoming event above the history, untimed ones on their own day', async () => {
    setup()
    renderApp('/player/matches')
    const upcoming = await screen.findByRole('region', { name: 'Upcoming' })
    const items = await within(upcoming).findAllByRole('link')
    expect(items.map(i => i.textContent)).toEqual([
      expect.stringContaining('Match vs Rivals FC (away)'),
      expect.stringContaining('Tue 17 Nov'),
      expect.stringMatching(/Fitness.*Sat 21 Nov.*Time to be confirmed/),
    ])
  })

  it('says it could not load upcoming events, and retries, without hiding the history', async () => {
    setup('fail')
    renderApp('/player/matches')
    const upcoming = await screen.findByRole('region', { name: 'Upcoming' })
    expect(await within(upcoming).findByText(/couldn't load upcoming events/i)).toBeInTheDocument()
    server.use(table('coach_calendar_events', [MATCH_EVENT]))
    await userEvent.click(within(upcoming).getByRole('button', { name: /retry/i }))
    expect(await within(upcoming).findByText('Match vs Rivals FC (away)')).toBeInTheDocument()
  })

  it('says plainly when nothing is scheduled', async () => {
    setup([])
    renderApp('/player/matches')
    const upcoming = await screen.findByRole('region', { name: 'Upcoming' })
    expect(await within(upcoming).findByText(/nothing scheduled yet/i)).toBeInTheDocument()
  })
})

describe('TRAK-130: only published events are asked for (drafts are coach-only, Imad 9 Oct)', () => {
  function captureEventRequests() {
    const urls: URL[] = []
    server.use(http.get(`${SUPABASE_URL}/rest/v1/coach_calendar_events`, ({ request }) => {
      urls.push(new URL(request.url))
      return HttpResponse.json(request.headers.get('Accept')?.includes('vnd.pgrst.object') ? MATCH_EVENT : [MATCH_EVENT])
    }))
    return urls
  }

  it.each(['/player/home', '/player/matches', '/player/event/ev-1'])('%s filters on published', async path => {
    setup()
    const urls = captureEventRequests()
    renderApp(path)
    await waitFor(() => expect(urls.length).toBeGreaterThan(0))
    for (const url of urls) expect(url.searchParams.get('published')).toBe('eq.true')
  })
})

describe('TRAK-130: the event page', () => {
  it('shows every detail of a match', async () => {
    setup([MATCH_EVENT])
    renderApp('/player/event/ev-1')
    expect(await screen.findByRole('heading', { name: 'Match vs Rivals FC (away)' })).toBeInTheDocument()
    const details = screen.getByRole('list', { name: 'Event details' })
    for (const text of ['Sat 14 Nov', '10:00', '09:15', 'Rivals Park', 'White', 'Away']) {
      expect(details).toHaveTextContent(text)
    }
  })

  it('shows a cancellation and its reason', async () => {
    setup([event('ev-9', { status: 'cancelled', cancel_reason: 'Pitch closed' })])
    renderApp('/player/event/ev-9')
    expect(await screen.findByText(/this event is cancelled/i)).toBeInTheDocument()
    expect(screen.getByText('Pitch closed')).toBeInTheDocument()
  })

  it('says "Time to be confirmed" for an untimed event, never midnight', async () => {
    setup([UNTIMED_EVENT])
    renderApp('/player/event/ev-3')
    const details = await screen.findByRole('list', { name: 'Event details' })
    expect(details).toHaveTextContent('Time to be confirmed')
    expect(details).not.toHaveTextContent('00:00')
  })

  it('says the event is not available when the player cannot read it', async () => {
    setup([])
    renderApp('/player/event/ev-404')
    expect(await screen.findByText(/this event isn't available/i)).toBeInTheDocument()
  })

  it('a failed read offers a retry', async () => {
    setup('fail')
    renderApp('/player/event/ev-1')
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument())
  })
})
