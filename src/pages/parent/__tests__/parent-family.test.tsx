import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { followChild } from '@/test/follow-child'
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes, useParams, useLocation } from 'react-router-dom'
import { http, HttpResponse } from 'msw'
import { beforeAll, afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ParentChildrenProvider } from '@/contexts/ParentChildrenContext'
import ParentHome from '../ParentHome'
import ParentMatches from '../ParentMatches'
import ParentAlerts from '../ParentAlerts'
import ParentProfilePage from '../ParentProfilePage'
import Settings from '@/pages/Settings'
import { server } from '../../../../tests/msw/server'
import { SUPABASE_URL } from '../../../../tests/msw/supabase'

// These checks are about something else; the phone sits in the academy's zone (Dubai), as Trak's families' do.
// Event times follow the phone's clock (Imad, 23 Oct), so CI's UTC clock would move every time.
const phoneTZ = process.env.TZ
beforeAll(() => { process.env.TZ = 'Asia/Dubai' })
afterAll(() => { process.env.TZ = phoneTZ })

const auth = vi.hoisted(() => ({ parentId: 'parent-a' }))
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: auth.parentId, email: `${auth.parentId}@test.invalid` },
    profile: { full_name: 'Test Parent', role: 'parent' },
    signOut: vi.fn(), refreshProfile: vi.fn(),
  }),
}))
vi.mock('@/lib/telemetry', () => ({ trackEvent: vi.fn() }))

const endpoint = (table: string) => `${SUPABASE_URL}/rest/v1/${table}`
const fail = () => HttpResponse.json({ code: '42501', message: 'permission denied' }, { status: 403 })
const match = (child: string, rating: number | null = 0) => ({
  id: `match-${child}`, user_id: child, opponent: `${child} opposition`, competition: 'League',
  venue: null, created_at: '2026-09-18T10:00:00Z', match_date: '2026-09-01',
  team_score: 0, opponent_score: 0, computed_rating: rating,
})
const assessment = (child: string) => ({
  id: `assessment-${child}`, squad_player_id: `squad-${child}`, coach_user_id: `coach-${child}`,
  created_at: '2026-09-17T10:00:00Z', coach_rating: 0,
  work_rate: 0, tactical: 0, attitude: 0, technical: 0, physical: 0, coachability: 0,
})

/** TRAK-436: the coach's review of a match for this child, and the match through child_events. */
const review = (child: string, publishedAt: string) => [
  http.get(endpoint('game_review_for_family'), ({ request }) => HttpResponse.json(
    (new URL(request.url).searchParams.get('squad_player_id') ?? '').includes(`squad-${child}`)
      ? [{ event_id: `game-${child}`, published_at: publishedAt, our_score: 2, their_score: 1, coach_name: 'Otto Rehhagel' }] : [])),
  http.post(endpoint('rpc/child_events'), ({ request }) => HttpResponse.json(
    (new URL(request.url).searchParams.get('id') ?? '').includes(`game-${child}`)
      ? [{ id: `game-${child}`, event_type: 'match', title: 'League', opponent: 'Rivals FC', home_away: 'home', event_date: '2026-11-08',
        start_time: '11:00:00', status: 'scheduled', sequence: 1 }] : [])),
]

function installFamily() {
  server.use(
    // TRAK-286: no shared game plan.
    http.get(endpoint('game_for_family'), () => HttpResponse.json([])),
    http.get(endpoint('game_review_for_family'), () => HttpResponse.json([])),
    http.get(endpoint('game_for_player'), () => HttpResponse.json([])),
    http.get(endpoint('player_parent_links'), ({ request }) => {
      const parent = new URL(request.url).searchParams.get('parent_user_id')
      return HttpResponse.json((parent === 'eq.parent-a' ? ['Alex', 'Zara'] : ['Sam'])
        .map(player_user_id => ({ player_user_id })))
    }),
    http.get(endpoint('profiles'), ({ request }) => {
      const filter = new URL(request.url).searchParams.get('user_id') ?? ''
      return HttpResponse.json(['Alex', 'Zara', 'Sam', 'coach-Alex', 'coach-Zara', 'coach-Sam']
        .filter(id => filter.includes(id)).map(user_id => ({ user_id, full_name: user_id })))
    }),
    http.get(endpoint('matches'), ({ request }) => {
      const child = new URL(request.url).searchParams.get('user_id')?.slice(3) ?? ''
      return HttpResponse.json([match(child)])
    }),
    http.get(endpoint('player_details'), ({ request }) => {
      const child = new URL(request.url).searchParams.get('user_id')?.slice(3)
      return HttpResponse.json([{ position: 'mid', current_club: `${child} academy`, age_group: 'U15' }])
    }),
    http.get(endpoint('squad_players'), ({ request }) => {
      const child = new URL(request.url).searchParams.get('linked_player_id')?.slice(3)
      return HttpResponse.json([{ id: `squad-${child}` }])
    }),
    http.get(endpoint('coach_assessments'), ({ request }) => {
      const ids = new URL(request.url).searchParams.get('squad_player_id') ?? ''
      return HttpResponse.json(['Alex', 'Zara', 'Sam'].filter(id => ids.includes(id)).map(assessment))
    }),
    http.get(endpoint('recognition_awards'), ({ request }) => {
      const ids = new URL(request.url).searchParams.get('squad_player_id') ?? ''
      return HttpResponse.json(['Alex', 'Zara', 'Sam'].filter(id => ids.includes(id)).map(child => ({
        id: `award-${child}`, coach_user_id: `coach-${child}`, created_at: '2026-09-16T10:00:00Z',
        award_type: 'player_of_week', awarded_for: `${child} teamwork`, note: null,
      })))
    }),
    http.post(endpoint('rpc/get_roster_children_awaiting_consent'), () => HttpResponse.json([])),
    http.post(endpoint('rpc/get_children_awaiting_consent'), () => HttpResponse.json([])),
    // TRAK-77: Matches also lists the selected child's training; none here.
    http.post(endpoint('rpc/family_training_history'), () => HttpResponse.json([])),
    // J8.8 (TRAK-131): Home and Matches read the selected child's events.
    http.post(endpoint('rpc/child_events'), () => HttpResponse.json([])),
    http.post(endpoint('rpc/season_plan_for_player'), () => HttpResponse.json([])), // TRAK-437: the position is the coach's
  )
}

const MatchDetailProbe = () => <p>Match detail {useParams().id}</p>
const EventPageProbe = () => {
  const from = (useLocation().state as { from?: string } | null)?.from
  return <><p>Event page {useParams().id}</p><p>Opened from {from ?? 'nowhere'}</p></>
}

const clients: QueryClient[] = []
function renderFamily(route = '/parent/home') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 } } })
  clients.push(client)
  const tree = () => <QueryClientProvider client={client}>
    <MemoryRouter initialEntries={[route]}>
      <ParentChildrenProvider>
        <Routes>
          <Route path="/parent/home" element={<ParentHome />} />
          <Route path="/parent/matches" element={<ParentMatches />} />
          <Route path="/parent/alerts" element={<ParentAlerts />} />
          <Route path="/parent/match/:id" element={<MatchDetailProbe />} />
          <Route path="/parent/event/:id" element={<EventPageProbe />} />
          <Route path="/parent/profile" element={<ParentProfilePage />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </ParentChildrenProvider>
    </MemoryRouter>
  </QueryClientProvider>
  return { ...render(tree()), tree, client }
}

beforeEach(() => { auth.parentId = 'parent-a'; installFamily() })
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); onlineManager.setOnline(true) })

describe('parent family navigation', () => {
  it('keeps the selected child across all parent views and lists both children on Profile', async () => {
    const user = userEvent.setup()
    renderFamily()
    // TRAK-194: Home lists no matches; the child's line and award show whose Home it is.
    expect(await screen.findByText('Alex academy · U15')).toBeInTheDocument()
    await followChild('Zara')
    expect(screen.queryByText('Alex academy · U15')).not.toBeInTheDocument()
    expect(await screen.findByText('Zara academy · U15')).toBeInTheDocument()
    expect(screen.getByText('Zara teamwork')).toBeInTheDocument()
    expect(screen.queryByText('Alex teamwork')).not.toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'Events' }))
    expect(await screen.findByText('Zara opposition')).toBeInTheDocument()
    expect(screen.getByRole('combobox')).toHaveValue('Zara')
    // TRAK-74: alerts are a bell on Home, not a tab.
    await user.click(screen.getByRole('tab', { name: 'Home' }))
    await user.click(await screen.findByRole('button', { name: /^Alerts/ }))
    const alertsSheet = await screen.findByRole('dialog', { name: 'Alerts' })
    // TRAK-436: no "Match logged" in the bell; the child's own assessment says whose bell it is.
    expect(await within(alertsSheet).findByText('New assessment from Coach coach-Zara')).toBeInTheDocument()
    expect(within(alertsSheet).queryByText(/coach-Alex/)).not.toBeInTheDocument()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await user.click(screen.getByRole('tab', { name: 'Profile' }))
    // TRAK-73: the header counts the linked children. TRAK-181: Profile has no
    // "Following" picker; each child has its own line below.
    expect(await screen.findByText('Parent account · 2 children linked')).toBeInTheDocument()
    expect(screen.queryByText(/^Following Zara/)).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'Following' })).not.toBeInTheDocument()
    // TRAK-73: the linked children are on the Profile, one "Linked" row each.
    const connections = await screen.findByRole('list', { name: 'Linked children' })
    expect(within(connections).getByText('Alex')).toBeInTheDocument()
    expect(within(connections).getByText('Zara')).toBeInTheDocument()
    expect(within(connections).getAllByText('Linked')).toHaveLength(2)
    // TRAK-182 (live run 3): Arc's round avatars, as on the coach's screens: the
    // parent's initials in the header. TRAK-349: each linked child has their
    // drawn face beside their name instead of initials.
    expect(screen.getByText('TP')).toBeInTheDocument()
    expect(connections.querySelectorAll('svg[data-face]')).toHaveLength(2)
    expect(within(connections).queryByText('A')).not.toBeInTheDocument()
    expect(within(connections).queryByText('Z')).not.toBeInTheDocument()
  })

  it('does not carry child names or match data into another parent account', async () => {
    const view = renderFamily('/parent/matches')
    expect(await screen.findByText('Alex opposition')).toBeInTheDocument()
    auth.parentId = 'parent-b'
    view.rerender(view.tree())
    expect(screen.queryByText('Alex opposition')).not.toBeInTheDocument()
    expect(await screen.findByText('Sam opposition')).toBeInTheDocument()
    expect(screen.getByRole('combobox')).toHaveValue('Sam')
    expect(screen.queryByRole('option', { name: 'Alex' })).not.toBeInTheDocument()
  })

  it('rejects an old child response after switching to a faster child', async () => {
    let release!: () => void
    let requested = false
    const pending = new Promise<void>(resolve => { release = resolve })
    server.use(http.get(endpoint('matches'), async ({ request }) => {
      const child = new URL(request.url).searchParams.get('user_id')?.slice(3) ?? ''
      if (child === 'Alex') { requested = true; await pending }
      return HttpResponse.json([match(child)])
    }))
    renderFamily('/parent/matches')
    const selector = await screen.findByRole('combobox')
    await waitFor(() => expect(requested).toBe(true))
    await userEvent.selectOptions(selector, 'Zara')
    expect(await screen.findByText('Zara opposition')).toBeInTheDocument()
    await act(async () => { release(); await pending })
    expect(screen.queryByText('Alex opposition')).not.toBeInTheDocument()
    expect(screen.getByText('Zara opposition')).toBeInTheDocument()
  })

  it('reconciles the selection when a link is removed and never shows that child again', async () => {
    const view = renderFamily('/parent/matches')
    await userEvent.selectOptions(await screen.findByRole('combobox'), 'Zara')
    expect(await screen.findByText('Zara opposition')).toBeInTheDocument()
    server.use(http.get(endpoint('player_parent_links'), () => HttpResponse.json([{ player_user_id: 'Alex' }])))
    await act(async () => { await view.client.invalidateQueries({ queryKey: ['parent', 'parent-a', 'children'] }) })
    expect(await screen.findByText('Alex opposition')).toBeInTheDocument()
    expect(screen.queryByText('Zara opposition')).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Zara' })).not.toBeInTheDocument()
  })

  it('picks up a newly linked second child on navigation without signing in again', async () => {
    server.use(http.get(endpoint('player_parent_links'), () => HttpResponse.json([{ player_user_id: 'Alex' }])))
    renderFamily('/parent/matches')
    expect(await screen.findByText('Alex opposition')).toBeInTheDocument()
    expect(screen.getAllByRole('option')).toHaveLength(1)
    installFamily()
    await userEvent.click(screen.getByRole('tab', { name: 'Profile' }))
    // TRAK-181: Profile lists the new child; the picker for following them is on the other tabs.
    const connections = await screen.findByRole('list', { name: 'Linked children' })
    expect(await within(connections).findByText('Zara')).toBeInTheDocument()
    expect(screen.getByText('Parent account · 2 children linked')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('tab', { name: 'Events' }))
    expect(await screen.findByRole('option', { name: 'Zara' })).toBeInTheDocument()
    await userEvent.selectOptions(screen.getByRole('combobox'), 'Zara')
    expect(screen.getByRole('combobox')).toHaveValue('Zara')
  })
})

// TRAK-74 (decision 25 Sep): alerts are a bell at the top of parent Home, not a tab.
// TRAK-163: the bell is Arc's notification center; its badge says "N unread".
describe('parent alerts bell', () => {
  beforeEach(() => localStorage.clear())
  const openAlerts = async () => {
    await userEvent.click(await screen.findByRole('button', { name: /^Alerts/ }))
    return screen.findByRole('dialog', { name: 'Alerts' })
  }

  // TRAK-436: a match reaches the bell as the coach's review, so there is no "Match logged".
  it("counts the selected child's unseen alerts, lists assessments but no awards or logged matches, and Mark all read clears the count", async () => {
    renderFamily()
    expect(await screen.findByRole('region', { name: 'Recorded matches summary' })).toBeInTheDocument() // TRAK-194: Home's match readout
    expect(screen.queryByRole('button', { name: 'Alerts' })).toBeNull()
    expect(await screen.findByRole('button', { name: 'Alerts, 1 unread' })).toBeInTheDocument()
    const sheet = await openAlerts()
    expect(within(sheet).queryByText('Match logged')).toBeNull()
    expect(within(sheet).getByText(/^New assessment from /)).toBeInTheDocument()
    expect(within(sheet).queryByText('Player Of Week')).toBeNull()
    expect(within(sheet).queryByText(/teamwork/)).toBeNull()
    // TRAK-163: Arc's notification center. Closing keeps the count; Mark all read clears it.
    await userEvent.keyboard('{Escape}')
    expect(await screen.findByRole('button', { name: 'Alerts, 1 unread' })).toBeInTheDocument()
    await userEvent.click(within(await openAlerts()).getByRole('button', { name: 'Mark all read' }))
    await userEvent.keyboard('{Escape}')
    expect(await screen.findByRole('button', { name: 'Alerts' })).toBeInTheDocument()

    await followChild('Zara')
    expect(await screen.findByRole('button', { name: 'Alerts, 1 unread' })).toBeInTheDocument()
    const zaraSheet = await openAlerts()
    expect(within(zaraSheet).getByText('New assessment from Coach coach-Zara')).toBeInTheDocument()
    expect(within(zaraSheet).queryByText(/coach-Alex/)).toBeNull()
  })

  it('after Mark all read, counts only what arrives later', async () => {
    const { client } = renderFamily()
    expect(await screen.findByRole('button', { name: 'Alerts, 1 unread' })).toBeInTheDocument()
    await userEvent.click(within(await openAlerts()).getByRole('button', { name: 'Mark all read' }))
    await userEvent.keyboard('{Escape}')
    expect(await screen.findByRole('button', { name: 'Alerts' })).toBeInTheDocument()
    // TRAK-436: the coach publishes his review of a match.
    server.use(...review('Alex', new Date(Date.now() + 60_000).toISOString()))
    await act(async () => { await client.invalidateQueries({ queryKey: ['family-news'] }) })
    expect(await screen.findByRole('button', { name: 'Alerts, 1 unread' })).toBeInTheDocument()
    expect(within(await openAlerts()).getByText('How Alex’s match went')).toBeInTheDocument()
  })

  it("the coach's review opens the match page at the review; an assessment alert shows its bands", async () => {
    server.use(...review('Alex', new Date().toISOString()))
    renderFamily()
    const sheet = await openAlerts()
    await userEvent.click(within(sheet).getByRole('button', { name: /New assessment from / }))
    const bands = within(sheet).getByRole('region', { name: 'Assessment bands' })
    for (const label of ['Work Rate', 'Tactical', 'Attitude', 'Technical', 'Physical', 'Coachability']) {
      expect(within(bands).getByText(label)).toBeInTheDocument()
    }
    // TRAK-436: a row opens its details; "Read review" goes to the match's page, at the review.
    await userEvent.click(await within(sheet).findByRole('button', { name: /How Alex’s match went/ }))
    expect(within(sheet).getByText('Match vs Rivals FC (home) · won 2–1')).toBeInTheDocument()
    await userEvent.click(await within(sheet).findByRole('button', { name: 'Read review' }))
    expect(await screen.findByText('Event page game-Alex')).toBeInTheDocument()
  })

  it('shows a failed read as an error, never as no alerts', async () => {
    server.use(http.get(endpoint('coach_assessments'), fail))
    renderFamily()
    // Home shows the failure; the bell claims no count from the half that loaded.
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Alerts' })).toBeInTheDocument()
    const sheet = await openAlerts()
    expect(await within(sheet).findByRole('alert')).toHaveTextContent("Couldn't load alerts")
    expect(within(sheet).queryByText('No alerts yet')).toBeNull()
  })
})

// J8.11 (TRAK-134): the bell also lists the selected child's events: new,
// changed (with the new time) or cancelled, counted by the same seen rule.
describe('J8.11 events in the parent alerts bell', () => {
  let eventsFor: Record<string, Record<string, unknown>[]>
  const eventRow = (child: string, over: Record<string, unknown> = {}) => ({
    id: `event-${child}`, event_type: 'training', title: 'Training', event_date: '2099-11-16', start_time: '18:00:00',
    starts_at: '2099-11-16T14:00:00Z', meet_time: null, venue: 'Main pitch', kit: null, opponent: null, home_away: null,
    status: 'scheduled', cancel_reason: null, sequence: 1, updated_at: '2026-09-19T10:00:00Z', ...over,
  })
  beforeEach(() => {
    localStorage.clear()
    eventsFor = { Alex: [eventRow('Alex')] }
    server.use(http.post(endpoint('rpc/child_events'), async ({ request }) => {
      const { p_child } = await request.json() as { p_child: string }
      return HttpResponse.json(eventsFor[p_child] ?? [])
    }))
  })
  const openAlerts = async () => {
    await userEvent.click(await screen.findByRole('button', { name: /^Alerts/ }))
    return screen.findByRole('dialog', { name: 'Alerts' })
  }

  it('counts a newly published event and says what it is', async () => {
    renderFamily()
    expect(await screen.findByRole('button', { name: 'Alerts, 2 unread' })).toBeInTheDocument()
    const sheet = await openAlerts()
    expect(within(sheet).getByText('New: Training')).toBeInTheDocument()
    expect(within(sheet).getByText('Mon 16 Nov, 18:00 · Main pitch')).toBeInTheDocument()
  })

  it('the coach moves it: one more on the next load, saying "Changed" and the new time; Mark all read clears it', async () => {
    const { client } = renderFamily()
    expect(await screen.findByRole('button', { name: 'Alerts, 2 unread' })).toBeInTheDocument()
    await userEvent.click(within(await openAlerts()).getByRole('button', { name: 'Mark all read' }))
    await userEvent.keyboard('{Escape}')
    expect(await screen.findByRole('button', { name: 'Alerts' })).toBeInTheDocument()

    eventsFor = { Alex: [eventRow('Alex', {
      start_time: '18:30:00', starts_at: '2099-11-16T14:30:00Z', sequence: 2,
      updated_at: new Date(Date.now() + 60_000).toISOString(),
    })] }
    await act(async () => { await client.invalidateQueries({ queryKey: ['parent', 'parent-a', 'Alex', 'events'] }) })
    expect(await screen.findByRole('button', { name: 'Alerts, 1 unread' })).toBeInTheDocument()
    const sheet = await openAlerts()
    expect(within(sheet).getByText('Changed: Training')).toBeInTheDocument()
    expect(within(sheet).getByText('Now Mon 16 Nov, 18:30 · Main pitch')).toBeInTheDocument()
    await userEvent.click(within(sheet).getByRole('button', { name: 'Mark all read' }))
    await userEvent.keyboard('{Escape}')
    expect(await screen.findByRole('button', { name: 'Alerts' })).toBeInTheDocument()
  })

  it('says "Cancelled" with the reason', async () => {
    eventsFor = { Alex: [eventRow('Alex', { status: 'cancelled', cancel_reason: 'Pitch closed', sequence: 3 })] }
    renderFamily()
    const sheet = await openAlerts()
    expect(await within(sheet).findByText('Cancelled: Training')).toBeInTheDocument()
    expect(within(sheet).getByText('Mon 16 Nov, 18:00 · Pitch closed')).toBeInTheDocument()
  })

  it('an event alert opens that event', async () => {
    renderFamily()
    const sheet = await openAlerts()
    await userEvent.click(await within(sheet).findByRole('button', { name: /New: Training/ }))
    await userEvent.click(await within(sheet).findByRole('button', { name: 'Open event' }))
    expect(await screen.findByText('Event page event-Alex')).toBeInTheDocument()
    // Live run, 19 Oct (Tarek): opened from Home's bell, the event page's Back returns to Home.
    expect(screen.getByText('Opened from /parent/home')).toBeInTheDocument()
  })

  // TRAK-163 (Tarek's review): read state is per child (TRAK-74). Siblings on one
  // squad share an event; marking it read for one child leaves it unread for the other.
  it('marking all read for one child leaves the same event unread for the sibling', async () => {
    eventsFor = { Alex: [eventRow('Alex', { id: 'event-shared' })], Zara: [eventRow('Zara', { id: 'event-shared' })] }
    renderFamily()
    expect(await screen.findByRole('button', { name: 'Alerts, 2 unread' })).toBeInTheDocument()
    await userEvent.click(within(await openAlerts()).getByRole('button', { name: 'Mark all read' }))
    await userEvent.keyboard('{Escape}')
    expect(await screen.findByRole('button', { name: 'Alerts' })).toBeInTheDocument()
    await followChild('Zara')
    expect(await screen.findByRole('button', { name: 'Alerts, 2 unread' })).toBeInTheDocument()
    expect(within(await openAlerts()).getByText('New: Training')).toBeInTheDocument()
  })

  it("shows only the selected child's events", async () => {
    eventsFor = { Alex: [eventRow('Alex', { title: 'Finishing' })], Zara: [eventRow('Zara', { title: 'Fitness' })] }
    renderFamily()
    const alexSheet = await openAlerts()
    expect(await within(alexSheet).findByText('New: Finishing')).toBeInTheDocument()
    expect(within(alexSheet).queryByText(/Fitness/)).toBeNull()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    await followChild('Zara')
    expect(await screen.findByRole('button', { name: 'Alerts, 2 unread' })).toBeInTheDocument()
    const zaraSheet = await openAlerts()
    expect(within(zaraSheet).getByText('New: Fitness')).toBeInTheDocument()
    expect(within(zaraSheet).queryByText(/Finishing/)).toBeNull()
  })

  it('a failed events read is an error in the bell, never a count without them', async () => {
    server.use(http.post(endpoint('rpc/child_events'), fail))
    renderFamily()
    expect(await screen.findByRole('region', { name: 'Recorded matches summary' })).toBeInTheDocument() // TRAK-194: Home's match readout
    await waitFor(() => expect(screen.getAllByRole('alert').length).toBeGreaterThan(0))
    expect(screen.getByRole('button', { name: 'Alerts' })).toBeInTheDocument()
    const sheet = await openAlerts()
    expect(await within(sheet).findByRole('alert')).toHaveTextContent("Couldn't load alerts")
  })
})

// J7 (TRAK-10): a parent open is the child's latest assessment on screen.
describe('J7 parent open', () => {
  const views = async () => {
    const { trackEvent } = await import('@/lib/telemetry')
    return vi.mocked(trackEvent).mock.calls.filter(([type]) => type === 'assessment_viewed').map(([, meta]) => meta)
  }
  beforeEach(async () => { const { trackEvent } = await import('@/lib/telemetry'); vi.mocked(trackEvent).mockClear() })

  it('records the shown assessment once, and the sibling\'s when the parent switches child', async () => {
    renderFamily()
    expect(await screen.findByText('Alex academy · U15')).toBeInTheDocument()
    await waitFor(async () => expect(await views()).toEqual([{ assessment_id: 'assessment-Alex' }]))
    await followChild('Zara')
    expect(await screen.findByText('Zara academy · U15')).toBeInTheDocument()
    await waitFor(async () => expect(await views()).toEqual([{ assessment_id: 'assessment-Alex' }, { assessment_id: 'assessment-Zara' }]))
  })

  it('records nothing when the assessment failed to load or there is none', async () => {
    server.use(http.get(endpoint('coach_assessments'), fail))
    const failed = renderFamily()
    expect(await screen.findByRole('button', { name: /retry|try again/i })).toBeInTheDocument()
    expect(await views()).toEqual([])
    failed.unmount()

    server.use(http.get(endpoint('coach_assessments'), () => HttpResponse.json([])))
    renderFamily()
    expect(await screen.findByText('No coach assessments yet.')).toBeInTheDocument()
    expect(await views()).toEqual([])
  })
})

describe('parent loading, empty and error states', () => {
  it('shows loading until links resolve, then a genuine empty family', async () => {
    let release!: () => void
    const pending = new Promise<void>(resolve => { release = resolve })
    server.use(http.get(endpoint('player_parent_links'), async () => { await pending; return HttpResponse.json([]) }))
    renderFamily('/parent/matches')
    expect(screen.getByRole('status')).toHaveTextContent('Loading')
    expect(screen.queryByText('No child has signed up yet')).not.toBeInTheDocument()
    await act(async () => { release(); await pending })
    expect(await screen.findByText('No child has signed up yet')).toBeInTheDocument()
    expect(screen.queryByText('No matches yet.')).not.toBeInTheDocument()
  })

  it('shows a links failure rather than claiming there is no child, then retries', async () => {
    server.use(http.get(endpoint('player_parent_links'), fail))
    renderFamily('/parent/matches')
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load your linked children")
    expect(screen.queryByText('No child has signed up yet')).not.toBeInTheDocument()
    installFamily()
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('Alex opposition')).toBeInTheDocument()
  })

  it.each(['player_details', 'squad_players', 'coach_assessments', 'recognition_awards'])(
    'does not turn a %s subquery failure into empty development data', async table => {
      server.use(http.get(endpoint(table), fail))
      renderFamily()
      expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load this child's information")
      expect(screen.queryByText('No coach assessments yet.')).not.toBeInTheDocument()
      expect(screen.queryByText(/No matches yet/)).not.toBeInTheDocument()
    },
  )

  it('clears the previous child when the selected child has no records', async () => {
    server.use(http.get(endpoint('matches'), ({ request }) => HttpResponse.json(
      new URL(request.url).searchParams.get('user_id') === 'eq.Alex' ? [match('Alex')] : [],
    )))
    renderFamily('/parent/matches')
    expect(await screen.findByText('Alex opposition')).toBeInTheDocument()
    await userEvent.selectOptions(screen.getByRole('combobox'), 'Zara')
    expect(screen.queryByText('Alex opposition')).not.toBeInTheDocument()
    expect(await screen.findByText('No matches yet.')).toBeInTheDocument()
  })

  it('shows a matches failure and can recover without changing child', async () => {
    server.use(http.get(endpoint('matches'), fail))
    renderFamily('/parent/matches')
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load matches")
    expect(screen.queryByText('No matches yet.')).not.toBeInTheDocument()
    installFamily()
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('Alex opposition')).toBeInTheDocument()
  })

  // TRAK-73 (Kostas's #182 review): Profile shows each family state once, not
  // once for withdrawal and again for Connections.
  it('shows the empty family and a links failure once on Profile', async () => {
    server.use(http.get(endpoint('player_parent_links'), () => HttpResponse.json([])))
    const empty = renderFamily('/parent/profile')
    expect(await screen.findAllByText('No child has signed up yet')).toHaveLength(1)
    empty.unmount()

    server.use(http.get(endpoint('player_parent_links'), fail))
    renderFamily('/parent/profile')
    expect(await screen.findAllByRole('alert')).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: 'Retry' })).toHaveLength(1)
  })

  it('reports an offline failure instead of leaving a paused loading screen forever', async () => {
    onlineManager.setOnline(false)
    server.use(http.get(endpoint('player_parent_links'), () => HttpResponse.error()))
    renderFamily('/parent/matches')
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load your linked children")
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})

describe('truthful parent ratings', () => {
  it('includes a newly logged backfilled match among the latest 20 match alerts', async () => {
    const historicalMatches = Array.from({ length: 20 }, (_, index) => ({
      ...match(`Fixture ${index + 1}`),
      match_date: `2026-09-${String(20 - index).padStart(2, '0')}`,
      created_at: `2026-09-${String(20 - index).padStart(2, '0')}T10:00:00Z`,
    }))
    server.use(http.get(endpoint('matches'), () => HttpResponse.json([
      ...historicalMatches,
      { ...match('Backfilled'), match_date: '2026-08-01', created_at: '2026-09-21T10:00:00Z' },
    ])))
    const { client } = renderFamily('/parent/alerts')
    expect(await screen.findByText('vs Backfilled opposition · 0–0')).toBeInTheDocument()
    const alerts = screen.getAllByText('Match logged')
    expect(alerts).toHaveLength(20)
    expect(alerts[0].parentElement).toHaveTextContent('vs Backfilled opposition')
    expect(screen.queryByText('vs Fixture 20 opposition · 0–0')).not.toBeInTheDocument()
    // Alerts must not reorder the shared match cache used by the Matches view.
    // Assert before navigation: a mount refetch could hide an in-place mutation.
    const cachedMatches = client.getQueryData<{ id: string }[]>(['parent', 'parent-a', 'Alex', 'matches'])
    expect(cachedMatches?.map(row => row.id)).toEqual([
      ...historicalMatches.map(row => row.id), 'match-Backfilled',
    ])
    await userEvent.click(screen.getByRole('tab', { name: 'Events' }))
    expect((await screen.findAllByText(/opposition/))[0]).toHaveTextContent('Fixture 1 opposition')
  })

  it('shows zero as Difficult, null as Not rated, and uses the match date', async () => {
    server.use(http.get(endpoint('matches'), () => HttpResponse.json([
      match('Zero', 0), { ...match('Unknown', null), team_score: null, opponent_score: null },
    ])))
    renderFamily('/parent/matches')
    expect(await screen.findByText('Difficult')).toBeInTheDocument()
    expect(screen.getByText('Not rated')).toBeInTheDocument()
    expect(screen.getByText('Score not recorded')).toBeInTheDocument()
    expect(screen.getByText('D 0–0')).toBeInTheDocument()
    expect(screen.getAllByText('1 Sept · League')).toHaveLength(2)
  })

  it('does not replace a missing rating in the average and preserves zero assessment categories', async () => {
    server.use(http.get(endpoint('matches'), () => HttpResponse.json([match('Zero', 0), match('Unknown', null)])))
    renderFamily()
    const summary = await screen.findByRole('region', { name: 'Recorded matches summary' })
    expect(within(summary).getByText('Difficult')).toBeInTheDocument()
    const development = screen.getByRole('region', { name: 'Latest coach assessment' })
    expect(within(development).getAllByText('Difficult')).toHaveLength(7)
    expect(screen.queryByText('Steady')).not.toBeInTheDocument()
  })
})

/** TRAK-437: the position under the child's name is the one the coach set, never the one saved at sign-up. */
describe('TRAK-437: the parent Home shows the coach\'s position', () => {
  const plan = (position: string | null) => ({
    squad_player_id: 'squad-Alex', squad: 'U15', coach_name: 'Coach Rami', time_zone: 'Asia/Dubai', starts_on: '2026-09-01', ends_on: '2027-06-30',
    eval_every: 'month', eval_day: 0, last_evaluation_on: null, position, also_plays: [], roles: [], season_objectives: [], objectives: [],
    is_new: false, shared_at: '2026-11-01T10:00:00Z',
  })

  it('shows the position the coach set for the selected child', async () => {
    server.use(http.post(endpoint('rpc/season_plan_for_player'), async ({ request }) => {
      const { p_child: child } = await request.json() as { p_child?: string }
      return HttpResponse.json(child === 'Alex' ? [plan('Midfielder')] : [])
    }))
    renderFamily()
    expect(await screen.findByText('Midfielder · Alex academy · U15')).toBeInTheDocument()
    expect(screen.queryByText(/^mid · /)).toBeNull()
  })

  it('shows no position when the coach has set none', async () => {
    server.use(http.post(endpoint('rpc/season_plan_for_player'), () => HttpResponse.json([plan(null)])))
    renderFamily()
    expect(await screen.findByText('Alex academy · U15')).toBeInTheDocument()
  })
})
