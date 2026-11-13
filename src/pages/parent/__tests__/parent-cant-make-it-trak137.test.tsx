/**
 * TRAK-137 (J8.14): like a school register, everyone counts as coming. On the
 * event page a guardian says the selected child "Can't make it", with an
 * optional reason, and can undo it until kickoff. The database decides who may
 * (report_cant_make_it / undo_cant_make_it); the page shows its answer.
 */
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ParentChildrenProvider } from '@/contexts/ParentChildrenContext'
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
const event = (extra: Record<string, unknown> = {}) => ({
  id: 'ev-1', event_type: 'training', title: 'Training', event_date: '2099-11-14', start_time: '10:00:00',
  starts_at: '2099-11-14T06:00:00Z', meet_time: null, venue: 'Main pitch', kit: null, opponent: null,
  home_away: null, status: 'scheduled', cancel_reason: null, sequence: 0, family_note: null, ...extra,
})

let EVENT: Record<string, unknown>
// event_absences rows, keyed by squad row: Alex-squad and Zara-squad share the event.
let ABSENCES: { event_id: string; squad_player_id: string; reason: string | null }[]
let failAbsenceRead: boolean
let refuseReport: string | null
let calls: { fn: string; body: Record<string, unknown> }[]

beforeEach(() => {
  EVENT = event(); ABSENCES = []; failAbsenceRead = false; refuseReport = null; calls = []
  server.use(
    http.get(endpoint('player_parent_links'), () => HttpResponse.json([{ player_user_id: 'Alex' }, { player_user_id: 'Zara' }])),
    http.get(endpoint('profiles'), ({ request }) => {
      const filter = new URL(request.url).searchParams.get('user_id') ?? ''
      return HttpResponse.json(['Alex', 'Zara'].filter(id => filter.includes(id)).map(user_id => ({ user_id, full_name: user_id })))
    }),
    http.get(endpoint('squad_players'), ({ request }) => {
      const child = new URL(request.url).searchParams.get('linked_player_id')?.replace(/^eq\./, '')
      return HttpResponse.json(child ? [{ id: `${child}-squad` }] : [])
    }),
    http.get(endpoint('event_absences'), ({ request }) => {
      if (failAbsenceRead) return HttpResponse.json({ code: 'XX000', message: 'unavailable' }, { status: 500 })
      const ids = new URL(request.url).searchParams.get('squad_player_id') ?? ''
      return HttpResponse.json(ABSENCES.filter(row => ids.includes(row.squad_player_id)))
    }),
    http.post(endpoint('rpc/child_events'), ({ request }) => {
      const out = [EVENT]
      return (request.headers.get('Accept') ?? '').includes('vnd.pgrst.object') ? HttpResponse.json(out[0]) : HttpResponse.json(out)
    }),
    http.post(endpoint('rpc/report_cant_make_it'), async ({ request }) => {
      const body = await request.json() as Record<string, unknown>
      calls.push({ fn: 'report', body })
      if (refuseReport) return HttpResponse.json({ code: '42501', message: refuseReport }, { status: 403 })
      ABSENCES.push({ event_id: String(body.p_event_id), squad_player_id: `${body.p_child}-squad`, reason: (body.p_reason as string) ?? null })
      return new HttpResponse(null, { status: 204 })
    }),
    http.post(endpoint('rpc/undo_cant_make_it'), async ({ request }) => {
      const body = await request.json() as Record<string, unknown>
      calls.push({ fn: 'undo', body })
      ABSENCES = ABSENCES.filter(row => row.squad_player_id !== `${body.p_child}-squad`)
      return new HttpResponse(null, { status: 204 })
    }),
  )
})
const clients: QueryClient[] = []
afterEach(() => { cleanup(); clients.splice(0).forEach(c => c.clear()) })

function renderEvent() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 } } })
  clients.push(client)
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/parent/event/ev-1']}>
    <ParentChildrenProvider><Routes><Route path="/parent/event/:id" element={<ParentEvent />} /></Routes></ParentChildrenProvider>
  </MemoryRouter></QueryClientProvider>)
}

describe('TRAK-137: Can\'t make it', () => {
  it('reports the selected child with an optional reason, then undoes it', async () => {
    const user = userEvent.setup()
    renderEvent()
    await user.click(await screen.findByRole('button', { name: "Can't make it" }))
    // TRAK-249 (Imad, 21 Oct; list 13 Nov): fixed reasons, no text box, so no health details can be typed.
    const reasons = screen.getByRole('radiogroup', { name: 'Reason (optional, the coach sees it)' })
    expect(within(reasons).getAllByRole('radio').map(radio => radio.getAttribute('aria-label') ?? (radio as HTMLInputElement).labels?.[0]?.textContent))
      .toEqual(['School', 'Family', 'Travel', 'Other'])
    expect(screen.queryByRole('textbox')).toBeNull()
    await user.click(within(reasons).getByRole('radio', { name: 'School' }))
    await user.click(screen.getByRole('button', { name: 'Tell the coach' }))
    expect(await screen.findByText("You told the coach Alex can't make it.")).toBeInTheDocument()
    expect(screen.getByText('School')).toBeInTheDocument()
    expect(calls).toEqual([{ fn: 'report', body: { p_event_id: 'ev-1', p_child: 'Alex', p_reason: 'school' } }])
    await user.click(screen.getByRole('button', { name: 'Undo' }))
    expect(await screen.findByRole('button', { name: "Can't make it" })).toBeInTheDocument()
    expect(calls[1]).toEqual({ fn: 'undo', body: { p_event_id: 'ev-1', p_child: 'Alex' } })
  })

  it('keeps each sibling separate: Zara\'s report never shows on Alex\'s page', async () => {
    ABSENCES = [{ event_id: 'ev-1', squad_player_id: 'Zara-squad', reason: 'family' }]
    renderEvent()
    expect(await screen.findByRole('button', { name: "Can't make it" })).toBeInTheDocument()
    expect(screen.queryByText(/You told the coach/)).not.toBeInTheDocument()
    expect(screen.queryByText('Family')).not.toBeInTheDocument()
  })

  it('shows the database\'s refusal and records nothing', async () => {
    refuseReport = 'This event has started; tell the coach directly'
    const user = userEvent.setup()
    renderEvent()
    await user.click(await screen.findByRole('button', { name: "Can't make it" }))
    await user.click(screen.getByRole('button', { name: 'Tell the coach' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('This event has started; tell the coach directly')
    expect(screen.queryByText(/You told the coach/)).not.toBeInTheDocument()
  })

  it('offers nothing on a cancelled or past event', async () => {
    EVENT = event({ status: 'cancelled' })
    renderEvent()
    await screen.findByText('Main pitch')
    expect(screen.queryByRole('button', { name: "Can't make it" })).not.toBeInTheDocument()
    cleanup()
    EVENT = event({ event_date: '2020-01-01', starts_at: '2020-01-01T06:00:00Z' })
    renderEvent()
    await screen.findByText('Main pitch')
    expect(screen.queryByRole('button', { name: "Can't make it" })).not.toBeInTheDocument()
  })

  it('says a failed read failed, rather than offering the button as if nothing were reported', async () => {
    failAbsenceRead = true
    renderEvent()
    expect(await screen.findByText(/Couldn't check whether .* is coming/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: "Can't make it" })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })
})
