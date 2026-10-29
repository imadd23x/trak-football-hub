import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { addDays, format, parseISO } from 'date-fns'
import { CoachWeekStrip } from '../CoachWeekStrip'
import { weekDays } from '@/components/trak/WeekStrip'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { KIT_COLLECTIONS, snapshotKit } from '@/lib/kit-templates'

// TRAK-176: coach screens read the coach's squads through the query cache.
function queries() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return { wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> }
}

type Row = Record<string, unknown>
type Reply = { data: Row[] | null; error: unknown }

const database = vi.hoisted(() => ({
  read: vi.fn<(table: string, coachId: string, filter?: string) => Promise<Reply>>(),
  // Imad, 23 Oct: a logged match's log reads its players through logged_match.
  rpc: vi.fn<(name: string) => Promise<Reply>>(async () => ({ data: [], error: null })),
}))

// The feature switch is independent of how the enabled strip loads its week. TRAK-288: Games off, so a match is logged.
vi.mock('@/components/trak/parked', () => ({ useFeature: (feature?: string) => feature !== 'games' }))
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    rpc: (name: string) => database.rpc(name),
    from: (table: string) => {
      let coachId = ''
      let id: string | undefined
      let filter: string | undefined
      const query = {
        select: () => query,
        eq: (column: string, value: string) => {
          if (column === 'coach_user_id') coachId = value
          if (column === 'id') id = value
          return query
        },
        // One row, as the session log reads its session.
        maybeSingle: () => database.read(table, coachId, filter)
          .then(reply => ({ data: reply.data?.find(row => row.id === id) ?? null, error: reply.error })),
        gte: () => query,
        lte: () => query,
        or: (value: string) => { filter = value; return query },
        order: () => query,
        then: (resolve: (reply: Reply) => unknown, reject?: (error: unknown) => unknown) =>
          database.read(table, coachId, filter).then(resolve, reject),
      }
      return query
    },
  },
}))

const monday = weekDays(new Date())[0]
const today = format(new Date(), 'yyyy-MM-dd')
const planned = (coachId = 'coach-1'): Row => ({
  id: `planned-${coachId}`, coach_user_id: coachId, event_type: 'training',
  title: 'Planned training', event_date: monday, start_time: '18:00',
  published: true, status: 'scheduled',
})
const session = (id: string, title: string, type: string, date = monday): Row => ({
  id, title, session_type: type, session_date: date, coach_user_id: 'coach-1',
  competition: null, venue: null, notes: null,
})
const ok = (data: Row[]): Reply => ({ data, error: null })

function strip(coachId = 'coach-1') {
  return <MemoryRouter><CoachWeekStrip coachId={coachId} /></MemoryRouter>
}

async function chooseMonday() {
  const name = format(parseISO(monday), 'EEEE d MMMM')
  fireEvent.click(await screen.findByRole('button', { name: new RegExp(name) }))
}

// TRAK-262: tapping an event picks it; Details opens its sheet.
async function openDetails(name: RegExp) {
  fireEvent.click(await screen.findByRole('button', { name }))
  fireEvent.click(screen.getByRole('button', { name: 'Details' }))
}

describe('TRAK-171: coach Home week includes logged sessions', () => {
  beforeEach(() => {
    database.read.mockReset()
    // Motion preserves scroll position while opening; jsdom has no scrolling.
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  })
  afterEach(() => vi.restoreAllMocks())

  it('shows logged training and match sessions alongside planned events, opening each saved session', async () => {
    database.read.mockImplementation(async table => ok(table === 'coach_calendar_events' ? [planned()]
      : table === 'squad_players' ? [{ id: 'sp-1', player_name: 'Bukayo Saka' }, { id: 'sp-2', player_name: 'Beth Mead' }]
      : table === 'session_attendance' ? [{ squad_player_id: 'sp-1', status: 'present' }, { squad_player_id: 'sp-2', status: 'absent' }]
      : [session('saved-training', 'Logged training', 'training'), session('saved-match', 'Logged match', 'match')]))
    render(strip(), queries())
    await chooseMonday()

    expect(await screen.findByRole('button', { name: /Planned training/ })).toBeInTheDocument()
    // TRAK-182 (Imad, 16 Oct): a logged session opens its sheet too, which says so. Imad, 23 Oct: the sheet shows
    // the log, read only, with Edit log (it used to say only who came, with Open session).
    database.rpc.mockResolvedValue(ok([{ user_id: 'u-1', player_name: 'Bukayo Saka', competition: 'League', venue: 'Home', opponent: 'Rovers',
      goals: 1, assists: 0, card_received: 'None', team_score: 2, opponent_score: 0, played: true }]))
    for (const [title, id] of [['Logged training', 'saved-training'], ['Logged match', 'saved-match']]) {
      await openDetails(new RegExp(title))
      const sheet = await screen.findByRole('dialog', { name: title })
      expect(within(sheet).getByText('Logged.')).toBeInTheDocument()
      expect(await within(sheet).findByRole('link', { name: 'Edit log' })).toHaveAttribute('href', `/coach/sessions/${id}`)
      if (id === 'saved-training') {
        // TRAK-182 (live run 3): who came and who didn't, from the saved register.
        expect(await within(sheet).findByText('Attended · 1')).toBeInTheDocument()
        expect(within(sheet).getByText("Didn't come · 1")).toBeInTheDocument()
        fireEvent.click(within(sheet).getByRole('button', { name: "Show names: Didn't come" }))
        expect(within(within(sheet).getByRole('list', { name: "Didn't come" })).getByText('Beth Mead')).toBeInTheDocument()
      } else {
        // A match's log: the score and who scored.
        expect(within(sheet).getByText('2–0')).toBeInTheDocument()
        expect(within(sheet).getByText('1 goal')).toBeInTheDocument()
      }
      fireEvent.keyDown(sheet, { key: 'Escape' })
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    }
  })

  it('shows Retry when the session read fails, then restores the complete week after retry', async () => {
    let sessionsFailed = true
    database.read.mockImplementation(async table => table === 'coach_calendar_events'
      ? ok([planned()])
      : sessionsFailed ? { data: null, error: new Error('Session read failed') }
        : ok([session('recovered', 'Recovered session', 'training')]))
    render(strip(), queries())

    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn't load this week/i)
    expect(screen.queryByText('Nothing planned')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Planned training/ })).not.toBeInTheDocument()
    sessionsFailed = false
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await chooseMonday()
    expect(await screen.findByRole('button', { name: /Recovered session/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Planned training/ })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows a completed planned event once as its logged session, without inventing a session time', async () => {
    database.read.mockImplementation(async table => ok(table === 'coach_calendar_events'
      ? [planned()]
      : [{ ...session('completed-training', 'Completed training', 'training'), event_id: 'planned-coach-1' }]))
    render(strip(), queries())
    await chooseMonday()

    const trigger = await screen.findByRole('button', { name: /Completed training/ })
    expect(screen.getAllByRole('button', { name: /Completed training/ })).toHaveLength(1)
    expect(trigger).toHaveTextContent(/Logged/)
    expect(trigger).not.toHaveTextContent(/18:00|Time to be confirmed/)
    expect(screen.queryByRole('button', { name: /Planned training/ })).not.toBeInTheDocument()
    await openDetails(/Completed training/)
    const sheet = await screen.findByRole('dialog', { name: 'Completed training' })
    expect(await within(sheet).findByRole('link', { name: 'Edit log' })).toHaveAttribute('href', '/coach/sessions/completed-training')
    expect(within(sheet).queryByText(/18:00|Time to be confirmed/)).not.toBeInTheDocument()
  })

  it("TRAK-182: a logged match from its planned event shows the event's kick-off, venue and kit", async () => {
    database.read.mockImplementation(async table => ok(table === 'coach_calendar_events'
      ? [{ ...planned(), id: 'planned-match', event_type: 'match', title: 'vs Rovers', opponent: 'Rovers', home_away: 'away', kit: 'White shirts', venue: 'Rovers Park' }]
      : table === 'coach_sessions' ? [{ ...session('logged-match', 'vs Rovers', 'match'), event_id: 'planned-match', venue: null }]
      : []))
    render(strip(), queries())
    await chooseMonday()
    await openDetails(/vs Rovers/)
    const sheet = await screen.findByRole('dialog', { name: /Rovers/ })
    expect(within(sheet).getByText('Kick-off')).toBeInTheDocument()
    expect(within(sheet).getByText('18:00')).toBeInTheDocument()
    expect(within(sheet).getByText(/Rovers Park/)).toBeInTheDocument()
    expect(within(sheet).getByText('White shirts')).toBeInTheDocument()
    expect(within(sheet).getByText('Logged.')).toBeInTheDocument()
  })

  it('keeps the selected kit illustration when a planned match becomes a logged match', async () => {
    database.read.mockImplementation(async table => ok(table === 'coach_calendar_events'
      ? [{ ...planned(), id: 'planned-kit', event_type: 'match', title: 'vs Synthetic United', opponent: 'Synthetic United',
        kit_snapshot: snapshotKit(KIT_COLLECTIONS[0].kits, 'alternate') }]
      : table === 'coach_sessions' ? [{ ...session('logged-kit', 'vs Synthetic United', 'match'), event_id: 'planned-kit' }] : []))
    render(strip(), queries())
    await chooseMonday()
    await openDetails(/Synthetic United/)
    const sheet = await screen.findByRole('dialog', { name: /Synthetic United/ })
    expect(within(sheet).getByRole('heading', { name: 'Alternate kit' })).toBeInTheDocument()
    expect(within(sheet).getByText('Logged.')).toBeInTheDocument()
  })

  it('does not let a late response restore the previous coach’s sessions after an account change', async () => {
    let releaseSessions!: (reply: Reply) => void
    const previousCoachSessions = new Promise<Reply>(resolve => { releaseSessions = resolve })
    database.read.mockImplementation((table, coachId) => {
      if (table === 'coach_sessions' && coachId === 'coach-1') return previousCoachSessions
      return Promise.resolve(ok(table === 'coach_sessions'
        ? [session('new-coach', 'Current coach session', 'match', today)] : []))
    })
    const view = render(strip(), queries())
    // Finish the immediate calendar response; the first session read remains pending.
    await act(async () => {})
    view.rerender(strip('coach-2'))
    expect(await screen.findByRole('button', { name: /Current coach session/ })).toBeInTheDocument()

    await act(async () => releaseSessions(ok([session('old-coach', 'Previous coach private session', 'match', today)])))
    expect(screen.getByRole('button', { name: /Current coach session/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Previous coach private session/ })).not.toBeInTheDocument()
  })

  it('does not restore a completed planned event when its linked session moves outside this week', async () => {
    const moved = {
      ...session('moved-training', 'Moved completed training', 'training', format(addDays(parseISO(monday), 7), 'yyyy-MM-dd')),
      event_id: 'planned-coach-1',
    }
    // The server only returns an out-of-week session if its event link is queried.
    database.read.mockImplementation(async (table, _coachId, filter) => ok(table === 'coach_calendar_events'
      ? [planned()]
      : filter?.includes('event_id') && filter.includes('planned-coach-1') ? [moved] : []))
    render(strip(), queries())
    await chooseMonday()

    expect(screen.queryByRole('button', { name: /Planned training/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Moved completed training/ })).not.toBeInTheDocument()
    // The day left behind can still be leaving; Monday's own list is the one that counts.
    const list = screen.getByRole('list', { name: `Events on ${format(parseISO(monday), 'EEEE d MMMM')}` })
    expect(within(list).getByText('Nothing planned')).toBeInTheDocument()
  })

  it('TRAK-176: with two squads, the week shows the squad picked and whole-roster events only', async () => {
    database.read.mockImplementation(async table => ok(
      table === 'squad_players' ? [{ age_group: 'U14', status: 'active' }, { age_group: 'U16', status: 'active' }]
      : table === 'coach_calendar_events' ? [
        { ...planned(), id: 'e-u14', title: 'U14 training', squad: 'U14' },
        { ...planned(), id: 'e-u16', title: 'U16 training', squad: 'U16' },
        { ...planned(), id: 'e-all', title: 'Whole roster training', squad: null },
      ]
      : [{ ...session('s-u14', 'U14 logged', 'training'), squad: 'U14' }, { ...session('s-u16', 'U16 logged', 'match'), squad: 'U16' }]))
    localStorage.setItem('trak:coach-squad:coach-1', 'U16')
    localStorage.setItem('trak:coach-squad-all:coach-1', '0')
    try {
      render(strip(), queries())
      await chooseMonday()
      expect(await screen.findByRole('button', { name: /U16 training/ })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /Whole roster training/ })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /U16 logged/ })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /U14/ })).toBeNull()
    } finally { localStorage.clear() }
  })

  // TRAK-266 (Imad, 22 Oct): the colour key's badges only where the coach is needed.
  it('badges a started event with no register (Needs you) and a clashing draft (Clashes), and nothing else', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-22T12:00:00Z'))
    try {
      const at = (id: string, title: string, date: string, time: string, extra: Row = {}) => ({
        id, coach_user_id: 'coach-1', event_type: 'training', title, event_date: date, start_time: `${time}:00`,
        starts_at: `${date}T${time}:00Z`, published: true, status: 'scheduled', squad: null, ...extra })
      database.read.mockImplementation(async table => ok(table === 'coach_calendar_events' ? [
        at('started', 'Tuesday training', '2026-10-20', '14:00'),
        at('live', 'Friday training', '2026-10-23', '14:00', { ends_at: '2026-10-23T15:30:00Z' }),
        at('draft', 'Friday extra', '2026-10-23', '15:00', { published: false }),
      ] : []))
      render(strip(), queries())
      fireEvent.click(await screen.findByRole('button', { name: /Tuesday 20 October/ }))
      expect(await screen.findByRole('button', { name: /Tuesday training/ })).toHaveTextContent('Needs you')
      fireEvent.click(screen.getByRole('button', { name: /Friday 23 October/ }))
      expect(await screen.findByRole('button', { name: /Friday extra/ })).toHaveTextContent('Clashes')
      expect(screen.getByRole('button', { name: /Friday training/ })).not.toHaveTextContent(/Needs you|Clashes/)
    } finally { vi.useRealTimers() }
  })
})
