/**
 * TRAK-131 (J8.8): the parent sees the selected child's upcoming events: a
 * "Next up" card on home, an "Upcoming" list on Matches and an event page,
 * with the player's own card and details (J8.7). Each child's events only
 * while that child is selected, read through child_events() so only that
 * child's consent counts. A withdrawal empties the list on refocus (TRAK-88);
 * a failed read says so, never an empty schedule.
 */
import { act, cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { focusManager, onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Navigate, Route, Routes } from 'react-router-dom'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ParentChildrenProvider } from '@/contexts/ParentChildrenContext'
import ParentMatches from '../ParentMatches'
import ParentHome from '../ParentHome'
import ParentEvent from '../ParentEvent'
import { server } from '../../../../tests/msw/server'
import { SUPABASE_URL } from '../../../../tests/msw/supabase'

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'parent-a', email: 'parent-a@test.invalid' },
    profile: { full_name: 'Test Parent', role: 'parent' },
    signOut: vi.fn(), refreshProfile: vi.fn(),
  }),
}))
vi.mock('@/lib/telemetry', () => ({ trackEvent: vi.fn() }))

const endpoint = (name: string) => `${SUPABASE_URL}/rest/v1/${name}`
const seenKey = 'trak:player-events-seen:parent-a'
const event = (id: string, extra: Record<string, unknown> = {}) => ({
  id, event_type: 'training', title: 'Training', event_date: '2099-11-14', start_time: '10:00:00',
  starts_at: '2099-11-14T06:00:00Z', meet_time: null, venue: 'Main pitch', kit: null, opponent: null,
  home_away: null, status: 'scheduled', cancel_reason: null, sequence: 0, ...extra,
})
const ALEX_EVENT = event('ev-alex', { title: 'Alex training' })
const ZARA_MATCH = event('ev-zara', { event_type: 'match', title: 'League', opponent: 'Rivals FC', home_away: 'away',
  kit: 'White', meet_time: '09:15:00', venue: 'Rivals Park' })

let EVENTS: Record<string, Record<string, unknown>[] | 'fail'>
let asked: string[]

// child_events() as PostgREST answers it: per child, filtered by id for the
// event page, and a single object when supabase-js asks for one.
const childEvents = http.post(endpoint('rpc/child_events'), async ({ request }) => {
  const { p_child } = await request.json() as { p_child: string }
  asked.push(p_child)
  const rows = EVENTS[p_child] ?? []
  if (rows === 'fail') return HttpResponse.json({ code: 'XX000', message: 'unavailable' }, { status: 500 })
  const id = new URL(request.url).searchParams.get('id')?.replace(/^eq\./, '')
  const out = id ? rows.filter(r => r.id === id) : rows
  if ((request.headers.get('Accept') ?? '').includes('vnd.pgrst.object')) {
    return out.length === 1 ? HttpResponse.json(out[0]) : HttpResponse.json(
      { code: 'PGRST116', details: `Results contain ${out.length} rows`, hint: null, message: 'JSON object requested, multiple (or no) rows returned' },
      { status: 406 })
  }
  return HttpResponse.json(out)
})

beforeEach(() => {
  EVENTS = { Alex: [ALEX_EVENT], Zara: [ZARA_MATCH] }
  asked = []
  localStorage.removeItem(seenKey)
  server.use(
    http.get(endpoint('player_parent_links'), () => HttpResponse.json([{ player_user_id: 'Alex' }, { player_user_id: 'Zara' }])),
    http.get(endpoint('profiles'), ({ request }) => {
      const filter = new URL(request.url).searchParams.get('user_id') ?? ''
      return HttpResponse.json(['Alex', 'Zara'].filter(id => filter.includes(id)).map(user_id => ({ user_id, full_name: user_id })))
    }),
    http.get(endpoint('matches'), () => HttpResponse.json([])),
    http.get(endpoint('player_details'), () => HttpResponse.json([])),
    http.get(endpoint('squad_players'), () => HttpResponse.json([])),
    http.get(endpoint('coach_assessments'), () => HttpResponse.json([])),
    http.get(endpoint('recognition_awards'), () => HttpResponse.json([])),
    http.post(endpoint('rpc/get_roster_children_awaiting_consent'), () => HttpResponse.json([])),
    http.post(endpoint('rpc/get_children_awaiting_consent'), () => HttpResponse.json([])),
    http.post(endpoint('rpc/family_training_history'), () => HttpResponse.json([])),
    childEvents,
  )
})
const clients: QueryClient[] = []
afterEach(() => { cleanup(); clients.splice(0).forEach(c => c.clear()); onlineManager.setOnline(true); focusManager.setFocused(undefined) })

function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 } } })
  clients.push(client)
  return render(<QueryClientProvider client={client}>
    <MemoryRouter initialEntries={[path]}>
      <ParentChildrenProvider>
        <Routes>
          <Route path="/parent/home" element={<ParentHome />} />
          <Route path="/parent/matches" element={<ParentMatches />} />
          <Route path="/parent/events" element={<Navigate to="/parent/matches" replace />} />
          <Route path="/parent/event/:id" element={<ParentEvent />} />
        </Routes>
      </ParentChildrenProvider>
    </MemoryRouter>
  </QueryClientProvider>)
}

describe('TRAK-131: the parent\'s Upcoming list', () => {
  // TRAK-170 (live run 2): the same rule as the player's Sessions tab.
  it('shows the next 3 events, then See more for the rest', async () => {
    EVENTS.Alex = [1, 2, 3, 4, 5].map(n => event(`ev-a${n}`, { title: `Alex session ${n}` }))
    renderAt('/parent/matches')
    const list = await screen.findByRole('region', { name: 'Upcoming' })
    expect(await within(list).findByText('Alex session 1')).toBeInTheDocument()
    expect(within(list).getAllByRole('link')).toHaveLength(3)
    await userEvent.click(within(list).getByRole('button', { name: 'See more (2)' }))
    expect(within(list).getAllByRole('link')).toHaveLength(5)
  })

  // TRAK-195 (Kostas, 16 Oct list, item 7): each See more adds the next 5, not the whole season.
  it('with 20 upcoming, each See more adds 5', async () => {
    EVENTS.Alex = Array.from({ length: 20 }, (_, i) => event(`ev-a${i + 1}`, { title: `Alex session ${i + 1}` }))
    renderAt('/parent/matches')
    const list = await screen.findByRole('region', { name: 'Upcoming' })
    expect(await within(list).findByText('Alex session 1')).toBeInTheDocument()
    expect(within(list).getAllByRole('link')).toHaveLength(3)
    await userEvent.click(within(list).getByRole('button', { name: 'See more (17)' }))
    expect(within(list).getAllByRole('link')).toHaveLength(8)
    expect(within(list).getByRole('button', { name: 'See more (12)' })).toBeInTheDocument()
  })

  it('shows only the selected child\'s events, and the other child\'s after switching', async () => {
    renderAt('/parent/matches')
    const list = await screen.findByRole('region', { name: 'Upcoming' })
    expect(await within(list).findByText('Alex training')).toBeInTheDocument()
    expect(within(list).queryByText(/Rivals FC/)).not.toBeInTheDocument()
    expect(within(list).getByRole('link', { name: /Alex training/ })).toHaveAttribute('href', '/parent/event/ev-alex')

    await userEvent.selectOptions(screen.getByLabelText('Following'), 'Zara')
    expect(await within(list).findByText('Match vs Rivals FC (away)')).toBeInTheDocument()
    expect(within(list).getByText('Kit: White')).toBeInTheDocument()
    expect(within(list).queryByText('Alex training')).not.toBeInTheDocument()
    expect(asked).toEqual(expect.arrayContaining(['Alex', 'Zara']))
  })

  it('drops a withdrawn child\'s events when the open tab is refocused', async () => {
    renderAt('/parent/matches')
    const list = await screen.findByRole('region', { name: 'Upcoming' })
    expect(await within(list).findByText('Alex training')).toBeInTheDocument()

    EVENTS.Alex = []  // the parent withdrew on another device
    // Returning to the tab refetches (React Query's focus refetch). The app's
    // ParentConsentWatcher also reloads the page on a withdrawal (TRAK-88).
    act(() => { focusManager.setFocused(false); focusManager.setFocused(true) })
    expect(await within(list).findByText('Nothing scheduled yet.')).toBeInTheDocument()
    expect(within(list).queryByText('Alex training')).not.toBeInTheDocument()
  })

  it('says a failed read failed, never "Nothing scheduled yet"', async () => {
    EVENTS.Alex = 'fail'
    renderAt('/parent/matches')
    const list = await screen.findByRole('region', { name: 'Upcoming' })
    expect(await within(list).findByText("Couldn't load upcoming events.")).toBeInTheDocument()
    expect(within(list).queryByText('Nothing scheduled yet.')).not.toBeInTheDocument()
  })

  it('marks cancelled with the reason, and changed until opened', async () => {
    EVENTS.Alex = [
      event('ev-cancelled', { title: 'Cancelled training', status: 'cancelled', cancel_reason: 'Pitch closed', sequence: 3 }),
      event('ev-changed', { title: 'Moved training', event_date: '2099-11-15', starts_at: '2099-11-15T06:00:00Z', sequence: 2 }),
    ]
    localStorage.setItem(seenKey, JSON.stringify({ 'ev-changed': 1 }))
    renderAt('/parent/matches')
    const list = await screen.findByRole('region', { name: 'Upcoming' })
    const cancelled = await within(list).findByRole('link', { name: /Cancelled training/ })
    expect(cancelled).toHaveTextContent('Cancelled')
    expect(cancelled).toHaveTextContent('Pitch closed')
    expect(within(list).getByRole('link', { name: /Moved training/ })).toHaveTextContent('Changed')
  })
})

describe('TRAK-171: parent Home calendar', () => {
  it('opens events and avoids a duplicate Next up card', async () => {
    renderAt('/parent/home')
    await screen.findByRole('region', { name: 'This week' })
    // TRAK-171 (live run 3, Kostas): one Events page, the tab's, so the icon opens it.
    expect(screen.getByRole('link', { name: 'Calendar' })).toHaveAttribute('href', '/parent/matches')
    expect(screen.queryByRole('region', { name: 'Next up' })).not.toBeInTheDocument()
  })

  it('the calendar page follows siblings and opens only their own events', async () => {
    renderAt('/parent/home')
    await screen.findByRole('region', { name: 'This week' })
    await userEvent.click(screen.getByRole('link', { name: 'Calendar' }))
    expect(await screen.findByRole('heading', { name: 'Events' })).toBeInTheDocument()
    const list = await screen.findByRole('region', { name: 'Upcoming' })
    expect(await within(list).findByText('Alex training')).toBeInTheDocument()
    await userEvent.selectOptions(screen.getByLabelText('Following'), 'Zara')
    expect(await within(list).findByText('Match vs Rivals FC (away)')).toBeInTheDocument()
    expect(within(list).queryByText('Alex training')).not.toBeInTheDocument()
    await userEvent.click(within(list).getByRole('link', { name: /Rivals FC/ }))
    expect(await screen.findByText('Kit')).toBeInTheDocument()
    // The page's own Back (the tab bar has an Events button too, TRAK-171).
    await userEvent.click(screen.getAllByRole('button', { name: 'Events' }).find(b => !b.closest('nav'))!)
    expect(await screen.findByRole('heading', { name: 'Events' })).toBeInTheDocument()
    expect(await screen.findByText('Match vs Rivals FC (away)')).toBeInTheDocument()
  })

  it('says the week read failed instead of showing an empty week', async () => {
    EVENTS.Alex = 'fail'
    renderAt('/parent/home')
    expect(await screen.findByText(/couldn't load this week/i)).toBeInTheDocument()
    expect(screen.queryByText('Nothing planned.')).not.toBeInTheDocument()
  })
})

describe('TRAK-131: the parent\'s event page', () => {
  it('shows every detail for the selected child, and clears "Changed"', async () => {
    EVENTS.Alex = [event('ev-alex', { title: 'Alex training', sequence: 4 })]
    localStorage.setItem(seenKey, JSON.stringify({ 'ev-alex': 1 }))
    renderAt('/parent/event/ev-alex')
    const details = await screen.findByRole('list', { name: 'Event details' })
    expect(details).toHaveTextContent('Main pitch')
    expect(details).toHaveTextContent('10:00')
    expect(JSON.parse(localStorage.getItem(seenKey) ?? '{}')['ev-alex']).toBe(4)
  })

  // TRAK-161 (J8.8): read through child_events() as the server sends it. Even
  // if a coach-only note slipped into the row, the page shows only family_note.
  // TRAK-134 (live run 3): a changed event says what moved, for the parent as for the player.
  it('says what moved since the parent last saw it, on that visit only', async () => {
    localStorage.removeItem('trak:event-snapshots:parent-a')
    renderAt('/parent/matches')
    await within(await screen.findByRole('region', { name: 'Upcoming' })).findByText('Alex training')
    cleanup()
    EVENTS.Alex = [{ ...ALEX_EVENT, event_date: '2099-11-15', starts_at: '2099-11-15T06:00:00Z', sequence: 1 }]
    renderAt('/parent/event/ev-alex')
    const changed = await screen.findByRole('status', { name: 'What changed' })
    expect(changed).toHaveTextContent(/Moved: \w{3} 14 Nov → \w{3} 15 Nov/)
    expect(changed).not.toHaveTextContent('Time')
    cleanup()
    renderAt('/parent/event/ev-alex')
    expect(await screen.findByRole('heading', { name: 'Alex training' })).toBeInTheDocument()
    expect(screen.queryByRole('status', { name: 'What changed' })).toBeNull()
  })

  it('shows the venue with (Away), Kit and the family note, never the coach-only notes', async () => {
    EVENTS.Alex = [event('ev-alex', { event_type: 'match', title: 'League', opponent: 'Rivals FC', home_away: 'away',
      venue: 'Olympiacos Stadium', kit: 'Green kits', family_note: 'Bring extra water, it\'s a hot day', notes: 'SECRET coach note' })]
    renderAt('/parent/event/ev-alex')
    const details = await screen.findByRole('list', { name: 'Event details' })
    expect(details).toHaveTextContent('Olympiacos Stadium (Away)')
    expect(details).toHaveTextContent('Green kits')
    expect(details).toHaveTextContent('Bring extra water, it\'s a hot day')
    expect(document.body).not.toHaveTextContent('SECRET')
    expect(screen.queryByText('Home or away')).toBeNull()
  })

  it('says an event isn\'t available when the selected child can\'t see it', async () => {
    renderAt('/parent/event/ev-zara')
    expect(await screen.findByText("This event isn't available for Alex.")).toBeInTheDocument()
    expect(asked).toContain('Alex')
  })
})

describe('TRAK-171 (live run 3): the parent tab is Events, one page', () => {
  it('the tab and the page say Events; an old Events link lands on the same page', async () => {
    renderAt('/parent/events')
    expect(await screen.findByRole('heading', { name: 'Events' })).toBeInTheDocument()
    expect(within(screen.getByRole('navigation', { name: 'Parent' })).getByRole('tab', { name: 'Events' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Matches' })).not.toBeInTheDocument()
    // The page's other half, played matches and training, is there too.
    expect(await screen.findByText(/opposition|No matches yet/)).toBeInTheDocument()
  })
})
