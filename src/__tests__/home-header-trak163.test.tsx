import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation, useParams } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HomeHeader, HomeTitle } from '@/components/trak/HomeHeader'
import { LoadedWeekStrip, WeekStrip, weekDays, type RenderEventSheet, type StripEvent } from '@/components/trak/WeekStrip'
import { EventSheet } from '@/components/trak/EventSheet'
import { PlayerAlertsBell } from '@/components/player/PlayerAlertsBell'
import type { PlayerEvent } from '@/lib/player-events'

// TRAK-163 (Imad, 12 Oct): calendar top left, name in the middle, bell top
// right; the next seven days under it; players get the parent's bell.

const event = (over: Partial<StripEvent> = {}): StripEvent => ({
  id: 'e1', kind: 'training', title: 'Technical', date: '2026-10-12', time: '18:00', meetTime: '17:30',
  venue: 'Main pitch', kit: 'Blue bibs', opponent: null, homeAway: null, status: 'scheduled', cancelReason: null,
  sequence: 1, updatedAt: '2026-10-11T19:00:00Z', familyNote: null, ...over,
})

function EventPage() {
  const from = (useLocation().state as { from?: string } | null)?.from
  return <><p>Event page {useParams().id}</p><p>Opened from {from ?? 'nowhere'}</p></>
}
const at = (ui: JSX.Element) => render(
  <MemoryRouter initialEntries={['/home']}>
    <Routes>
      <Route path="/home" element={ui} />
      <Route path="/player/event/:id" element={<EventPage />} />
      <Route path="/calendar" element={<p>Calendar page</p>} />
    </Routes>
  </MemoryRouter>)

describe('home header', () => {
  it('opens the calendar from the top left and shows the name', async () => {
    at(<HomeHeader calendarTo="/calendar" center={<HomeTitle>Dora Fotiadi</HomeTitle>} />)
    expect(screen.getByRole('heading', { name: 'Dora Fotiadi' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('link', { name: 'Calendar' }))
    expect(await screen.findByText('Calendar page')).toBeInTheDocument()
  })
})

// TRAK-182: a row opens its event in the bottom sheet (here as a player sees it).
const sheet: RenderEventSheet = (e, trigger) => <EventSheet event={e} role="player" trigger={trigger} />

describe('week strip', () => {
  const today = new Date('2026-10-12T09:00:00')
  it("shows today's events, opens one, and says when a day has nothing", async () => {
    at(<WeekStrip today={today} renderSheet={sheet} events={[
      event(),
      event({ id: 'e2', kind: 'match', title: null, opponent: 'Palm United', homeAway: 'away', date: '2026-10-16', time: '17:00' }),
    ]} />)
    const days = screen.getByRole('group', { name: 'This week' })
    expect(within(days).getAllByRole('button')).toHaveLength(7)
    expect(within(days).getByRole('button', { name: /Monday 12 October/, pressed: true })).toBeInTheDocument()
    expect(within(within(days).getByRole('button', { name: /Friday 16 October/ })).getByLabelText('1 event')).toBeInTheDocument()
    expect(within(within(days).getByRole('button', { name: /Wednesday 14 October/ })).queryByLabelText(/event/)).toBeNull()
    // Today's event is listed; its details open in the sheet (TRAK-182).
    expect(screen.getByRole('button', { name: /18:00\s*Technical/ })).toBeInTheDocument()

    await userEvent.click(within(days).getByRole('button', { name: /Friday 16 October/ }))
    expect(screen.getByText('Friday 16 October', { selector: 'p' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /17:00\s*Match vs Palm United \(away\)/ })).toBeInTheDocument()

    await userEvent.click(within(days).getByRole('button', { name: /Wednesday 14 October/ }))
    expect(screen.getByText('Nothing planned.')).toBeInTheDocument()

    await userEvent.click(within(days).getByRole('button', { name: /Friday 16 October/ }))
    await userEvent.click(screen.getByRole('button', { name: /Palm United/ }))
    const opened = await screen.findByRole('dialog', { name: 'vs Palm United' })
    expect(within(opened).getByText('Away')).toBeInTheDocument()
    expect(within(opened).getByText('Fri 16 Oct')).toBeInTheDocument()
  })

  it('runs Monday to Sunday with today selected, and keeps the past days of the week (Imad, 12 Oct)', async () => {
    const wednesday = new Date('2026-10-14T09:00:00')
    expect(weekDays(wednesday)).toEqual(['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18'])
    expect(weekDays(new Date('2026-10-18T22:00:00'))[0]).toBe('2026-10-12')
    at(<WeekStrip today={wednesday} renderSheet={sheet} events={[event()]} />)
    const days = within(screen.getByRole('group', { name: 'This week' })).getAllByRole('button')
    expect(days.map(day => day.textContent?.[0])).toEqual(['M', 'T', 'W', 'T', 'F', 'S', 'S'])
    expect(days[2]).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('Nothing planned.')).toBeInTheDocument()
    await userEvent.click(days[0])
    expect(screen.getByRole('button', { name: /18:00\s*Technical/ })).toBeInTheDocument()
  })

  it("loads this week's events itself, and a failed read is an error with Retry", async () => {
    const days = weekDays(new Date())
    const load = vi.fn()
      .mockResolvedValueOnce({ data: null, error: { message: 'offline' } })
      .mockResolvedValueOnce({ data: [{ id: 'e9', event_type: 'match', title: null, opponent: 'Rivals', event_date: days[0], start_time: '10:00:00', published: false }], error: null })
    at(<LoadedWeekStrip loadKey="dora" load={load} renderSheet={sheet} />)
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.queryByText('Nothing planned.')).toBeNull()
    expect(load).toHaveBeenCalledWith(days[0], days[6])
    await userEvent.click(screen.getByRole('button', { name: /retry/i }))
    await userEvent.click(within(await screen.findByRole('group', { name: 'This week' })).getAllByRole('button')[0])
    expect(screen.getByRole('button', { name: /10:00\s*Match vs Rivals\s*Draft/ })).toBeInTheDocument()
  })

  it('marks a cancelled event, a draft and a missing time', () => {
    at(<WeekStrip today={today} renderSheet={sheet} events={[
      event({ status: 'cancelled', cancelReason: 'Pitch closed' }),
      event({ id: 'e3', time: null, draft: true, title: 'Fitness' }),
    ]} />)
    expect(screen.getByRole('button', { name: /18:00\s*Technical\s*Cancelled/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /TBC\s*Fitness\s*Draft/ })).toBeInTheDocument()
    expect(screen.getByLabelText('2 events')).toBeInTheDocument()
  })
})

describe('player bell', () => {
  beforeEach(() => localStorage.clear())
  const events: PlayerEvent[] = [event(), event({ id: 'e2', title: 'Fitness', time: '19:30', updatedAt: '2026-10-11T20:00:00Z' })]

  it('counts new events, says "Changed" after an edit; Mark all read clears the count', async () => {
    const { rerender } = render(<MemoryRouter><PlayerAlertsBell userId="hugo" events={events} /></MemoryRouter>)
    expect(await screen.findByRole('button', { name: 'Alerts, 2 unread' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /^Alerts/ }))
    const panel = await screen.findByRole('dialog', { name: 'Alerts' })
    expect(within(panel).getByText('New: Technical')).toBeInTheDocument()
    expect(within(panel).getByText('Mon 12 Oct, 18:00 · Main pitch')).toBeInTheDocument()
    // Arc's notification center: closing keeps the count; Mark all read clears it.
    await userEvent.keyboard('{Escape}')
    expect(await screen.findByRole('button', { name: 'Alerts, 2 unread' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /^Alerts/ }))
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'Alerts' })).getByRole('button', { name: 'Mark all read' }))
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Alerts' })).toBeInTheDocument())

    // The coach moves Technical to 19:00: it counts again, as a change.
    rerender(<MemoryRouter><PlayerAlertsBell userId="hugo" events={[
      event({ time: '19:00', sequence: 2, updatedAt: '2026-10-12T08:00:00Z' }), events[1],
    ]} /></MemoryRouter>)
    expect(await screen.findByRole('button', { name: 'Alerts, 1 unread' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /^Alerts/ }))
    expect(within(await screen.findByRole('dialog', { name: 'Alerts' })).getByText('Changed: Technical')).toBeInTheDocument()
  })

  // TRAK-163 (Tarek's review): Dismiss removes an alert until the coach changes the event.
  it('a dismissed alert stays gone, and comes back when the event changes', async () => {
    const { rerender } = render(<MemoryRouter><PlayerAlertsBell userId="hugo" events={events} /></MemoryRouter>)
    await userEvent.click(await screen.findByRole('button', { name: /^Alerts/ }))
    let panel = await screen.findByRole('dialog', { name: 'Alerts' })
    await userEvent.click(within(panel).getByRole('button', { name: /New: Fitness/ }))
    await userEvent.click(await within(panel).findByRole('button', { name: 'Dismiss' }))
    // jsdom doesn't finish Arc's exit animation, so check after closing and reopening.
    await userEvent.keyboard('{Escape}')
    expect(await screen.findByRole('button', { name: 'Alerts, 1 unread' })).toBeInTheDocument()

    rerender(<MemoryRouter><PlayerAlertsBell userId="hugo" events={[...events]} /></MemoryRouter>)
    await userEvent.click(screen.getByRole('button', { name: /^Alerts/ }))
    panel = await screen.findByRole('dialog', { name: 'Alerts' })
    expect(within(panel).queryByText(/Fitness/)).toBeNull()
    await userEvent.keyboard('{Escape}')

    rerender(<MemoryRouter><PlayerAlertsBell userId="hugo" events={[events[0], { ...events[1], sequence: 2, updatedAt: '2026-10-12T08:00:00Z' }]} /></MemoryRouter>)
    await userEvent.click(screen.getByRole('button', { name: /^Alerts/ }))
    expect(within(await screen.findByRole('dialog', { name: 'Alerts' })).getByText('Changed: Fitness')).toBeInTheDocument()
  })

  it('opens the event', async () => {
    at(<PlayerAlertsBell userId="hugo" events={events} />)
    await userEvent.click(await screen.findByRole('button', { name: /^Alerts/ }))
    const panel = await screen.findByRole('dialog', { name: 'Alerts' })
    await userEvent.click(within(panel).getByRole('button', { name: /New: Fitness/ }))
    await userEvent.click(await within(panel).findByRole('button', { name: 'Open event' }))
    expect(await screen.findByText('Event page e2')).toBeInTheDocument()
    // Live run, 19 Oct (Tarek): opened from Home's bell, the event page's Back returns to Home.
    expect(screen.getByText('Opened from /home')).toBeInTheDocument()
  })
})
