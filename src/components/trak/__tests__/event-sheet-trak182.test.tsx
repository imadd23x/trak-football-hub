/**
 * TRAK-182 (Imad, 15 Oct): an event on Home opens in a bottom sheet where it
 * is, instead of "Open" taking the coach to the whole calendar. The coach
 * sees Publish / Published, Copy WhatsApp link, Edit and Attending (coming /
 * can't make it); families see "Confirmed." and never other children's names.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { format, parseISO } from 'date-fns'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { http, HttpResponse } from 'msw'
import { server } from '../../../../tests/msw/server'
import { SUPABASE_URL } from '../../../../tests/msw/supabase'
import { LoadedWeekStrip, WeekStrip, weekDays, type StripEvent } from '@/components/trak/WeekStrip'
import { EventSheet } from '@/components/trak/EventSheet'
import { EventSheetCoach } from '@/components/coach/EventSheetCoach'

// TRAK-426: the sheet asks whether the old log has retired (Training and Matches both on). Rendered here without the
// signed-in frame, so it answers "not retired": these checks are about the sheet, not the switches.
vi.mock('@/components/coach/old-log', () => ({ useOldLogRetired: () => ({ retired: false, known: true }) }))

const endpoint = (name: string) => `${SUPABASE_URL}/rest/v1/${name}`
const today = new Date()
const day = weekDays(today).find(d => d >= today.toLocaleDateString('en-CA')) ?? weekDays(today)[6]
const event = (over: Partial<StripEvent>): StripEvent => ({
  id: 'ev-1', kind: 'match', title: 'League', date: day, time: '17:00', meetTime: '16:15', venue: 'Rivals Park',
  kit: 'White', opponent: 'Rivals FC', homeAway: 'away', status: 'scheduled', cancelReason: null, sequence: 0,
  updatedAt: null, familyNote: 'Bring water', ...over,
})
const row = (over: Record<string, unknown>) => ({
  id: 'ev-1', coach_user_id: 'coach-1', event_type: 'match', title: 'League', event_date: day, start_time: '17:00:00',
  starts_at: '2099-01-01T13:00:00Z', published: false, status: 'scheduled', series_id: null, ...over,
})

let eventRow: Record<string, unknown>
let patched: Record<string, unknown>[]
beforeEach(() => {
  eventRow = row({}); patched = []
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  server.use(
    http.get(endpoint('coach_calendar_events'), () => HttpResponse.json(eventRow)),
    http.patch(endpoint('coach_calendar_events'), async ({ request }) => {
      patched.push(await request.json() as Record<string, unknown>)
      eventRow = { ...eventRow, published: true }
      return HttpResponse.json([{ id: 'ev-1' }])
    }),
    // No register yet: zero rows, as PostgREST answers maybeSingle().
    http.get(endpoint('coach_sessions'), () => HttpResponse.json([])),
    // Everyone's consent is active unless a test says otherwise (as the register checks).
    http.post(`${SUPABASE_URL}/rest/v1/rpc/coach_squad_player_consent_required`, () => HttpResponse.json(false)),
    http.get(endpoint('squad_players'), () => HttpResponse.json([
      { id: 'sp-1', player_name: 'Bukayo Saka', age_group: 'U14', status: 'active' }, { id: 'sp-2', player_name: 'Beth Mead', age_group: 'U14', status: 'active' },
      { id: 'sp-3', player_name: 'Cole Palmer', age_group: 'U14', status: 'active' }, { id: 'sp-4', player_name: 'Declan Rice', age_group: 'U14', status: 'coach_departed' }])),
    http.get(endpoint('session_attendance'), () => HttpResponse.json([{ squad_player_id: 'sp-1', status: 'present' }, { squad_player_id: 'sp-3', status: 'absent' }])),
    http.get(endpoint('event_absences'), () => HttpResponse.json([{ squad_player_id: 'sp-2', reason: 'school' }])),
  )
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers() })

/** "Updated 3h ago" is yesterday shortly after midnight (Tarek, #369, 19 Oct): pin
 *  Date at noon on the same day. Only Date is faked; animation timers stay real. */
function atNoonToday() {
  const noon = new Date(today)
  noon.setHours(12, 0, 0, 0)
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(noon)
}

function Where() { return <p data-testid="where">{useLocation().pathname + useLocation().search}</p> }
function From() { return <p data-testid="from">{(useLocation().state as { from?: string } | null)?.from}</p> }
function renderStrip(events: StripEvent[], role: 'coach' | 'parent') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/home']}>
    <Routes><Route path="/parent/event/:id" element={<From />} /><Route path="*" element={<>
      <WeekStrip events={events} today={new Date(`${day}T12:00:00`)} renderSheet={(e, trigger) => (
        <EventSheet event={e} role={role} trigger={trigger}>
          {role === 'coach' && <EventSheetCoach event={e} coachId="coach-1" onChanged={() => {}} />}
        </EventSheet>
      )} />
      <Where />
    </>} /></Routes>
  </MemoryRouter></QueryClientProvider>)
}

describe('TRAK-182: the event sheet', () => {
  it('opens the coach\'s event where it is, not the calendar, and publishes a draft', async () => {
    const user = userEvent.setup()
    renderStrip([event({ draft: true })], 'coach')
    await user.click(screen.getByRole('button', { name: /Rivals FC/ }))
    const sheet = await screen.findByRole('dialog', { name: 'vs Rivals FC' })
    expect(screen.getByTestId('where')).toHaveTextContent('/home')
    // Imad, 16 Oct: Away under the opponent, the date at top right, Kick-off over the time.
    expect(within(sheet).getByText('Away')).toBeInTheDocument()
    expect(within(sheet).getByText(format(parseISO(day), 'EEE MMM d'))).toBeInTheDocument()
    expect(within(sheet).getByText('Kick-off')).toBeInTheDocument()
    expect(within(sheet).getByText('17:00')).toBeInTheDocument()
    // TRAK-223: the meet line says how long before kick-off it is.
    const meet = within(sheet).getByText('16:15, 45 min before kick-off')
    expect(meet.compareDocumentPosition(within(sheet).getByRole('link', { name: 'Open in Maps' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(within(sheet).getByText('Draft. Only you see this.')).toBeInTheDocument()
    expect(within(sheet).getByText('White')).toBeInTheDocument()
    expect(await within(sheet).findByText('Families see this once you publish.')).toBeInTheDocument()
    expect(within(sheet).queryByRole('link', { name: 'Share' })).toBeNull()
    expect(within(sheet).queryByRole('button', { name: 'Cancel event' })).toBeNull()
    // TRAK-230: an event still to come is edited from here.
    expect(within(sheet).getByRole('button', { name: 'Edit' })).toBeInTheDocument()
    // TRAK-135: publishing emails families, so the app asks the server to send.
    let nudges = 0
    server.use(http.post(`${SUPABASE_URL}/functions/v1/send-event-emails`, () => { nudges++; return HttpResponse.json({ accepted: true }, { status: 202 }) }))
    await user.click(await within(sheet).findByRole('button', { name: 'Publish' }))
    await waitFor(() => expect(patched).toEqual([{ published: true }]))
    await waitFor(() => expect(nudges).toBe(1))
  })

  it('stays open while the week reloads after Publish', async () => {
    const user = userEvent.setup()
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    // A real reload takes a network round trip; an instant one hides a blanked week.
    const load = vi.fn(async () => { await new Promise(r => setTimeout(r, 50)); return { data: [{ ...eventRow, start_time: '17:00:00', opponent: 'Rivals FC', home_away: 'away', event_type: 'match' }], error: null } })
    render(<QueryClientProvider client={client}><MemoryRouter>
      <LoadedWeekStrip load={load} loadKey="coach-1" renderSheet={(e, trigger, refresh) => (
        <EventSheet event={e} role="coach" trigger={trigger}><EventSheetCoach event={e} coachId="coach-1" onChanged={refresh} /></EventSheet>
      )} />
    </MemoryRouter></QueryClientProvider>)
    await user.click(await screen.findByRole('button', { name: /Rivals FC/ }))
    const sheet = await screen.findByRole('dialog', { name: 'vs Rivals FC' })
    await user.click(await within(sheet).findByRole('button', { name: 'Publish' }))
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2))
    expect(await screen.findByRole('dialog', { name: 'vs Rivals FC' })).toBeInTheDocument()
    expect(await within(screen.getByRole('dialog')).findByRole('button', { name: 'Published' })).toBeDisabled()
  })

  it('shows a published event\'s link, Edit and who is coming', async () => {
    eventRow = row({ published: true, venue: 'Rivals Park', opponent: 'Rivals FC', home_away: 'away' })
    const user = userEvent.setup()
    renderStrip([event({})], 'coach')
    await user.click(screen.getByRole('button', { name: /Rivals FC/ }))
    const sheet = await screen.findByRole('dialog', { name: 'vs Rivals FC' })
    // The Published button says it; no status line repeats it (Imad, 16 Oct).
    expect(within(sheet).queryByText('Published.')).toBeNull()
    expect(await within(sheet).findByRole('button', { name: 'Published' })).toBeDisabled()
    // J8.16's pre-written message, with the event's own link, not a bare link to paste.
    const share = await within(sheet).findByRole('link', { name: 'Share' })
    const text = decodeURIComponent(share.getAttribute('href')!.replace('https://wa.me/?text=', ''))
    expect(text).toContain('U14 Match vs Rivals FC')
    expect(text).toContain('https://trakfootball.com/event/ev-1')
    expect(await within(sheet).findByRole('heading', { name: 'Attending · 2' })).toBeInTheDocument()
    // Avatars only; the names come when the coach taps them.
    expect(within(sheet).queryByRole('list', { name: 'Attending' })).toBeNull()
    await user.click(within(sheet).getByRole('button', { name: 'Show names: Attending' }))
    expect(within(within(sheet).getByRole('list', { name: 'Attending' })).getAllByRole('listitem').map(li => li.textContent))
      .toEqual(['Bukayo Saka', 'Cole Palmer'])
    expect(within(sheet).getByRole('heading', { name: "Can't make it · 1" })).toBeInTheDocument()
    expect(within(sheet).getByText('Beth Mead')).toBeInTheDocument()
    expect(within(sheet).getByText('School')).toBeInTheDocument()
    await user.click(within(sheet).getByRole('button', { name: 'Edit' }))
    expect(screen.getByTestId('where')).toHaveTextContent('/coach/schedule?edit=ev-1')
  })

  it('cancels a published event through Schedule\'s cancel sheet', async () => {
    eventRow = row({ published: true })
    const user = userEvent.setup()
    renderStrip([event({})], 'coach')
    await user.click(screen.getByRole('button', { name: /Rivals FC/ }))
    const sheet = await screen.findByRole('dialog', { name: 'vs Rivals FC' })
    await user.click(await within(sheet).findByRole('button', { name: 'Cancel event' }))
    expect(screen.getByTestId('where')).toHaveTextContent('/coach/schedule?cancel=ev-1')
  })

  // TRAK-182, live run 3 (Imad, 16 Oct): a past event says "Attended", not "Attending" or "Came", and has nothing to share.
  it('shows who attended once the register is taken, and no Cancel or Share after the start', async () => {
    eventRow = row({ published: true, event_type: 'training', title: 'Finishing', starts_at: '2020-01-01T13:00:00Z', event_date: '2020-01-01' })
    server.use(http.get(endpoint('coach_sessions'), () => HttpResponse.json({ id: 'session-1' })))
    const user = userEvent.setup()
    renderStrip([event({ kind: 'training', title: 'Finishing', opponent: null, homeAway: null })], 'coach')
    await user.click(screen.getByRole('button', { name: /Finishing/ }))
    const sheet = await screen.findByRole('dialog', { name: 'Finishing' })
    expect(await within(sheet).findByRole('heading', { name: 'Attended · 1' })).toBeInTheDocument()
    await user.click(within(sheet).getByRole('button', { name: 'Show names: Attended' }))
    expect(within(within(sheet).getByRole('list', { name: 'Attended' })).getAllByRole('listitem').map(li => li.textContent)).toEqual(['Bukayo Saka'])
    expect(within(sheet).getByRole('button', { name: 'Edit register' })).toBeInTheDocument()
    expect(within(sheet).queryByRole('button', { name: 'Cancel event' })).toBeNull()
    expect(within(sheet).queryByRole('link', { name: 'Share' })).toBeNull()
  })

  it('offers no Cancel once a match has started (a match has no register)', async () => {
    eventRow = row({ published: true, starts_at: '2020-01-01T13:00:00Z', event_date: '2020-01-01' })
    const user = userEvent.setup()
    renderStrip([event({ startsAt: '2020-01-01T13:00:00Z' })], 'coach')
    await user.click(screen.getByRole('button', { name: /Rivals FC/ }))
    const sheet = await screen.findByRole('dialog', { name: 'vs Rivals FC' })
    expect(await within(sheet).findByRole('button', { name: 'Published' })).toBeDisabled()
    expect(within(sheet).queryByRole('button', { name: 'Cancel event' })).toBeNull()
    // TRAK-230 (Kostas, 21 Oct, option A): started, so its details are fixed and there's no Edit.
    expect(within(sheet).getByText('It has started, so its details are fixed.')).toBeInTheDocument()
    expect(within(sheet).queryByRole('button', { name: 'Edit' })).toBeNull()
    expect(within(sheet).queryByRole('link', { name: 'Share' })).toBeNull()
    expect(await within(sheet).findByRole('heading', { name: 'Attended · 2' })).toBeInTheDocument()
    // Decided 16 Oct: a past event's sheet has no meet time and no family note; the kit stays.
    expect(within(sheet).queryByText('Meet')).toBeNull()
    expect(within(sheet).queryByText('Bring water')).toBeNull()
    expect(within(sheet).getByText('White')).toBeInTheDocument()
  })

  // Kostas's #310 review: counted as the register counts, and no guessing on a failed read.
  it('counts only children whose consent is active, as the register does', async () => {
    eventRow = row({ published: true })
    server.use(http.post(`${SUPABASE_URL}/rest/v1/rpc/coach_squad_player_consent_required`, async ({ request }) =>
      HttpResponse.json((await request.json() as { p_squad_player_id: string }).p_squad_player_id === 'sp-3')))
    const user = userEvent.setup()
    renderStrip([event({})], 'coach')
    await user.click(screen.getByRole('button', { name: /Rivals FC/ }))
    const sheet = await screen.findByRole('dialog', { name: 'vs Rivals FC' })
    expect(await within(sheet).findByRole('heading', { name: 'Attending · 1' })).toBeInTheDocument()
    // Kostas, 16 Oct: they are on Trak, waiting for consent (a parent's, or their own from the academy's consent age). A count, never names.
    expect(within(sheet).getByText("1 not counted yet: waiting for consent")).toBeInTheDocument()
    expect(within(sheet).queryByText(/Cole/)).toBeNull()
  })

  it('shows an error, not Take register, when the register lookup fails', async () => {
    eventRow = row({ published: true, event_type: 'training', title: 'Finishing', starts_at: '2020-01-01T13:00:00Z', event_date: '2020-01-01' })
    server.use(http.get(endpoint('coach_sessions'), () => HttpResponse.json({ message: 'Synthetic failure' }, { status: 500 })))
    const user = userEvent.setup()
    renderStrip([event({ kind: 'training', title: 'Finishing', opponent: null, homeAway: null })], 'coach')
    await user.click(screen.getByRole('button', { name: /Finishing/ }))
    const sheet = await screen.findByRole('dialog', { name: 'Finishing' })
    expect(await within(sheet).findByRole('alert')).toBeInTheDocument()
    expect(within(sheet).queryByRole('button', { name: 'Take register' })).toBeNull()
  })

  it('says so when the squad is empty', async () => {
    eventRow = row({ published: true })
    server.use(http.get(endpoint('squad_players'), () => HttpResponse.json([])))
    const user = userEvent.setup()
    renderStrip([event({})], 'coach')
    await user.click(screen.getByRole('button', { name: /Rivals FC/ }))
    const sheet = await screen.findByRole('dialog', { name: 'vs Rivals FC' })
    expect(await within(sheet).findByText('No players in your squad yet.')).toBeInTheDocument()
  })

  it('shows a family the event with no coach actions and no other children', async () => {
    const user = userEvent.setup()
    renderStrip([event({})], 'parent')
    await user.click(screen.getByRole('button', { name: /Rivals FC/ }))
    const sheet = await screen.findByRole('dialog', { name: 'vs Rivals FC' })
    expect(within(sheet).queryByText('Confirmed.')).toBeNull()
    expect(within(sheet).getByText('Rivals Park')).toBeInTheDocument()
    expect(within(sheet).getByRole('link', { name: 'Open in Maps' })).toHaveAttribute('href', 'https://www.google.com/maps/search/?api=1&query=Rivals%20Park')
    // TRAK-161: the coach's note for families shows here too.
    expect(within(sheet).getByText('Note').nextElementSibling).toHaveTextContent('Bring water')
    expect(within(sheet).queryByRole('button', { name: /Publish|Edit|Cancel/ })).not.toBeInTheDocument()
    expect(within(sheet).queryByRole('link', { name: /WhatsApp/ })).not.toBeInTheDocument()
    expect(within(sheet).queryByText('Attending')).not.toBeInTheDocument()
    expect(within(sheet).queryByText('Beth Mead')).not.toBeInTheDocument()
    // The full page (Add to calendar, details) stays one tap away (Kostas, #310).
    expect(within(sheet).getByRole('link', { name: 'Open event page' })).toHaveAttribute('href', '/parent/event/ev-1')
    // TRAK-182 (live run 3): the page's Back returns here, so the link says where "here" is.
    await user.click(within(sheet).getByRole('link', { name: 'Open event page' }))
    expect(await screen.findByTestId('from')).toHaveTextContent('/home')
  })

  it('says Training ground for a training and shows a cancellation', async () => {
    const user = userEvent.setup()
    renderStrip([event({ kind: 'training', title: 'Finishing', opponent: null, homeAway: null, meetTime: null, status: 'cancelled', cancelReason: 'Pitch flooded' })], 'parent')
    await user.click(screen.getByRole('button', { name: /Finishing/ }))
    const sheet = await screen.findByRole('dialog', { name: 'Finishing' })
    expect(within(sheet).getByText('Training ground')).toBeInTheDocument()
    expect(within(sheet).getByText('Starts')).toBeInTheDocument()
    expect(within(sheet).getByText('Cancelled.')).toBeInTheDocument()
    expect(within(sheet).getByText('Pitch flooded')).toBeInTheDocument()
    expect(within(sheet).queryByRole('link', { name: 'Open in Maps' })).toBeNull()
  })

  it('tells families when the coach changed the event after publishing', async () => {
    atNoonToday()
    const user = userEvent.setup()
    renderStrip([event({ sequence: 2, updatedAt: new Date(Date.now() - 5 * 60_000).toISOString() })], 'parent')
    await user.click(screen.getByRole('button', { name: /Rivals FC/ }))
    const sheet = await screen.findByRole('dialog', { name: 'vs Rivals FC' })
    expect(within(sheet).getByText(/Updated 5m ago\./)).toBeInTheDocument()
  })
  it('puts the coach\'s "Updated" line between the buttons and Attending', async () => {
    eventRow = row({ published: true })
    atNoonToday()
    const user = userEvent.setup()
    renderStrip([event({ sequence: 1, updatedAt: new Date(Date.now() - 3 * 3600_000).toISOString() })], 'coach')
    await user.click(screen.getByRole('button', { name: /Rivals FC/ }))
    const sheet = await screen.findByRole('dialog', { name: 'vs Rivals FC' })
    const updated = within(sheet).getByText('Updated 3h ago.')
    const share = await within(sheet).findByRole('link', { name: 'Share' })
    expect(share.querySelector('svg')).not.toBeNull()
    const attending = await within(sheet).findByRole('heading', { name: /^Attending/ })
    expect(share.compareDocumentPosition(updated) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(updated.compareDocumentPosition(attending) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(within(sheet).getAllByText('Updated 3h ago.')).toHaveLength(1)
  })
})

// TRAK-225 (20 Oct live run, S4): a Google Maps link typed into the venue.
describe('TRAK-225: a venue with a Maps link', () => {
  it('opens that place, and shows the venue name without the raw link', async () => {
    const user = userEvent.setup()
    const url = 'https://maps.app.goo.gl/AbC123xyz'
    renderStrip([event({ venue: `Rivals Park, ${url}` })], 'parent')
    await user.click(screen.getByRole('button', { name: /Rivals FC/ }))
    const sheet = await screen.findByRole('dialog', { name: 'vs Rivals FC' })
    expect(within(sheet).getByRole('link', { name: 'Open in Maps' })).toHaveAttribute('href', url)
    expect(within(sheet).getByText('Rivals Park')).toBeInTheDocument()
    expect(within(sheet).queryByText(/goo\.gl/)).toBeNull()
  })
})
