/**
 * TRAK-286 (Games 4/8): once the coach shares the plan, a guardian's event page shows their child's job, or "Not in
 * the squad this week", and that the coach left the child a note, never the note or the goals: the page never asks
 * for them. It's the section the coach's Share step previews as the parent. The event card says Plan shared. Test
 * people are named after footballers.
 */
import { cleanup, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ParentChildrenProvider } from '@/contexts/ParentChildrenContext'
import { ParentUpcomingEvents } from '@/components/parent/ParentEvents'
import { GamePlanSection } from '@/components/player/GamePlanSection'
import { planToForm } from '@/lib/games/plan'
import { previewOf } from '@/lib/games/share'
import ParentEvent from '../ParentEvent'
import { server } from '../../../../tests/msw/server'
import { SUPABASE_URL } from '../../../../tests/msw/supabase'

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'dellas', email: 'dellas@test.invalid' },
    profile: { full_name: 'Traianos Dellas', role: 'parent' },
    signOut: vi.fn(), refreshProfile: vi.fn(),
  }),
}))
vi.mock('@/lib/telemetry', () => ({ trackEvent: vi.fn() }))

const endpoint = (name: string) => `${SUPABASE_URL}/rest/v1/${name}`
const MATCH = {
  id: 'g1', event_type: 'match', title: 'League', opponent: 'Parkview Athletic', home_away: 'home', event_date: '2099-11-14',
  start_time: '10:00:00', starts_at: '2099-11-14T06:00:00Z', meet_time: null, venue: 'Rehearsal Park', kit: null,
  status: 'scheduled', cancel_reason: null, sequence: 0, family_note: null,
}
const NAMES: Record<string, string> = { zagorakis: 'Theodoros Zagorakis', 'coach-1': 'Otto Rehhagel' }
let FAMILY: Record<string, unknown>[]
let askedForPlayerCopy: string[]

beforeEach(() => {
  // TRAK-319: Share writes the family's copy with the role only.
  FAMILY = [{ event_id: 'g1', squad_player_id: 'zagorakis-squad', role: 'starter', job: '', has_note: false,
    shared_at: '2099-11-10T15:30:00Z', changed_at: null, coach_name: 'Otto Rehhagel' }]
  askedForPlayerCopy = []
  server.use(
    http.get(endpoint('player_parent_links'), () => HttpResponse.json([{ player_user_id: 'zagorakis' }])),
    http.get(endpoint('profiles'), ({ request }) => {
      const asked = new URL(request.url).searchParams.get('user_id') ?? ''
      return HttpResponse.json(Object.keys(NAMES).filter(id => asked.includes(id)).map(user_id => ({ user_id, full_name: NAMES[user_id] })))
    }),
    http.get(endpoint('squad_players'), ({ request }) => {
      const child = new URL(request.url).searchParams.get('linked_player_id')?.replace(/^eq\./, '')
      return HttpResponse.json(child ? [{ id: `${child}-squad`, coach_user_id: 'coach-1' }] : [])
    }),
    http.get(endpoint('event_absences'), () => HttpResponse.json([])),
    http.post(endpoint('rpc/child_events'), ({ request }) =>
      (request.headers.get('Accept') ?? '').includes('vnd.pgrst.object') ? HttpResponse.json(MATCH) : HttpResponse.json([MATCH])),
    http.get(endpoint('game_for_family'), ({ request }) =>
      (request.headers.get('Accept') ?? '').includes('vnd.pgrst.object') ? HttpResponse.json(FAMILY[0] ?? null) : HttpResponse.json(FAMILY)),
    http.get(endpoint('game_for_player'), ({ request }) => { askedForPlayerCopy.push(request.url); return HttpResponse.json([]) }),
  )
})
const clients: QueryClient[] = []
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()) })

function renderParent(element: JSX.Element, path = '/parent/event/g1') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 } } })
  clients.push(client)
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}>
    <ParentChildrenProvider><Routes><Route path="/parent/event/:id" element={element} /><Route path="/parent/home" element={element} /></Routes></ParentChildrenProvider>
  </MemoryRouter></QueryClientProvider>)
}

describe('TRAK-286: the shared game plan on a guardian\'s event page', () => {
  it('shows only that the child starts: never the job, the note or the goals, as the coach\'s preview does (TRAK-319)', async () => {
    renderParent(<ParentEvent />)
    const section = await screen.findByRole('region', { name: 'Game plan' })
    expect(within(section).getByText('Theodoros: Starting')).toBeInTheDocument()
    expect(section).not.toHaveTextContent(/Stay tight|job|note|Proud of you|Win the second ball/)
    expect(askedForPlayerCopy).toEqual([])
    const page = section.textContent
    cleanup()

    const form = planToForm({ strength: 'stronger', their_formation: null, key_players: [], scouting: '', format: 11, formation: '4-4-2',
      goals: [{ title: 'Win the second ball', looks_like: '' }] }, [{ squad_player_id: 'zagorakis', role: 'starter', slot: 4,
      job: 'Stay tight to their winger.', note: 'Second game at right-back. Proud of you.', context: [], expectation: 'usual' }])
    render(<GamePlanSection as="parent" coachName="Otto Rehhagel" childName="Theodoros" plan={previewOf(form, 'zagorakis', 'parent')} />)
    expect(screen.getByRole('region', { name: 'Game plan' }).textContent).toBe(page)
  })

  it('a child left out reads "Not in the squad this week" for the family', async () => {
    FAMILY = [{ ...FAMILY[0], role: 'not_selected', job: '' }]
    renderParent(<ParentEvent />)
    const section = await screen.findByRole('region', { name: 'Game plan' })
    expect(within(section).getByText('Not in the squad this week')).toBeInTheDocument()
    expect(within(section).queryByText(/job/)).toBeNull()
  })

  it('the event card says Plan shared', async () => {
    renderParent(<ParentUpcomingEvents />, '/parent/home')
    const card = await within(await screen.findByRole('region', { name: 'Upcoming' })).findByRole('link', { name: /Parkview/ })
    expect(await within(card).findByText('Plan shared')).toBeInTheDocument()
    expect(askedForPlayerCopy).toEqual([])
  })
})
