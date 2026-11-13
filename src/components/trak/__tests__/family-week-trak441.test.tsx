import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { server } from '../../../../tests/msw/server'
import { SUPABASE_URL } from '../../../../tests/msw/supabase'
import { LoadedWeekStrip, type StripEvent } from '../WeekStrip'

/**
 * TRAK-441 slice 2.4c (Imad, 13 Nov): the family Home's week is the coach's week picker, read only. Nothing "needs
 * you", each event's line is what the family needs (Cancelled, Can't make it, the venue), and Details opens the
 * family's own event sheet.
 */

const today = new Date(2026, 10, 11, 12) // Wednesday 11 November
const row = (id: string, type: string, date: string, extra: Record<string, unknown> = {}) =>
  ({ id, event_type: type, title: type === 'training' ? 'Training' : 'League', event_date: date, start_time: '17:00:00',
    status: 'scheduled', sequence: 0, updated_at: '2026-11-01T00:00:00Z', ...extra })

function renderWeek(load: (from: string, to: string) => Promise<{ data: unknown[]; error: null }>, opened: StripEvent[] = []) {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(today)
  onTestFinished(() => { vi.useRealTimers() })
  server.use(
    http.get(`${SUPABASE_URL}/rest/v1/squad_players`, () => HttpResponse.json([{ id: 'sp-own' }])),
    http.get(`${SUPABASE_URL}/rest/v1/event_absences`, () => HttpResponse.json([{ event_id: 'ev-t' }])),
  )
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>
    <LoadedWeekStrip picker loadKey="child-1" absentFor="child-1" load={load}
      renderSheet={(event, trigger) => <span onClickCapture={() => opened.push(event)}>{trigger}</span>} />
  </QueryClientProvider>)
}

describe("TRAK-441: the family's week is the coach's week picker", () => {
  it("shows the week with no Needs you, and each event's line for a family", async () => {
    renderWeek(async () => ({ data: [
      row('ev-t', 'training', '2026-11-11', { venue: 'Pitch 2' }),
      row('ev-c', 'training', '2026-11-11', { start_time: '19:00:00', status: 'cancelled' }),
      row('ev-m', 'match', '2026-11-14', { opponent: 'Rivals FC', venue: 'Parkview' }),
    ], error: null }))
    expect(await screen.findByRole('heading', { name: 'This week' })).toBeInTheDocument()
    expect(screen.getByText('9–15 November')).toBeInTheDocument()
    expect(screen.queryByText('Needs you')).toBeNull()
    // Today is picked, so its events show: the family's own Can't make it, and a cancelled session.
    await waitFor(() => expect(screen.getByRole('button', { name: /^Training, 17:00, Can't make it/ })).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /^Training, 19:00, Cancelled/ })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Saturday 14 November/ }))
    expect(await screen.findByRole('button', { name: /^Match vs Rivals FC, 17:00, Parkview/ })).toBeInTheDocument()
  })

  it('Details opens the event in the family sheet', async () => {
    const opened: StripEvent[] = []
    renderWeek(async () => ({ data: [row('ev-m', 'match', '2026-11-11', { opponent: 'Rivals FC' })], error: null }), opened)
    await userEvent.click(await screen.findByRole('button', { name: 'Details' }))
    expect(opened.map(event => event.id)).toEqual(['ev-m'])
  })

  it('the arrows read the next week', async () => {
    const asked: string[] = []
    renderWeek(async (from, to) => { asked.push(`${from}..${to}`); return { data: [], error: null } })
    const next = await screen.findByRole('button', { name: /next week/i })
    await userEvent.click(next)
    await waitFor(() => expect(asked).toContain('2026-11-16..2026-11-22'))
    expect(await screen.findByRole('heading', { name: 'Next week' })).toBeInTheDocument()
    expect(within(screen.getByRole('group', { name: /16–22 November/ })).getAllByRole('button')).toHaveLength(7)
    // An empty day says so once (Imad's rule, 12 Nov: nothing said twice).
    expect(screen.getAllByText(/Nothing planned/)).toHaveLength(1)
  })
})
